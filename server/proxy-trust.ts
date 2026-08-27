import { isIP, isIPv4 } from 'node:net'

/** Only use behind an ingress that overwrites this header, never on a direct server. */
export function resolveDigitalOceanClientAddress(
  directAddress: string,
  connectingIp: string | string[] | undefined,
): string {
  return typeof connectingIp === 'string' && isIP(connectingIp.trim())
    ? connectingIp.trim()
    : directAddress
}

export function parseTrustedProxies(
  value: string | undefined,
  onInvalidEntry?: (entry: string) => void,
): string[] {
  const entries =
    value
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  return entries.filter((entry) => {
    if (isSupportedTrustedProxyEntry(entry)) return true
    onInvalidEntry?.(entry)
    return false
  })
}

/** Supports exact IP addresses and IPv4 CIDR ranges, not IPv6 CIDR ranges. */
function isSupportedTrustedProxyEntry(entry: string): boolean {
  if (isIP(entry)) return true
  const separator = entry.indexOf('/')
  if (separator === -1) return false
  const bitsText = entry.slice(separator + 1)
  return (
    isIPv4(entry.slice(0, separator)) &&
    /^\d{1,2}$/.test(bitsText) &&
    Number(bitsText) <= 32
  )
}

export function isTrustedProxy(
  address: string,
  trustedProxies: Iterable<string>,
): boolean {
  const normalizedAddress = normalizeMappedIpv4(address)
  for (const entry of trustedProxies) {
    if (normalizeMappedIpv4(entry) === normalizedAddress) return true
    if (matchesIpv4Cidr(normalizedAddress, entry)) return true
  }
  return false
}

/** Canonical URL parsing handles dotted, hexadecimal, and expanded mapped IPv6. */
function normalizeMappedIpv4(address: string): string {
  if (isIP(address) !== 6) return address
  try {
    const host = new URL(`http://[${address}]/`).hostname
    const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(host)
    if (!mapped) return address
    const high = Number.parseInt(mapped[1], 16)
    const low = Number.parseInt(mapped[2], 16)
    return [high >>> 8, high & 255, low >>> 8, low & 255].join('.')
  } catch {
    return address
  }
}

/** Walks back through trusted proxies, ignoring any client-supplied prefix. */
export function resolveClientAddress(
  directAddress: string,
  forwarded: string | string[] | undefined,
  trustedProxies: string[],
): string {
  if (!isTrustedProxy(directAddress, trustedProxies)) return directAddress

  const hops = (
    Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')
  )
    .split(',')
    .map((hop) => hop.trim())
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = parseForwardedAddress(hops[index])
    // Fail closed rather than accepting arbitrary rate-limit keys.
    if (!hop) return directAddress
    if (!isTrustedProxy(hop, trustedProxies)) return hop
  }
  return directAddress
}

/** Accepts raw IPs, IPv4:port, and bracketed IPv6:port, never hostnames. */
function parseForwardedAddress(value: string): string | null {
  if (isIP(value)) return value
  const endpoint = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(value)
  if (!endpoint || Number(endpoint[3]) > 65_535) return null
  const address = endpoint[1] ?? endpoint[2]
  const expectedFamily = endpoint[1] ? 6 : 4
  return isIP(address) === expectedFamily ? address : null
}

function matchesIpv4Cidr(address: string, entry: string): boolean {
  const separator = entry.indexOf('/')
  if (separator === -1) return false
  const bitsText = entry.slice(separator + 1)
  if (!/^\d{1,2}$/.test(bitsText)) return false

  const bits = Number(bitsText)
  if (bits > 32) return false
  const addressValue = ipv4ToNumber(address)
  const baseValue = ipv4ToNumber(entry.slice(0, separator))
  if (addressValue === null || baseValue === null) return false

  const mask = bits === 0 ? 0 : (0xffff_ffff << (32 - bits)) >>> 0
  return (addressValue & mask) === (baseValue & mask)
}

function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result >>> 0
}
