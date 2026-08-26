export function parseTrustedProxies(value: string | undefined): string[] {
  return (
    value
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  )
}

export function isTrustedProxy(
  address: string,
  trustedProxies: Iterable<string>,
): boolean {
  for (const entry of trustedProxies) {
    if (entry === address) return true
    if (matchesIpv4Cidr(address, entry)) return true
  }
  return false
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
