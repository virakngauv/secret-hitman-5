import { describe, expect, it } from 'vitest'

import { fingerprintClientToken } from './token-fingerprint'

describe('fingerprintClientToken', () => {
  it('is deterministic for one token', () => {
    expect(fingerprintClientToken('a'.repeat(32))).toBe(
      fingerprintClientToken('a'.repeat(32)),
    )
  })

  it('distinguishes tokens without retaining the raw credential', () => {
    const first = fingerprintClientToken('a'.repeat(32))
    const second = fingerprintClientToken('b'.repeat(32))

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toBe(second)
    expect(first).not.toContain('a'.repeat(32))
  })
})
