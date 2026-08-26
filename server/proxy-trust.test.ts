import { describe, expect, it } from 'vitest'

import { isTrustedProxy, parseTrustedProxies } from './proxy-trust'

describe('parseTrustedProxies', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(parseTrustedProxies(' 10.0.0.0/8 , ::1 ,, 192.168.1.1 ')).toEqual([
      '10.0.0.0/8',
      '::1',
      '192.168.1.1',
    ])
  })

  it('returns an empty list for missing values', () => {
    expect(parseTrustedProxies(undefined)).toEqual([])
    expect(parseTrustedProxies('  ')).toEqual([])
  })
})

describe('isTrustedProxy', () => {
  it('matches exact IPv4 and IPv6 addresses', () => {
    expect(isTrustedProxy('10.1.2.3', ['10.1.2.3', '::1'])).toBe(true)
    expect(isTrustedProxy('::1', ['10.1.2.3', '::1'])).toBe(true)
    expect(isTrustedProxy('10.1.2.4', ['10.1.2.3', '::1'])).toBe(false)
  })

  it('matches addresses inside an IPv4 CIDR range', () => {
    expect(isTrustedProxy('10.244.3.9', ['10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxy('172.16.0.1', ['10.0.0.0/8'])).toBe(false)
    expect(isTrustedProxy('192.168.1.129', ['192.168.1.128/25'])).toBe(true)
    expect(isTrustedProxy('192.168.1.127', ['192.168.1.128/25'])).toBe(false)
  })

  it('treats a /32 CIDR as an exact IPv4 match', () => {
    expect(isTrustedProxy('10.1.2.3', ['10.1.2.3/32'])).toBe(true)
    expect(isTrustedProxy('10.1.2.4', ['10.1.2.3/32'])).toBe(false)
  })

  it('treats a /0 CIDR as the whole IPv4 space', () => {
    expect(isTrustedProxy('203.0.113.7', ['0.0.0.0/0'])).toBe(true)
    expect(isTrustedProxy('::1', ['0.0.0.0/0'])).toBe(false)
  })

  it('ignores malformed entries instead of trusting broadly', () => {
    expect(isTrustedProxy('10.1.2.3', ['10.0.0.0/33'])).toBe(false)
    expect(isTrustedProxy('10.1.2.3', ['10.0.0.0/-8'])).toBe(false)
    expect(isTrustedProxy('10.1.2.3', ['not-an-ip/8'])).toBe(false)
    expect(isTrustedProxy('10.1.2.3', ['999.0.0.0/8'])).toBe(false)
    expect(isTrustedProxy('10.1.2.3', ['10.0.0.0/'])).toBe(false)
  })

  it('never CIDR-matches non-IPv4 addresses', () => {
    expect(isTrustedProxy('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(false)
    expect(isTrustedProxy('fe80::1', ['fe80::/64'])).toBe(false)
  })
})
