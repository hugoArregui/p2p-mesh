export function between(min: number, max: number) {
  return Math.floor(Math.random() * (max - min) + min)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encode(s: string): Uint8Array {
  return encoder.encode(s)
}

export function decode(data: Uint8Array): string {
  return decoder.decode(data)
}
