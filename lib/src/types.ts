export const MESH_UPDATE_FREQ = 60 * 1000
export const UPDATE_NETWORK_INTERVAL = 30000
export const PEER_CONNECT_TIMEOUT = 3500

export const defaultIceServers = [{ urls: 'stun:stun.l.google.com:19302' }]

export type PeerId = number

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
