export type PeerId = number

export type PingRequest = {
  responses: number[]
  sentTime: number
  targets: Set<PeerId>
  missings: Set<PeerId>
}

export type ILogger = {
  error(message: string | Error, ...args: any[]): void
  log(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  trace(message: string, ...args: any[]): void
}

export type SendHints = { reliable: boolean }

export type CommsAdapterEvents = {
  DISCONNECTION: AdapterDisconnectedEvent
  PEER_DISCONNECTED: PeerDisconnectedEvent
  message: AdapterMessageEvent
  error: Error
}

export type AdapterDisconnectedEvent = {
  // Optional error
  error?: Error
}

// PEER_DISCONNECTED
export type PeerDisconnectedEvent = {
  peerId: PeerId
}

// message
export type AdapterMessageEvent = {
  peerId: PeerId
  data: Uint8Array
}
