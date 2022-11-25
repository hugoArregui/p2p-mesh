import mitt from 'mitt'

import { ILogger, PeerId } from './types'
import { Writer } from 'protobufjs/minimal'
import { Mesh } from './mesh'
import { CommsAdapterEvents, SendHints } from './types'
import { createConnectionsGraph, Graph } from './graph'
import { createPerformanceRegistry } from './performance'
import { MeshUpdateMessage, Packet } from './proto/p2p.gen'
import { ServerConnection } from './serverConnection'
import { nextSteps, pickRandom } from './utils'

const MESH_UPDATE_FREQ = 60 * 1000
const DEBUG_SEND_FAILURE = false
const DEBUG_MESH = true
const DEBUG_UPDATE_NETWORK = false

export type KnownPeerData = {
  id: PeerId
  lastMeshUpdate?: number
}

const UPDATE_NETWORK_INTERVAL = 30000
const DEFAULT_TARGET_CONNECTIONS = 4
const DEFAULT_MAX_CONNECTIONS = 6

// shared writer to leverage pools
const writer = new Writer()

function craftMessage(packet: Packet): Uint8Array {
  writer.reset()
  Packet.encode(packet as any, writer)
  return writer.finish()
}

function craftUpdateMessage(update: MeshUpdateMessage): Uint8Array {
  writer.reset()
  MeshUpdateMessage.encode(update as any, writer)
  return writer.finish()
}

export class PeerToPeerAdapter {
  public readonly mesh: Mesh
  public readonly events = mitt<CommsAdapterEvents>()
  public knownPeers = new Map<PeerId, KnownPeerData>()

  private updatingNetwork: boolean = false
  private updateNetworkTimeoutId: ReturnType<typeof setTimeout> | null = null
  private shareMeshInterval: ReturnType<typeof setInterval> | null = null
  private disposed: boolean = false

  private listeners: { close(): void }[] = []
  private peerId: PeerId

  private meshStatusIndex = 0
  public performanceRegistry = createPerformanceRegistry()

  public graph: Graph

  constructor(private serverConn: ServerConnection, private logger: ILogger) {
    this.peerId = serverConn.id
    this.graph = createConnectionsGraph(this.performanceRegistry, this.peerId)

    this.mesh = new Mesh(this.serverConn, this.peerId, {
      logger: this.logger,
      packetHandler: this.handlePeerPacket.bind(this),
      shouldAcceptOffer: (peerId: PeerId) => {
        if (this.disposed) {
          return false
        }

        if (this.mesh.connectionsCount() >= DEFAULT_MAX_CONNECTIONS) {
          if (DEBUG_MESH) {
            this.logger.log('Rejecting offer, already enough connections')
          }
          return false
        }

        return true
      },
      onConnectionEstablished: (peerId: PeerId) => {
        this.meshStatusIndex++

        const tracker = this.performanceRegistry.getProcessPerformanceTracker('onConnectionEstablished:addConnection')
        tracker.startTimer()
        this.graph.addConnection(this.peerId, peerId)
        tracker.stopTimer()

        this.sendMeshUpdate({
          source: this.peerId,
          data: {
            $case: 'connectedTo',
            connectedTo: peerId
          }
        })
      },
      onConnectionClosed: (peerId: PeerId) => {
        this.meshStatusIndex++
        const tracker = this.performanceRegistry.getProcessPerformanceTracker('onConnectionClosed:removeConnection')
        tracker.startTimer()
        this.graph.removeConnection(this.peerId, peerId)
        tracker.stopTimer()
        this.sendMeshUpdate({
          source: this.peerId,
          data: {
            $case: 'disconnectedFrom',
            disconnectedFrom: peerId
          }
        })
      }
    })

    this.sendMeshUpdate({
      source: this.peerId,
      data: {
        $case: 'status',
        status: {
          id: this.meshStatusIndex,
          connectedTo: this.mesh.connectedPeerIds()
        }
      }
    })

    this.scheduleUpdateNetwork()

    this.shareMeshInterval = setInterval(() => {
      if (this.disposed) {
        return
      }
      this.sendMeshUpdate({
        source: this.peerId,
        data: {
          $case: 'status',
          status: {
            id: this.meshStatusIndex,
            connectedTo: this.mesh.connectedPeerIds()
          }
        }
      })
    }, MESH_UPDATE_FREQ)
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
          const tracker = this.performanceRegistry.getProcessPerformanceTracker('onMeshChanged:removeConnection')
          tracker.startTimer()
          this.graph.removeConnection(source, data.disconnectedFrom)
          tracker.stopTimer()
        }
        break
      }
      case 'connectedTo': {
        if (data.connectedTo !== this.peerId) {
          const tracker = this.performanceRegistry.getProcessPerformanceTracker('onMeshChanged:addConnection')
          tracker.startTimer()
          this.graph.addConnection(source, data.connectedTo)
          tracker.stopTimer()
        }
        break
      }
      case 'status': {
        if (sourceData.lastMeshUpdate && data.status.id <= sourceData.lastMeshUpdate) {
          return
        }

        const tracker = this.performanceRegistry.getProcessPerformanceTracker('onMeshChanged:status')
        tracker.startTimer()
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
        tracker.stopTimer()
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

    for (const listener of this.listeners) {
      listener.close()
    }

    this.knownPeers.clear()
    await this.mesh.dispose()
    this.events.emit('DISCONNECTION', {})
  }

  async send(payload: Uint8Array, { reliable }: SendHints): Promise<void> {
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
      if (!this.mesh.sendPacketToPeer(neighbor, packet, reliable)) {
        this.logger.warn(
          `cannot send package to ${neighbor}, ${this.mesh.isConnectedTo(neighbor)} ${this.graph.isConnectedTo(
            neighbor
          )} `
        )
      }
    }

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

  private async handlePeerPacket(data: Uint8Array, reliable: boolean) {
    if (this.disposed) return

    const packet = Packet.decode(data)

    this.events.emit('message', {
      peerId: packet.source,
      data: packet.payload
    })

    const peersToSend: Set<PeerId> = nextSteps(packet.edges, this.peerId)
    for (const neighbor of peersToSend) {
      if (!this.mesh.sendPacketToPeer(neighbor, data, reliable) && DEBUG_SEND_FAILURE) {
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
        DEFAULT_TARGET_CONNECTIONS - this.mesh.connectedCount(),
        DEFAULT_MAX_CONNECTIONS - this.mesh.connectionsCount()
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
      const toDisconnect = this.mesh.connectedCount() - DEFAULT_MAX_CONNECTIONS
      if (toDisconnect > 0) {
        if (DEBUG_UPDATE_NETWORK) {
          this.logger.log(
            `Too many connections ${this.mesh.connectionsCount()}. Need to disconnect from: ${toDisconnect}`
          )
        }
        Array.from(this.knownPeers.values())
          .filter((peer) => this.mesh.isConnectedTo(peer.id))
          .slice(0, toDisconnect)
          .forEach((peer) => this.disconnectFrom(peer.id))
      }
    } finally {
      this.updatingNetwork = false
    }
  }

  private disconnectFrom(peerId: PeerId) {
    this.mesh.disconnectFrom(peerId)
  }

  private sendMeshUpdate(update: MeshUpdateMessage) {
    this.serverConn.publish([`mesh`], craftUpdateMessage(update))
  }
}
