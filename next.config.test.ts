import { describe, expect, it, vi } from 'vitest'

vi.mock('node:os', () => {
  const networkInterfaces = () => ({
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [
      { address: '192.168.1.42', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    en1: [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
    disconnected: undefined,
  })
  return { networkInterfaces, default: { networkInterfaces } }
})

import nextConfig from './next.config'

describe('development origin configuration', () => {
  it('allows exact local IPv4 hosts while preserving existing development hosts', () => {
    expect(nextConfig.allowedDevOrigins).toEqual([
      'terminal.local',
      '127.0.0.1',
      '192.168.1.42',
      '10.0.0.5',
    ])
  })

  it('does not allow hostname wildcards or unrelated LAN addresses', () => {
    expect(
      nextConfig.allowedDevOrigins?.some((host) => host.includes('*')),
    ).toBe(false)
    expect(nextConfig.allowedDevOrigins).not.toContain('192.168.1.99')
    expect(nextConfig.allowedDevOrigins).not.toContain(
      '192.168.attacker.example',
    )
  })
})
