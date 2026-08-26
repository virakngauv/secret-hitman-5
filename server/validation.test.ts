import { describe, expect, it } from 'vitest'

import { parsePlayerName, parseRemovePlayer } from './validation'

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
