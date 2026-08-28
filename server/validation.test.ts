import { describe, expect, it } from 'vitest'
import { GAME_PROTOCOL_VERSION } from '../lib/game-protocol'

import {
  MAX_HINT_LENGTH,
  parseFinishGuessing,
  parseHandshakeAuth,
  parseHint,
  parsePlayerName,
  parseRemovePlayer,
  parseSubmitHint,
} from './validation'

describe('versioned pass commands', () => {
  it('normalizes the room and requires a valid revision', () => {
    expect(parseFinishGuessing({ roomCode: ' BCDF2 ', revision: 5 })).toEqual({
      roomCode: 'bcdf2',
      revision: 5,
    })
    for (const revision of [
      undefined,
      null,
      '5',
      -1,
      1.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(parseFinishGuessing({ roomCode: 'bcdf2', revision })).toBeNull()
    }
    expect(parseFinishGuessing(null)).toBeNull()
    expect(parseFinishGuessing({ roomCode: 'bad', revision: 5 })).toBeNull()
  })

  it('rejects older clients that cannot send the turn-bound pass payload', () => {
    const token = 'a'.repeat(32)
    expect(
      parseHandshakeAuth({ token, protocolVersion: GAME_PROTOCOL_VERSION - 1 }),
    ).toBeNull()
    expect(
      parseHandshakeAuth({ token, protocolVersion: GAME_PROTOCOL_VERSION }),
    ).toEqual({ token, protocolVersion: GAME_PROTOCOL_VERSION })
  })
})

describe('parseHint', () => {
  it('normalizes whitespace while removing unsafe formatting controls', () => {
    expect(parseHint('  Blue\n\u202e  sky\u200b  ')).toBe('Blue sky')
    expect(parseHint('Blue\nsky')).toBe('Blue sky')
    expect(parseHint('café 東京')).toBe('café 東京')
  })

  it.each([undefined, null, 42, {}, '', '  ', '\u0000\u202e\u2066'])(
    'rejects empty or non-string hints: %s',
    (value) => {
      expect(parseHint(value)).toBeNull()
    },
  )

  it('applies length bounds to the sanitized hint', () => {
    const hint = 'a'.repeat(MAX_HINT_LENGTH)
    expect(parseHint(`\u202e${hint}\u2066`)).toBe(hint)
    expect(parseHint(`${hint}a`)).toBeNull()
  })

  it('sanitizes hints in incoming command payloads', () => {
    expect(
      parseSubmitHint({
        roomCode: 'bcdf2',
        hint: '\u202eBlue sky',
        targetCardIds: ['p1-card-1'],
      }),
    ).toEqual({
      roomCode: 'bcdf2',
      hint: 'Blue sky',
      targetCardIds: ['p1-card-1'],
    })
  })
})

describe('parsePlayerName', () => {
  it('normalizes whitespace and removes unsafe formatting characters', () => {
    expect(parsePlayerName('  Ada\n\u202e  Lovelace\u200b  ')).toBe(
      'Ada Lovelace',
    )
  })

  it('rejects a name made entirely from unsafe characters', () => {
    expect(parsePlayerName('\u0000\u202e\u2066')).toBeNull()
  })
})

describe('parseRemovePlayer', () => {
  it('normalizes the room code and accepts a bounded server player id', () => {
    expect(
      parseRemovePlayer({ roomCode: ' BCDF2 ', playerId: 'player-2' }),
    ).toEqual({ roomCode: 'bcdf2', playerId: 'player-2' })
  })

  it('rejects missing, malformed, and oversized player ids', () => {
    expect(parseRemovePlayer({ roomCode: 'bcdf2' })).toBeNull()
    expect(
      parseRemovePlayer({ roomCode: 'bcdf2', playerId: 'player 2' }),
    ).toBeNull()
    expect(
      parseRemovePlayer({ roomCode: 'bcdf2', playerId: 'a'.repeat(65) }),
    ).toBeNull()
  })
})
