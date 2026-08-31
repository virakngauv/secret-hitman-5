import { describe, expect, it } from 'vitest'
import { GAME_PROTOCOL_VERSION } from '../lib/game-protocol'

import {
  MAX_HINT_LENGTH,
  parseClaimCard,
  parseFinishGuessing,
  parseHandshakeAuth,
  parseHint,
  parsePlayerName,
  parseRemovePlayer,
  parseSubmitHint,
} from './validation'

const gameId = '10000000-0000-4000-8000-000000000001'

describe('turn-bound commands', () => {
  const turnId = 'abcdef01-2345-4abc-8def-0123456789ab'
  const claim = { commandId: 'claim-123', cardId: 'p0-card-0' }

  it.each([parseFinishGuessing, parseClaimCard])(
    'normalizes rooms and accepts only a UUID turn identity: %s',
    (parse) => {
      const extra = parse === parseClaimCard ? claim : {}
      expect(parse({ roomCode: ' BCDF2 ', gameId, turnId, ...extra })).toEqual({
        roomCode: 'bcdf2',
        gameId,
        turnId,
        ...extra,
      })
      for (const invalidId of [
        undefined,
        null,
        5,
        -1,
        {},
        '',
        'turn-1',
        turnId + 'a',
        ' ' + turnId,
        turnId.toUpperCase(),
        'a'.repeat(1_000),
      ]) {
        expect(
          parse({ roomCode: 'bcdf2', gameId, turnId: invalidId, ...extra }),
        ).toBeNull()
      }
      expect(
        parse({
          roomCode: 'bcdf2',
          gameId,
          turnId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
          ...extra,
        }),
      ).toBeNull()
      expect(parse(null)).toBeNull()
      expect(parse({ roomCode: 'bad', gameId, turnId, ...extra })).toBeNull()
      expect(
        parse({ roomCode: 'bcdf2', gameId, revision: 5, ...extra }),
      ).toBeNull()
      expect(parse({ roomCode: 'bcdf2', turnId, ...extra })).toBeNull()
    },
  )

  it('rejects older clients that cannot send the turn-bound payload', () => {
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
        gameId,
        hint: '\u202eBlue sky',
        targetCardIds: ['p1-card-1'],
      }),
    ).toEqual({
      roomCode: 'bcdf2',
      gameId,
      hint: 'Blue sky',
      targetCardIds: ['p1-card-1'],
    })
  })

  it('accepts one through five targets and rejects empty or larger selections', () => {
    expect(
      parseSubmitHint({
        roomCode: 'bcdf2',
        gameId,
        hint: 'Orbit',
        targetCardIds: [],
      }),
    ).toBeNull()
    for (let count = 1; count <= 5; count += 1) {
      const targetCardIds = Array.from(
        { length: count },
        (_, index) => `p1-card-${index}`,
      )
      expect(
        parseSubmitHint({
          roomCode: 'bcdf2',
          gameId,
          hint: 'Orbit',
          targetCardIds,
        }),
      ).toEqual({ roomCode: 'bcdf2', gameId, hint: 'Orbit', targetCardIds })
    }
    expect(
      parseSubmitHint({
        roomCode: 'bcdf2',
        gameId,
        hint: 'Orbit',
        targetCardIds: Array.from(
          { length: 6 },
          (_, index) => `p1-card-${index}`,
        ),
      }),
    ).toBeNull()
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
