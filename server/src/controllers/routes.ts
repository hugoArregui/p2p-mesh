import * as uWS from 'uWebSockets.js'
import { GlobalContext, WebSocket } from '../types'
import { Writer } from 'protobufjs/minimal'
import { ServerMessage, ClientMessage } from '../proto/server.gen'

const VERBOSE = false

// we use a shared writer to reduce allocations and leverage its allocation pool
const writer = new Writer()

export function craftMessage(packet: ServerMessage): Uint8Array {
  writer.reset()
  ServerMessage.encode(packet, writer)
  return writer.finish()
}

export async function setupRouter({ app, components }: GlobalContext): Promise<void> {
  const { logs, metrics, config } = components
  const logger = logs.getLogger('server')

  const commitHash = await config.getString('COMMIT_HASH')
  const status = JSON.stringify({ commitHash })

  let connectionIndex = 1
  app
    .get('/status', async (res) => {
      res.end(status)
    })
    .get('/metrics', async (res) => {
      const body = await (metrics as any).registry.metrics()
      res.end(body)
    })
    .ws('/service', {
      compression: uWS.DISABLED,
      open: (_ws) => {
        components.metrics.increment('server_connections', {})
        const ws = _ws as any as WebSocket
        ws.id = connectionIndex++
        const welcomeMessage = craftMessage({
          message: {
            $case: 'welcome',
            welcome: { id: ws.id }
          }
        })
        if (ws.send(welcomeMessage, true) !== 1) {
          logger.error('Closing connection: cannot send welcome')
          ws.close()
          return
        }

        logger.debug(`Welcome sent`, { id: ws.id })
      },
      drain: (ws) => {
        components.metrics.observe('server_ws_buffered_amount', { id: ws.id }, ws.getBufferedAmount())
      },
      message: (_ws, data, isBinary) => {
        if (!isBinary) {
          logger.log('protocol error: data is not binary')
          return
        }

        const ws = _ws as any as WebSocket

        metrics.increment('server_in_messages', {})
        metrics.increment('server_in_bytes', {}, data.byteLength)

        const { message } = ClientMessage.decode(Buffer.from(data))
        if (!message) {
          return
        }
        switch (message.$case) {
          case 'publishRequest': {
            const {
              publishRequest: { topics, payload }
            } = message

            if (VERBOSE) {
              logger.debug(`${ws.id}: broadcasting message of ${JSON.stringify(topics)}}`)
            }

            for (const topic of topics) {
              const subscriptionMessage = craftMessage({
                message: {
                  $case: 'topicMessage',
                  topicMessage: {
                    sender: ws.id,
                    topic: topic,
                    body: payload
                  }
                }
              })

              const n = app.numSubscribers(topic)
              metrics.increment('server_out_messages', {}, n)
              metrics.increment('server_out_bytes', {}, subscriptionMessage.byteLength * n)
              app.publish(topic, subscriptionMessage, true)
            }
            break
          }
          case 'subscribeRequest': {
            if (VERBOSE) {
              logger.debug(`${ws.id}: subscribed to ${message.subscribeRequest.topic}`)
            }
            ws.subscribe(message.subscribeRequest.topic)
            break
          }
          case 'unsubscribeRequest': {
            if (VERBOSE) {
              logger.debug(`${ws.id}: unsubscribed from ${message.unsubscribeRequest.topic}`)
            }
            ws.unsubscribe(message.unsubscribeRequest.topic)
            break
          }
        }
      },
      close: (_ws) => {
        logger.log('WS closed')
        components.metrics.decrement('server_connections', {})
      }
    })
}
