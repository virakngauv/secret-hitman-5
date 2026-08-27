import { describe, expect, it } from 'vitest'

import {
  MAX_HINT_LENGTH,
  parseHint,
  parsePlayerName,
  parseRemovePlayer,
  parseSubmitHint,
} from './validation'

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
