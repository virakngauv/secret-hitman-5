import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  generateClientToken,
  getClientToken,
  getOrCreateClientToken,
  saveClientToken,
  subscribeToClientToken,
} from './player-session'

describe('player session storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('keeps one client token in persistent browser storage', () => {
    const token = 'a'.repeat(32)
    saveClientToken(token)

    expect(getClientToken()).toBe(token)
    expect(window.localStorage.getItem('secret-hitman-5:client-token')).toBe(
      token,
    )
    expect(window.sessionStorage).toHaveLength(0)
  })

  it('reuses one token across tabs and rooms in the same browser', () => {
    const firstToken = getOrCreateClientToken()
    const secondToken = getOrCreateClientToken()

    expect(firstToken).toMatch(/^[0-9a-f]{32}$/)
    expect(secondToken).toBe(firstToken)
  })

  it('refreshes for token changes and storage clears, then unsubscribes', () => {
    const onChange = vi.fn()
    const unsubscribe = subscribeToClientToken(onChange)
    const dispatchStorage = (
      key: string | null,
      storageArea = window.localStorage,
    ) => window.dispatchEvent(new StorageEvent('storage', { key, storageArea }))
    try {
      dispatchStorage('secret-hitman-5:client-token')
      dispatchStorage(null)
      expect(onChange).toHaveBeenCalledTimes(2)
      dispatchStorage('unrelated-key')
      dispatchStorage(null, window.sessionStorage)
      expect(onChange).toHaveBeenCalledTimes(2)
      saveClientToken('a'.repeat(32))
      expect(onChange).toHaveBeenCalledTimes(3)
      unsubscribe()
      dispatchStorage(null)
      saveClientToken('b'.repeat(32))
      expect(onChange).toHaveBeenCalledTimes(3)
    } finally {
      unsubscribe()
    }
  })

  it('rejects malformed tokens before persisting them', () => {
    expect(() => saveClientToken('not-a-token')).toThrow(
      'Invalid client token.',
    )
    expect(window.localStorage).toHaveLength(0)
  })

  it('generates a 128-bit hexadecimal token', () => {
    expect(generateClientToken()).toMatch(/^[0-9a-f]{32}$/)
  })
})
