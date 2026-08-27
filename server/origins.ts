export function isPrivateNetworkOrigin(origin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const rawHostname = parsed.hostname.toLowerCase()
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '::1' ||
    isPrivateIpv4(hostname) ||
    isUniqueLocalIpv6(hostname)
  )
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.')
  if (octets.length !== 4) return false
  const values: number[] = []
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return false
    const value = Number(octet)
    if (value > 255) return false
    values.push(value)
  }
  const [first, second] = values
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function isUniqueLocalIpv6(hostname: string): boolean {
  return (
    hostname.includes(':') &&
    (hostname.startsWith('fc') || hostname.startsWith('fd'))
  )
}
