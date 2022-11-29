import { Writer } from 'protobufjs/minimal'
import { Emitter } from 'mitt'
import mitt from 'mitt'
import { PeerId } from './types'
import { ClientMessage, ServerMessage } from './proto/server.gen'
import { craftUpdateMessage } from './utils'

const writer = new Writer()

function craftMessage(message: ClientMessage): Uint8Array {
  writer.reset()
  ClientMessage.encode(message as any, writer)
  return writer.finish()
}

export type Handler = (sender: PeerId, message: Uint8Array) => void

export type MessagingEvents = {
  DISCONNECTION: { error?: Error }
}

export type ServerConnection = {
  id: number
  events: Emitter<MessagingEvents>
  subscribe: (topic: string, handler: Handler) => void
  publish: (topics: string[], payload: Uint8Array) => void
  publishConnectionEstablishedChange: (target: PeerId) => void
  publishConnectionClosedChange: (target: PeerId) => void
  publishConnectionStatus: (meshStatusIndex: number, connectedTo: PeerId[]) => void
}

export type ServerConfig = {
  url: string
  prefix: string
}

export function createServerConnection({ url, prefix }: ServerConfig): Promise<ServerConnection> {
  const events = mitt<MessagingEvents>()
  const subscriptions = new Map<string, Handler>()
  let id: number | undefined = undefined
  return new Promise((resolve, reject) => {
    try {
      let ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.addEventListener('close', (event) => {
        console.log(`[${id}] socked closed, code: ${event.code}`)
        events.emit('DISCONNECTION', {})
      })
      ws.addEventListener('error', (err: any) => {
        console.error(id, err)
      })

      function subscribe(t: string, handler: Handler) {
        const topic = `${prefix}.${t}`
        subscriptions.set(topic, handler)
        ws.send(
          craftMessage({
            message: {
              $case: 'subscribeRequest',
              subscribeRequest: { topic }
            }
          })
        )
      }

      function publish(ts: string[], payload: Uint8Array) {
        const topics = ts.map((t) => `${prefix}.${t}`)
        ws.send(
          craftMessage({
            message: {
              $case: 'publishRequest',
              publishRequest: { topics, payload }
            }
          })
        )
      }

      function publishConnectionEstablishedChange(target: PeerId) {
        publish(
          ['mesh'],
          craftUpdateMessage({
            source: id!,
            data: {
              $case: 'connectedTo',
              connectedTo: target
            }
          })
        )
      }

      function publishConnectionClosedChange(target: PeerId) {
        publish(
          ['mesh'],
          craftUpdateMessage({
            source: id!,
            data: {
              $case: 'disconnectedFrom',
              disconnectedFrom: target
            }
          })
        )
      }

      function publishConnectionStatus(meshStatusIndex: number, connectedTo: PeerId[]) {
        publish(
          ['mesh'],
          craftUpdateMessage({
            source: id!,
            data: {
              $case: 'status',
              status: {
                id: meshStatusIndex,
                connectedTo
              }
            }
          })
        )
      }

      ws.addEventListener('message', (event) => {
        const payload = new Uint8Array(event.data as any)
        const { message } = ServerMessage.decode(payload)
        if (!message) {
          return
        }
        switch (message.$case) {
          case 'welcome': {
            id = message.welcome.id
            resolve({
              events,
              subscribe,
              publish,
              id,
              publishConnectionEstablishedChange,
              publishConnectionClosedChange,
              publishConnectionStatus
            })
            break
          }
          case 'topicMessage': {
            const {
              topicMessage: { topic, sender, body }
            } = message
            const handler = subscriptions.get(topic)
            if (handler) {
              handler(sender, body)
            }
            break
          }
        }
      })
    } catch (err) {
      return reject(err)
    }
  })
}
