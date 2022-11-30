import mitt from 'mitt'
import { defaultIceServers, ILogger, PeerId, UPDATE_NETWORK_INTERVAL } from './types'
import { Mesh } from './mesh'
import { CommsAdapterEvents } from './types'
import { createConnectionsGraph, Graph } from './graph'
import { MeshUpdateMessage, Packet } from './proto/p2p.gen'
import { ServerConnection } from './serverConnection'
import { craftMessage, nextSteps, pickRandom } from './utils'

const DEBUG_SEND_FAILURE = false
const DEBUG_UPDATE_NETWORK = false

export type KnownPeerData = {
  id: PeerId
  lastMeshUpdate?: number
}

export type P2PConfig = {
  maxPeers: number
  targetConnections: number
  maxConnections: number
  iceServers?: RTCIceServer[]
  fallbackEnabled: boolean
  publishStatusIntervalMs: number
}

export class PeerToPeerAdapter {
  public readonly mesh: Mesh
  public readonly events = mitt<CommsAdapterEvents>()
  public readonly knownPeers = new Map<PeerId, KnownPeerData>()
  public readonly graph: Graph

  private peerId: PeerId
  private updatingNetwork: boolean = false
  private updateNetworkTimeoutId: ReturnType<typeof setTimeout> | null = null
  private shareMeshInterval: ReturnType<typeof setInterval> | null = null
  private disposed: boolean = false
  private meshStatusIndex = 0
  private maxConnections: number
  private targetConnections: number
  private fallbackEnabled: boolean

  private publishStatusIntervalMs: number

  constructor(private logger: ILogger, private serverConn: ServerConnection, config: P2PConfig) {
    this.peerId = serverConn.id
    this.graph = createConnectionsGraph(this.peerId, config.maxPeers)
    this.maxConnections = config.maxConnections
    this.targetConnections = config.targetConnections
    this.fallbackEnabled = config.fallbackEnabled
    this.publishStatusIntervalMs = config.publishStatusIntervalMs

    this.mesh = new Mesh(
      this.logger,
      this.serverConn,
      this.peerId,
      this.handlePeerPacket.bind(this),
      (peerId: PeerId, change) => {
        this.meshStatusIndex++
        if (change === 'established') {
          this.graph.addConnection(this.peerId, peerId)
          this.serverConn.publishConnectionEstablishedChange(peerId)
        } else {
          this.graph.removeConnection(this.peerId, peerId)
          this.serverConn.publishConnectionClosedChange(peerId)
        }
      },
      config.iceServers ?? defaultIceServers,
      config.maxConnections
    )

    this.serverConn.publishConnectionStatus(this.meshStatusIndex, this.mesh.connectedPeerIds())

    this.scheduleUpdateNetwork()

    this.shareMeshInterval = setInterval(() => {
      if (this.disposed) {
        return
      }

      this.serverConn.publishConnectionStatus(this.meshStatusIndex, this.mesh.connectedPeerIds())
    }, this.publishStatusIntervalMs)
  }

  private async onMeshChanged(_: PeerId, body: Uint8Array) {
    const { data, source } = MeshUpdateMessage.decode(body)
    if (source === this.peerId) {
      return
    }

    let sourceData = this.knownPeers.get(source)
    if (!sourceData) {
      sourceData = { id: source }
      this.knownPeers.set(source, sourceData)
    }

    switch (data?.$case) {
      case 'disconnectedFrom': {
        if (data.disconnectedFrom !== this.peerId) {
          this.graph.removeConnection(source, data.disconnectedFrom)
        }
        break
      }
      case 'connectedTo': {
        if (data.connectedTo !== this.peerId) {
          this.graph.addConnection(source, data.connectedTo)
        }
        break
      }
      case 'status': {
        if (sourceData.lastMeshUpdate && data.status.id <= sourceData.lastMeshUpdate) {
          return
        }

        for (const p of this.knownPeers.keys()) {
          if (p === this.peerId) {
            continue
          }
          if (data.status.connectedTo.includes(p)) {
            this.graph.addConnection(source, p)
          } else {
            this.graph.removeConnection(source, p)
          }
        }
        sourceData.lastMeshUpdate = data.status.id
        break
      }
    }
  }

  private async onFallback(_: PeerId, body: Uint8Array) {
    const packet = Packet.decode(body)
    this.events.emit('message', {
      peerId: packet.source,
      data: packet.payload
    })
  }

  async connect() {
    // TODO: close subscriptions upon disconnection
    this.serverConn.subscribe(`mesh`, this.onMeshChanged.bind(this))
    this.serverConn.subscribe(`${this.peerId}.fallback`, this.onFallback.bind(this))
    this.serverConn.subscribe(`${this.peerId}.candidate`, this.mesh.onCandidateMessage.bind(this.mesh))
    this.serverConn.subscribe(`${this.peerId}.offer`, this.mesh.onOfferMessage.bind(this.mesh))
    this.serverConn.subscribe(`${this.peerId}.answer`, this.mesh.onAnswerListener.bind(this.mesh))

    this.triggerUpdateNetwork('start')
  }

  async disconnect() {
    if (this.disposed) return

    this.disposed = true
    if (this.updateNetworkTimeoutId) {
      clearTimeout(this.updateNetworkTimeoutId)
    }

    if (this.shareMeshInterval) {
      clearInterval(this.shareMeshInterval)
    }

    this.knownPeers.clear()
    await this.mesh.dispose()
    this.events.emit('DISCONNECTION', {})
  }

  async send(payload: Uint8Array): Promise<void> {
    if (this.disposed) {
      return
    }
    const edges = this.graph.getMST()
    const reachablePeers = this.graph.getReachablePeers()
    const packet = craftMessage({
      payload,
      source: this.peerId,
      edges
    })

    const peersToSend: Set<PeerId> = nextSteps(edges, this.peerId)

    for (const neighbor of peersToSend) {
      if (!this.mesh.sendPacketToPeer(neighbor, packet)) {
        this.logger.warn(
          `cannot send package to ${neighbor}, ${this.mesh.isConnectedTo(neighbor)} ${this.graph.isConnectedTo(
            neighbor
          )} `
        )
      }
    }

    if (this.fallbackEnabled) {
      const topics = []
      for (const peerId of this.knownPeers.keys()) {
        if (!reachablePeers.has(peerId)) {
          topics.push(`${peerId}.fallback`)
        }
      }
      if (topics.length > 0) {
        this.serverConn.publish(topics, packet)
      }
    }
  }

  private async handlePeerPacket(data: Uint8Array) {
    if (this.disposed) return

    const packet = Packet.decode(data)

    this.events.emit('message', {
      peerId: packet.source,
      data: packet.payload
    })

    const peersToSend: Set<PeerId> = nextSteps(packet.edges, this.peerId)
    for (const neighbor of peersToSend) {
      if (!this.mesh.sendPacketToPeer(neighbor, data) && DEBUG_SEND_FAILURE) {
        this.logger.warn(
          `cannot relay package to ${neighbor}. ${this.mesh.isConnectedTo(neighbor)} - ${this.graph.isConnectedTo(
            neighbor
          )}`
        )
      }
    }
  }

  private scheduleUpdateNetwork() {
    if (this.disposed) {
      return
    }
    if (this.updateNetworkTimeoutId) {
      clearTimeout(this.updateNetworkTimeoutId)
    }
    this.updateNetworkTimeoutId = setTimeout(() => {
      this.triggerUpdateNetwork('scheduled network update')
    }, UPDATE_NETWORK_INTERVAL)
  }

  private triggerUpdateNetwork(event: string) {
    this.updateNetwork(event).catch((e) => {
      this.logger.warn(`Error updating network after ${event}, ${e} `)
    })
    this.scheduleUpdateNetwork()
  }

  private async updateNetwork(event: string) {
    if (this.updatingNetwork || this.disposed) {
      return
    }

    try {
      this.updatingNetwork = true

      if (DEBUG_UPDATE_NETWORK) {
        this.logger.log(`Updating network because of event "${event}"...`)
      }

      this.mesh.checkConnectionsSanity()

      const neededConnections = Math.min(
        this.targetConnections - this.mesh.connectedCount(),
        this.maxConnections - this.mesh.connectionsCount()
      )
      // If we need to establish new connections because we are below the target, we do that
      if (neededConnections > 0) {
        if (DEBUG_UPDATE_NETWORK) {
          this.logger.log(
            `Establishing connections to reach target. I need ${neededConnections} more connections. I have ${this.mesh.connectionsCount()} connections, ${this.mesh.connectedCount()} connected `
          )
        }

        const candidates = pickRandom(
          Array.from(this.knownPeers.values()).filter((peer) => {
            return !this.mesh.hasConnectionsFor(peer.id)
          }),
          neededConnections
        )

        if (DEBUG_UPDATE_NETWORK) {
          this.logger.log(`Picked connection candidates ${JSON.stringify(candidates)} `)
        }

        const reason = 'I need more connections.'
        await Promise.all(candidates.map((candidate) => this.mesh.connectTo(candidate.id, reason)))
      }

      // If we are over the max amount of connections, we discard some
      const toDisconnect = this.mesh.connectedCount() - this.maxConnections
      if (toDisconnect > 0) {
        if (DEBUG_UPDATE_NETWORK) {
          this.logger.log(
            `Too many connections ${this.mesh.connectionsCount()}. Need to disconnect from: ${toDisconnect}`
          )
        }
        Array.from(this.knownPeers.values())
          .filter((peer) => this.mesh.isConnectedTo(peer.id))
          .slice(0, toDisconnect)
          .forEach((peer) => this.mesh.disconnectFrom(peer.id))
      }
    } finally {
      this.updatingNetwork = false
    }
  }
}
