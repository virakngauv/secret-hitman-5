import { describe, expect, it } from 'vitest'

import { GameRoom } from './game-room'

const hostToken = 'a'.repeat(32)
const guestToken = 'b'.repeat(32)
const thirdToken = 'c'.repeat(32)

function createRoom() {
  let id = 0
  return new GameRoom(
    'bcdf2',
    { token: hostToken, name: 'Ada' },
    {
      now: 1_000,
      seed: 'fixed-test-seed',
      createPlayerId: () => `player-${++id}`,
    },
  )
}

function hinting(room: GameRoom, token = hostToken) {
  const snapshot = room.snapshotFor(token)
  if (snapshot.status !== 'hinting')
    throw new Error('Expected hinting snapshot.')
  return snapshot
}

function guessing(room: GameRoom, token = hostToken) {
  const snapshot = room.snapshotFor(token)
  if (snapshot.status !== 'guessing')
    throw new Error('Expected guessing snapshot.')
  return snapshot
}

function submitFirstHint(room: GameRoom, token: string, hint: string) {
  const view = hinting(room, token)
  const targetCardIds =
    view.board
      ?.filter(({ kind }) => kind === 'neutral')
      .slice(0, 2)
      .map(({ id }) => id) ?? []
  return room.submitHint(token, { roomCode: room.code, hint, targetCardIds })
}

function startTwoPlayerGame() {
  const room = createRoom()
  room.join(guestToken, 'Grace', 1_001)
  expect(room.start(hostToken, 1_002)).toEqual({ status: 'success' })
  expect(submitFirstHint(room, hostToken, 'Orbit')).toEqual({
    status: 'success',
  })
  expect(submitFirstHint(room, guestToken, 'Garden')).toEqual({
    status: 'success',
  })
  expect(room.startGuessing(hostToken, 1_003)).toEqual({ status: 'success' })
  return room
}

describe('GameRoom single-round flow', () => {
  it('requires two players and creates private boards with twelve cards and one frozen assassin', () => {
    const room = createRoom()
    expect(room.start(hostToken, 1_001)).toMatchObject({ status: 'invalid' })
    room.join(guestToken, 'Grace', 1_002)
    expect(room.start(hostToken, 1_003)).toEqual({ status: 'success' })

    const host = hinting(room, hostToken)
    const guest = hinting(room, guestToken)
    expect(host.board).toHaveLength(12)
    expect(host.board?.filter(({ kind }) => kind === 'assassin')).toHaveLength(
      1,
    )
    expect(new Set(host.board?.map(({ word }) => word)).size).toBe(12)
    expect(guest.board).toHaveLength(12)
    expect(guest.board).not.toEqual(host.board)
  })

  it('derives the clue number from selected non-assassin cards and waits for everyone', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const host = hinting(room)
    const assassin = host.board?.find(({ kind }) => kind === 'assassin')
    const targets =
      host.board?.filter(({ kind }) => kind === 'neutral').slice(0, 3) ?? []

    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Trap',
        targetCardIds: [assassin?.id ?? 'missing'],
      }),
    ).toMatchObject({ status: 'invalid' })
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Orbit',
        targetCardIds: targets.map(({ id }) => id),
      }),
    ).toEqual({ status: 'success' })
    expect(hinting(room).allHintsSubmitted).toBe(false)
    expect(room.startGuessing(hostToken)).toMatchObject({ status: 'invalid' })

    submitFirstHint(room, guestToken, 'Garden')
    expect(hinting(room).allHintsSubmitted).toBe(true)
    expect(room.startGuessing(hostToken)).toEqual({ status: 'success' })
    expect(guessing(room).hintNumber).toBe(3)
  })

  it('admits new identities as spectators while restoring an existing player seat', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    room.leave(guestToken, 1_003)
    expect(room.join(guestToken, 'Grace', 1_004)).toEqual({ status: 'success' })
    expect(hinting(room, guestToken).player.participation).toBe('player')

    expect(room.join(thirdToken, 'Linus', 1_005)).toEqual({ status: 'success' })
    const spectator = hinting(room, thirdToken)
    expect(spectator.player.participation).toBe('spectator')
    expect(spectator.board).toBeNull()
    expect(
      room.submitHint(thirdToken, {
        roomCode: room.code,
        hint: 'Nope',
        targetCardIds: ['p0-card-0'],
      }),
    ).toMatchObject({ status: 'forbidden' })
  })

  it('scores targets for the guesser and clue-giver, and ends a guesser on a civilian', () => {
    const room = startTwoPlayerGame()
    const hostView = guessing(room, hostToken)
    const guestView = guessing(room, guestToken)
    expect(hostView.clueGiverName).toBe('Ada')
    expect(
      hostView.board.every(({ revealedKind }) => revealedKind !== null),
    ).toBe(true)
    expect(
      guestView.board.every(({ revealedKind }) => revealedKind === null),
    ).toBe(true)

    const target = hostView.board.find(
      ({ revealedKind }) => revealedKind === 'target',
    )!
    expect(
      room.claimCard(guestToken, {
        roomCode: room.code,
        commandId: 'target-command-1',
        revision: guestView.revision,
        cardId: target.id,
      }),
    ).toEqual({ status: 'success', kind: 'target' })
    expect(
      guessing(room)
        .scoreboard.filter(({ participation }) => participation === 'player')
        .map(({ score }) => score),
    ).toEqual([1, 1])

    const afterTarget = guessing(room, guestToken)
    const civilian = guessing(room, hostToken).board.find(
      ({ revealedKind }) => revealedKind === 'civilian',
    )!
    expect(
      room.claimCard(guestToken, {
        roomCode: room.code,
        commandId: 'civilian-command-1',
        revision: afterTarget.revision,
        cardId: civilian.id,
      }),
    ).toEqual({ status: 'success', kind: 'civilian' })
    expect(guessing(room, guestToken).canGuess).toBe(false)
  })

  it('keeps the assassin hidden from other guessers and applies both penalties', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.join(thirdToken, 'Linus', 1_002)
    room.start(hostToken, 1_003)
    submitFirstHint(room, hostToken, 'Orbit')
    submitFirstHint(room, guestToken, 'Garden')
    submitFirstHint(room, thirdToken, 'Metal')
    room.startGuessing(hostToken, 1_004)

    const hostView = guessing(room, hostToken)
    const assassin = hostView.board.find(
      ({ revealedKind }) => revealedKind === 'assassin',
    )!
    const guestView = guessing(room, guestToken)
    expect(
      room.claimCard(guestToken, {
        roomCode: room.code,
        commandId: 'assassin-command-1',
        revision: guestView.revision,
        cardId: assassin.id,
      }),
    ).toEqual({ status: 'success', kind: 'assassin' })

    const thirdView = guessing(room, thirdToken)
    expect(
      thirdView.board.find(({ id }) => id === assassin.id)?.revealedKind,
    ).toBeNull()
    const scores = thirdView.scoreboard.filter(
      ({ participation }) => participation === 'player',
    )
    expect(scores.map(({ score }) => score)).toEqual([-1, -1, 0])
  })

  it('lets only the host advance each clue and finishes after every starting player has one turn', () => {
    const room = startTwoPlayerGame()
    expect(room.advanceTurn(guestToken)).toMatchObject({ status: 'forbidden' })
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
    expect(guessing(room).turnNumber).toBe(2)
    expect(guessing(room).clueGiverName).toBe('Grace')
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })

    const finished = room.snapshotFor(hostToken)
    expect(finished.status).toBe('finished')
    if (finished.status === 'finished') {
      expect(finished.winners.length).toBeGreaterThan(0)
      expect(
        finished.board.every(({ revealedKind }) => revealedKind !== null),
      ).toBe(true)
    }
  })

  it('rejects stale guesses without changing the score', () => {
    const room = startTwoPlayerGame()
    const hostView = guessing(room)
    const target = hostView.board.find(
      ({ revealedKind }) => revealedKind === 'target',
    )!
    expect(
      room.claimCard(guestToken, {
        roomCode: room.code,
        commandId: 'stale-command-1',
        revision: hostView.revision - 1,
        cardId: target.id,
      }),
    ).toMatchObject({ status: 'stale' })
    expect(guessing(room).scoreboard.map(({ score }) => score)).toEqual([0, 0])
  })
})
