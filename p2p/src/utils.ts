import { Edge } from './proto/p2p.gen'
import { PeerId } from './types'

export function between(min: number, max: number) {
  return Math.floor(Math.random() * (max - min) + min)
}

export function pickRandom<T>(ls: T[], count: number): T[] {
  let len = ls.length
  if (len <= count) {
    return ls
  }

  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * len)
    const randomElement = ls[randomIndex]
    ls[i] = ls[len - 1]
    ls[len - 1] = randomElement
    len--
  }

  return ls.slice(-count)
}

export function nextSteps(edges: Edge[], peerId: PeerId): Set<PeerId> {
  const response: Set<PeerId> = new Set()
  for (const edge of edges) {
    if (edge.u === peerId) {
      response.add(edge.v)
    }
  }
  return response
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encode(s: string): Uint8Array {
  return encoder.encode(s)
}

export function decode(data: Uint8Array): string {
  return decoder.decode(data)
}
