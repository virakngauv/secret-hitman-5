import { createHash } from 'node:crypto'

/**
 * Maps a private client token to the non-reversible key stored in room-scoped
 * deny sets, so servers never retain a reusable bearer credential. Removal,
 * join, and resume checks must all use this one canonical fingerprint.
 */
export function fingerprintClientToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
