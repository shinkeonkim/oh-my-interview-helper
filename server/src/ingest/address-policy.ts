import { isIP } from "node:net"

const ipv4Parts = (address: string): readonly number[] | undefined => {
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return undefined
  return parts
}

const unsafeIpv4 = (address: string): boolean => {
  const parts = ipv4Parts(address)
  if (parts === undefined) return true
  const [first, second] = parts
  if (first === undefined || second === undefined) return true
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0)
  )
}

const ipv6Bytes = (source: string): Uint8Array | undefined => {
  const address = source.replace(/^\[|\]$/g, "").toLowerCase()
  const halves = address.split("::")
  if (halves.length > 2) return undefined
  const left = halves[0] === "" ? [] : halves[0]?.split(":")
  const right = halves[1] === "" || halves.length === 1 ? [] : halves[1]?.split(":")
  if (left === undefined || right === undefined || left.length + right.length > 8) return undefined
  const segments = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
  if (segments.length !== 8 || segments.some((segment) => !/^[0-9a-f]{1,4}$/.test(segment)))
    return undefined
  const bytes = new Uint8Array(16)
  for (const [index, segment] of segments.entries()) {
    const value = Number.parseInt(segment, 16)
    bytes[index * 2] = value >> 8
    bytes[index * 2 + 1] = value & 0xff
  }
  return bytes
}

const matchesPrefix = (address: Uint8Array, prefix: readonly number[], bits: number): boolean => {
  for (let index = 0; index < Math.floor(bits / 8); index += 1) {
    if (address[index] !== prefix[index]) return false
  }
  const remainder = bits % 8
  if (remainder === 0) return true
  const mask = (0xff << (8 - remainder)) & 0xff
  return (
    ((address[Math.floor(bits / 8)] ?? 0) & mask) === ((prefix[Math.floor(bits / 8)] ?? 0) & mask)
  )
}

const unsafeIpv6 = (address: string): boolean => {
  const bytes = ipv6Bytes(address)
  if (bytes === undefined) return true
  const mapped = matchesPrefix(bytes, [...Array(10).fill(0), 0xff, 0xff], 96)
  if (mapped) return unsafeIpv4(Array.from(bytes.slice(12)).join("."))
  return (
    matchesPrefix(bytes, Array(16).fill(0), 128) ||
    matchesPrefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 128) ||
    matchesPrefix(bytes, [0xfc], 7) ||
    matchesPrefix(bytes, [0xfe, 0x80], 10) ||
    matchesPrefix(bytes, [0xff], 8) ||
    matchesPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) ||
    matchesPrefix(bytes, [0x20, 0x01], 23) ||
    matchesPrefix(bytes, [0x20, 0x02], 16) ||
    matchesPrefix(bytes, [0x01, 0x00], 64)
  )
}

export const unsafeAddress = (address: string): boolean => {
  const family = isIP(address.replace(/^\[|\]$/g, ""))
  if (family === 4) return unsafeIpv4(address)
  if (family === 6) return unsafeIpv6(address)
  return true
}
