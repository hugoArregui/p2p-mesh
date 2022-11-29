import { ServerConnection } from './serverConnection'
import { ILogger, PeerId, PEER_CONNECT_TIMEOUT } from './types'
import { encode, decode } from './utils'

const DEBUG = false
const DEBUG_ICE_CANDIDATES = false

type PacketHandler = (data: Uint8Array, reliable: boolean) => void
type OnConnectionChanged = (peerId: PeerId, change: 'established' | 'closed') => void

type Connection = {
  instance: RTCPeerConnection
  createTimestamp: number
  dc?: RTCDataChannel
}

export class Mesh {
  private disposed = false
  public initiatedConnections = new Map<PeerId, Connection>()
  public receivedConnections = new Map<PeerId, Connection>()

  constructor(
    private logger: ILogger,
    private conn: ServerConnection,
    private peerId: PeerId,
    private packetHandler: PacketHandler,
    private onConnectionChanged: OnConnectionChanged,
    private iceServers: RTCIceServer[],
    private maxConnections: number
  ) {}

  public async connectTo(peerId: PeerId, reason: string): Promise<void> {
    if (this.initiatedConnections.has(peerId) || this.receivedConnections.has(peerId)) {
      return
    }

    this.debugWebRtc(`Connecting to ${peerId}. ${reason}`)

    const instance = this.createConnection(peerId, this.peerId)
    const conn: Connection = { instance, createTimestamp: Date.now() }
    this.initiatedConnections.set(peerId, conn)
    instance.addEventListener('connectionstatechange', (_) => {
      switch (instance.connectionState) {
        case 'new':
          conn.createTimestamp = Date.now()
          break
        case 'connected':
          break
        case 'closed':
        case 'disconnected':
          this.initiatedConnections.delete(peerId)

          if (!this.isConnectedTo(peerId)) {
            this.onConnectionChanged(peerId, 'closed')
          }

          break
        default:
          break
      }
    })

    this.debugWebRtc(`Opening dc for ${peerId}`)
    const dc = instance.createDataChannel('data')
    this.registerDc(conn, dc, peerId)
    const offer = await instance.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false
    })
    await instance.setLocalDescription(offer)
    this.debugWebRtc(`Set local description for ${peerId}`)
    this.debugWebRtc(`Sending offer to ${peerId}`)
    this.conn.publish([`${peerId}.offer`], encode(JSON.stringify(offer)))
  }

  public connectedCount(): number {
    let count = 0
    this.initiatedConnections.forEach(({ instance }: Connection) => {
      if (instance.connectionState === 'connected') {
        count++
      }
    })
    this.receivedConnections.forEach(({ instance }: Connection) => {
      if (instance.connectionState === 'connected') {
        count++
      }
    })
    return count
  }

  public connectionsCount(): number {
    return this.initiatedConnections.size + this.receivedConnections.size
  }

  public disconnectFrom(peerId: PeerId): void {
    this.debugWebRtc(`Disconnecting from ${peerId}`)
    let conn = this.initiatedConnections.get(peerId)
    if (conn) {
      conn.instance.close()
    }

    conn = this.receivedConnections.get(peerId)
    if (conn) {
      conn.instance.close()
    }
  }

  public hasConnectionsFor(peerId: PeerId): boolean {
    return !!(this.initiatedConnections.get(peerId) || this.receivedConnections.get(peerId))
  }

  public isConnectedTo(peerId: PeerId): boolean {
    let conn = this.initiatedConnections.get(peerId)
    if (conn && conn.instance.connectionState === 'connected' && conn.dc && conn.dc.readyState === 'open') {
      return true
    }
    conn = this.receivedConnections.get(peerId)
    if (conn && conn.instance.connectionState === 'connected' && conn.dc && conn.dc.readyState === 'open') {
      return true
    }

    return false
  }

  public connectedPeerIds(): PeerId[] {
    const peerIds = new Set(this.initiatedConnections.keys())
    this.receivedConnections.forEach((_, peerId) => peerIds.add(peerId))
    return Array.from(peerIds)
  }

  public fullyConnectedPeerIds(): PeerId[] {
    const peers: PeerId[] = []

    this.initiatedConnections.forEach(({ instance }: Connection, peerId: PeerId) => {
      if (instance.connectionState === 'connected') {
        peers.push(peerId)
      }
    })

    this.receivedConnections.forEach(({ instance }: Connection, peerId: PeerId) => {
      if (instance.connectionState === 'connected') {
        peers.push(peerId)
      }
    })

    return peers
  }

  public checkConnectionsSanity(): void {
    this.initiatedConnections.forEach((conn: Connection, peerId: PeerId) => {
      if (this.peerId < peerId) {
        const otherConnection = this.receivedConnections.get(peerId)
        if (otherConnection) {
          if (conn.instance.connectionState === 'connected') {
            this.logger.log(`Disconnecting duplicated connection ${peerId}`)
            otherConnection.instance.close()
          } else if (otherConnection.instance.connectionState === 'connected') {
            this.logger.log(`Disconnecting duplicated connection ${peerId}`)
            conn.instance.close()
          }
        }
      }
    })

    this.initiatedConnections.forEach((conn: Connection, peerId: PeerId) => {
      const state = conn.instance.connectionState

      if (state !== 'connected' && Date.now() - conn.createTimestamp > PEER_CONNECT_TIMEOUT) {
        this.logger.log(`The connection ->${peerId} is not in a sane state ${state}. Discarding it.`)
        conn.instance.close()
      }
    })
    this.receivedConnections.forEach((conn: Connection, peerId: PeerId) => {
      const state = conn.instance.connectionState
      if (state !== 'connected' && Date.now() - conn.createTimestamp > PEER_CONNECT_TIMEOUT) {
        this.logger.log(`The connection <-${peerId} is not in a sane state ${state}. Discarding it.`)
        conn.instance.close()
      }
    })
  }

  public sendPacketToPeer(peerId: PeerId, data: Uint8Array, reliable: boolean = false): boolean {
    let conn = this.initiatedConnections.get(peerId)
    if (conn && conn.dc && conn.dc.readyState === 'open') {
      conn.dc.send(data)
      return true
    }
    conn = this.receivedConnections.get(peerId)
    if (conn && conn.dc && conn.dc.readyState === 'open') {
      conn.dc.send(data)
      return true
    }
    return false
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    this.initiatedConnections.forEach(({ instance }: Connection) => {
      instance.close()
    })
    this.receivedConnections.forEach(({ instance }: Connection) => {
      instance.close()
    })

    this.initiatedConnections.clear()
    this.receivedConnections.clear()
  }

  private createConnection(peerId: PeerId, initiator: PeerId) {
    const instance = new RTCPeerConnection({
      iceServers: this.iceServers
    })

    instance.addEventListener('icecandidate', async (event) => {
      if (event.candidate) {
        try {
          const msg = { candidate: event.candidate, initiator }
          this.conn.publish([`${peerId}.candidate`], encode(JSON.stringify(msg)))
        } catch (err: any) {
          this.logger.error(`cannot publish ice candidate: ${err.toString()}`)
        }
      }
    })

    instance.addEventListener('iceconnectionstatechange', () => {
      this.debugWebRtc(`Connection with ${peerId}, ice status changed: ${instance.iceConnectionState}`)
    })
    return instance
  }

  async onCandidateMessage(sender: PeerId, body: Uint8Array) {
    if (this.disposed) return

    if (DEBUG_ICE_CANDIDATES) {
      this.logger.info(`ICE candidate received from ${sender}`)
    }

    const { candidate, initiator } = JSON.parse(decode(body))

    try {
      const conn = (initiator === this.peerId ? this.initiatedConnections : this.receivedConnections).get(sender)
      if (!conn) {
        if (DEBUG_ICE_CANDIDATES) {
          this.logger.info(
            `ICE candidate received from ${sender}, but there is no connection. (initiator: ${
              initiator === this.peerId ? 'us' : 'them'
            })`
          )
        }
        return
      }

      const state = conn.instance.connectionState
      if (state !== 'connecting' && state !== 'new' && state !== 'connected') {
        this.debugWebRtc(`No setting ice candidate for ${sender}, connection is in state ${state}`)
        return
      }

      await conn.instance.addIceCandidate(candidate)
    } catch (e: any) {
      this.logger.error(
        `Failed to add ice candidate: ${e.toString()} (initiator: ${initiator === this.peerId ? 'us' : 'them'})`
      )
    }
  }

  async onOfferMessage(peerId: PeerId, body: Uint8Array) {
    if (this.disposed) return

    if (this.connectionsCount() >= this.maxConnections) {
      if (DEBUG) {
        this.logger.log('Rejecting offer, already enough connections')
      }
      return
    }

    this.debugWebRtc(`Got offer message from ${peerId}`)

    const offer = JSON.parse(decode(body))
    const instance = this.createConnection(peerId, peerId)
    const conn: Connection = { instance, createTimestamp: Date.now() }
    this.receivedConnections.set(peerId, conn)

    instance.addEventListener('connectionstatechange', () => {
      switch (instance.connectionState) {
        case 'new':
          conn.createTimestamp = Date.now()
          break
        case 'connected':
          break
        case 'closed':
        case 'disconnected':
          // NOTE: I think this is not really need, but during our stress test using wertc, the dc.close was not always been called, so this is a workaround for that.
          this.receivedConnections.delete(peerId)
          if (!this.isConnectedTo(peerId)) {
            this.onConnectionChanged(peerId, 'established')
          }
          break
        default:
          break
      }
    })
    instance.addEventListener('datachannel', (event) => {
      this.debugWebRtc(`Got data channel from ${peerId}`)
      this.registerDc(conn, event.channel, peerId)
    })

    try {
      this.debugWebRtc(`Setting remote description for ${peerId}`)
      await instance.setRemoteDescription(offer)

      this.debugWebRtc(`Creating answer for ${peerId}`)
      const answer = await instance.createAnswer()

      this.debugWebRtc(`Setting local description for ${peerId}`)
      await instance.setLocalDescription(answer)

      this.debugWebRtc(`Sending answer to ${peerId}`)
      this.conn.publish([`${peerId}.answer`], encode(JSON.stringify(answer)))
    } catch (e: any) {
      this.logger.error(`Failed to create answer: ${e.toString()}`)
    }
  }

  async onAnswerListener(sender: PeerId, body: Uint8Array) {
    if (this.disposed) return
    this.debugWebRtc(`Got answer message from ${sender}`)
    const conn = this.initiatedConnections.get(sender)
    if (!conn) {
      return
    }

    const state = conn.instance.connectionState
    if (state !== 'connecting' && state !== 'new') {
      this.debugWebRtc(`No setting remote description for ${sender} connection is in state ${state}`)
      return
    }

    try {
      const answer = JSON.parse(decode(body))
      this.debugWebRtc(`Setting remote description for ${sender}`)
      await conn.instance.setRemoteDescription(answer)
    } catch (e: any) {
      this.logger.error(`Failed to set remote description: ${e.toString()}`)
    }
  }

  private registerDc(conn: Connection, dc: RTCDataChannel, peerId: PeerId) {
    dc.binaryType = 'arraybuffer'
    dc.addEventListener('open', () => {
      conn.dc = dc
      this.onConnectionChanged(peerId, 'established')
    })
    dc.addEventListener('closing', () => {
      if (!this.isConnectedTo(peerId)) {
        this.onConnectionChanged(peerId, 'closed')
      }
    })
    dc.addEventListener('close', () => {
      if (!this.isConnectedTo(peerId)) {
        this.onConnectionChanged(peerId, 'closed')
      }
    })
    dc.addEventListener('message', async (event) => {
      const data = new Uint8Array(event.data)
      this.packetHandler(data, false)
    })
  }

  private debugWebRtc(message: string) {
    if (DEBUG) {
      this.logger.log(message)
    }
  }
}
