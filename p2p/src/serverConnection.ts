import { Writer } from 'protobufjs/minimal'
import { Emitter } from 'mitt'
import mitt from 'mitt'
import { PeerId } from './types'
import { MessageEvent, WebSocket } from 'ws'
import { ClientMessage, ServerMessage } from './proto/server.gen'

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
}

export function createServerConnection(url: string): Promise<ServerConnection> {
  const events = mitt<MessagingEvents>()
  const subscriptions = new Map<string, Handler>()
  let id: number | undefined = undefined
  return new Promise((resolve, reject) => {
    try {
      let ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.addEventListener('close', (event) => {
        console.log(id, event.code, event.reason, event.target, event.type, event.wasClean)
        events.emit('DISCONNECTION', {})
      })
      ws.addEventListener('error', (err: any) => {
        console.error(id, err)
      })

      function subscribe(topic: string, handler: Handler) {
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

      function publish(topics: string[], payload: Uint8Array) {
        ws.send(
          craftMessage({
            message: {
              $case: 'publishRequest',
              publishRequest: { topics, payload }
            }
          })
        )
      }

      ws.addEventListener('message', (event: MessageEvent) => {
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
              id
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
