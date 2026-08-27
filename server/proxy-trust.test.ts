import { describe, expect, it, vi } from 'vitest'

import {
  isTrustedProxy,
  parseTrustedProxies,
  resolveClientAddress,
} from './proxy-trust'

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

  it('preserves supported addresses and boundary IPv4 CIDR ranges', () => {
    const entries = [
      '::1',
      '::ffff:10.1.2.3',
      '10.1.2.3',
      '0.0.0.0/0',
      '10.1.2.3/32',
    ]
    const onInvalid = vi.fn()
    expect(parseTrustedProxies(entries.join(','), onInvalid)).toEqual(entries)
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it.each([
    'fe80::/64',
    'not-an-ip',
    'localhost',
    '999.0.0.0',
    '10.0.0.0/33',
    '10.0.0.0/-8',
    '10.0.0.0/',
    '10.0.0.0/8/24',
    'not-an-ip/8',
    '999.0.0.0/8',
  ])('rejects and reports unsupported entry %s', (entry) => {
    const onInvalid = vi.fn()
    expect(parseTrustedProxies(` , ${entry}, 10.0.0.1, `, onInvalid)).toEqual([
      '10.0.0.1',
    ])
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith(entry)
    expect(parseTrustedProxies(entry)).toEqual([])
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

describe('resolveClientAddress', () => {
  const trusted = ['10.0.0.0/8', '::1']

  it('ignores forwarding headers from an untrusted peer', () => {
    expect(resolveClientAddress('203.0.113.7', '198.51.100.9', trusted)).toBe(
      '203.0.113.7',
    )
  })

  it('ignores a spoofed prefix before the nearest untrusted hop', () => {
    expect(
      resolveClientAddress(
        '10.0.0.1',
        '198.51.100.9, 203.0.113.7, 10.0.0.2',
        trusted,
      ),
    ).toBe('203.0.113.7')
  })

  it('preserves header order across multiple header values', () => {
    expect(
      resolveClientAddress(
        '10.0.0.1',
        ['198.51.100.9', '203.0.113.7, 10.0.0.2'],
        trusted,
      ),
    ).toBe('203.0.113.7')
  })

  it('supports IPv6 clients and trusted proxy hops', () => {
    expect(resolveClientAddress('::1', '2001:db8::7, ::1', trusted)).toBe(
      '2001:db8::7',
    )
  })

  it.each([
    ['203.0.113.7:12345', '203.0.113.7'],
    ['203.0.113.7:54321', '203.0.113.7'],
    ['[2001:db8::7]:443', '2001:db8::7'],
    ['2001:db8::7:443', '2001:db8::7:443'],
  ])('normalizes supported forwarded endpoint %s', (forwarded, expected) => {
    expect(resolveClientAddress('10.0.0.1', forwarded, trusted)).toBe(expected)
  })

  it('walks trusted proxy endpoints with ports while ignoring a spoofed prefix', () => {
    expect(
      resolveClientAddress(
        '10.0.0.1',
        '198.51.100.9, 203.0.113.7:12345, 10.0.0.2:443',
        trusted,
      ),
    ).toBe('203.0.113.7')
  })

  it.each([
    '203.0.113.7:65536',
    '203.0.113.7:-1',
    '203.0.113.7:abc',
    '[2001:db8::7]',
    '[203.0.113.7]:443',
    'example.com:443',
  ])('fails closed for malformed endpoint %s', (forwarded) => {
    expect(resolveClientAddress('10.0.0.1', forwarded, trusted)).toBe(
      '10.0.0.1',
    )
  })

  it.each([
    undefined,
    '',
    ' ',
    'not-an-ip',
    '203.0.113.7, invalid',
    '10.0.0.2',
  ])(
    'falls back to the peer when the trusted suffix has no valid client: %s',
    (forwarded) => {
      expect(resolveClientAddress('10.0.0.1', forwarded, trusted)).toBe(
        '10.0.0.1',
      )
    },
  )
})
