// Resolves the hostname passed to `next dev` in the dev scripts.
// HOST wins if set (the game server receives the same value from the dev
// script, so one variable controls both); otherwise the machine's LAN IPv4 is
// used so the printed Network URL is one other devices can reach. The
// catch-all addresses 0.0.0.0 and :: expand to the LAN IPv4 for the same
// reason — 0.0.0.0 itself is not routable from them. 127.0.0.1 is the
// last-resort fallback when no LAN address exists.
import { networkInterfaces } from 'node:os'

function isLanIpv4(address) {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false
  const [first, second] = octets
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function firstLanIpv4() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (
        address.family === 'IPv4' &&
        !address.internal &&
        isLanIpv4(address.address)
      ) {
        return address.address
      }
    }
  }
  return undefined
}

const lanIp = firstLanIpv4()
const requested = process.env.HOST?.trim() || lanIp || '127.0.0.1'
console.log(
  requested === '0.0.0.0' || requested === '::'
    ? (lanIp ?? requested)
    : requested,
)
