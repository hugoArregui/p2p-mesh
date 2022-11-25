import express from 'express'
import cors from 'cors'
import { RTCPeerConnection } from 'wrtc'
import { PeerToPeerAdapter } from './p2pAdapter'
import { PeerId, PingRequest } from './types'
import { createServerConnection } from './serverConnection'
import { between, decode, encode } from './utils'

require('browser-env')() // eslint-disable-line @typescript-eslint/no-var-requires
require('dotenv').config() // eslint-disable-line @typescript-eslint/no-var-requires
;(global as any).RTCPeerConnection = RTCPeerConnection

async function start() {
  const app: express.Application = express()
  app.use(express.json())
  app.use(cors())

  const conn = await createServerConnection(process.env.SERVER_URL || 'ws://localhost:6000/service')

  const formatLogMessage = (message: string | Error) => {
    return `${conn.id}: ${message}`
  }

  const logger = {
    error: (message: string | Error, ...args: any[]) => {
      console.error(formatLogMessage(message), ...args)
    },
    log: (message: string, ...args: any[]) => {
      console.log(formatLogMessage(message), ...args)
    },
    warn: (message: string, ...args: any[]) => {
      console.warn(formatLogMessage(message), ...args)
    },
    info: (message: string, ...args: any[]) => {
      console.info(formatLogMessage(message), ...args)
    },
    trace: (message: string, ...args: any[]) => {
      console.trace(formatLogMessage(message), ...args)
    }
  }

  const adapter = new PeerToPeerAdapter(conn, logger)
  adapter.connect()

  const pingRequests = new Map<number, PingRequest>()
  const answeredPings = new Set<number>()

  let trace = ''
  let ping = 'No ping'

  function sendTrace() {
    trace = `${conn.id}:${Math.floor(Math.random() * 0xffffffff)}`
    adapter.send(encode(`trace ${trace}`), { reliable: true })
    return trace
  }

  adapter.events.on('DISCONNECTION', () => {
    logger.log('adapter disconnected')
  })

  adapter.events.on('message', ({ data }) => {
    const message = decode(data)
    if (message.startsWith('pong')) {
      const [_, nonceStr, peer] = message.slice(1).split(' ')
      const nonce = parseInt(nonceStr, 10)
      const request = pingRequests.get(nonce)
      if (request) {
        request.responses.push(Date.now() - request.sentTime)
        request.missings.delete(parseInt(peer, 10))
      }
    } else if (message.startsWith('ping')) {
      const [_, nonceStr] = message.slice(1).split(' ')
      const nonce = parseInt(nonceStr, 10)
      if (answeredPings.has(nonce)) {
        return
      }
      answeredPings.add(nonce)
      adapter.send(encode(`pong ${nonce} ${conn.id}`), { reliable: true })
    } else if (message.startsWith('trace')) {
      const [_, id] = message.split(' ')
      trace = id
    }
  })

  setInterval(async () => {
    try {
      const nonce = Math.floor(Math.random() * 0xffffffff)
      const p = {
        targets: new Set<PeerId>(adapter.knownPeers.keys()),
        missings: new Set<PeerId>(adapter.knownPeers.keys()),
        responses: [],
        sentTime: Date.now()
      }
      pingRequests.set(nonce, p)
      setTimeout(() => {
        const delay = p.responses ? p.responses.reduce((a, b) => a + b, 0) / p.responses.length : 0
        const message = `Ping got ${p.responses.length} responses. Avg delay: ${delay}, ${JSON.stringify(
          p.responses
        )}. Targets: ${JSON.stringify(Array.from(p.targets))}, missing: ${JSON.stringify(Array.from(p.missings))}`
        logger.log(message)
        ping = message
      }, 30 * 1000)
      adapter.send(encode(`ping ${nonce}`), { reliable: true })
    } catch (err: any) {
      logger.error('Error sending ping message', err)
    }
  }, 1000 * 60 * between(1, 5))

  app.get('/info', (_req, res) => {
    res.json({ id: conn.id, ping, trace })
  })

  app.get('/performance-trackers', (_req, res) => {
    res.json(adapter.performanceRegistry.asObject())
  })

  app.get('/trace', (_req, res) => {
    const id = sendTrace()
    res.json({ id })
  })

  app.get('/graph', (_req, res) => {
    res.write(adapter.graph.asDot([]))
    res.end()
  })

  app.post('/view-trace', (req, res) => {
    const nodesToPaint = req.body.nodesToPaint
    res.write(adapter.graph.asDot(nodesToPaint))
    res.end()
  })

  app.get('/matrix', (_req, res) => {
    res.write(adapter.graph.asMatrixHTMLTable())
    res.end()
  })

  app.get('/connections', (_req, res) => {
    const connections: any[] = []
    for (const [peer, conn] of adapter.mesh.initiatedConnections) {
      connections.push({ peer, state: conn.instance.connectionState })
    }

    for (const [peer, conn] of adapter.mesh.receivedConnections) {
      connections.push({ peer, state: conn.instance.connectionState })
    }

    const unreachablePeers: PeerId[] = []
    const reachablePeers = adapter.graph.getReachablePeers()
    for (const peerId of adapter.knownPeers.keys()) {
      if (!reachablePeers.has(peerId)) {
        unreachablePeers.push(peerId)
      }
    }

    res.json({
      knownPeers: Array.from(adapter.knownPeers.keys()),
      connections,
      unreachablePeers
    })
  })

  const port = parseInt(process.env.PORT || '2000', 10)
  app.listen(port, () => {
    console.log(`API ready in :${port}`)
  })
}

start().catch(console.error)
