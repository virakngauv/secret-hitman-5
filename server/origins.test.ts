import { describe, expect, it } from 'vitest'

import { isPrivateNetworkOrigin } from './origins'

describe('isPrivateNetworkOrigin', () => {
  it.each([
    'http://localhost:3000',
    'https://localhost:3000',
    'http://app.localhost:3100',
    'http://127.0.0.1:3000',
    'http://127.0.0.2:3000',
    'http://[::1]:3000',
    'http://10.0.0.5:3000',
    'http://172.16.0.1:8100',
    'http://172.31.255.255:3000',
    'http://192.168.1.172:3000',
    'http://my-macbook.local:3000',
    'http://[fd12:3456:789a::1]:3000',
    'HTTP://LOCALHOST:3000',
  ])('accepts %s', (origin) => {
    expect(isPrivateNetworkOrigin(origin)).toBe(true)
  })

  it.each([
    'https://secret-hitman-5.vercel.app',
    'http://8.8.8.8:3000',
    'http://11.0.0.1:3000',
    'http://172.32.0.1:3000',
    'http://192.169.0.1:3000',
    'http://256.0.0.1:3000',
    'http://10.0.0.1.attacker.example:3000',
    'http://localhost.attacker.example:3000',
    'http://local:3000',
    'https://example.com',
    'file:///etc/passwd',
    'not a url',
    '::1',
    '',
  ])('rejects %s', (origin) => {
    expect(isPrivateNetworkOrigin(origin)).toBe(false)
  })
})
