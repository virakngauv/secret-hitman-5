import { describe, expect, it } from 'vitest'

import { GameRoom, MAX_ROOM_IDENTITIES, MAX_ROOM_MEMBERS } from './game-room'

const hostToken = 'a'.repeat(32)
const guestToken = 'b'.repeat(32)
const thirdToken = 'c'.repeat(32)
const fourthToken = 'd'.repeat(32)

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

function startTwoPlayerGame(withThirdPlayer = false) {
  const room = createRoom()
  room.join(guestToken, 'Grace', 1_001)
  if (withThirdPlayer) room.join(thirdToken, 'Linus', 1_001)
  expect(room.start(hostToken, 1_002)).toEqual({ status: 'success' })
  expect(submitFirstHint(room, hostToken, 'Orbit')).toEqual({
    status: 'success',
  })
  expect(submitFirstHint(room, guestToken, 'Garden')).toEqual({
    status: 'success',
  })
  if (withThirdPlayer) submitFirstHint(room, thirdToken, 'Metal')
  expect(room.startGuessing(hostToken, 1_003)).toEqual({ status: 'success' })
  return room
}

function finishActiveGuessers(room: GameRoom) {
  for (const token of [hostToken, guestToken, thirdToken]) {
    const view = room.snapshotFor(token)
    if (view.status === 'guessing' && view.canMarkDone) {
      expect(
        room.finishGuessing(token, {
          roomCode: room.code,
          turnId: view.turnId,
        }),
      ).toEqual({ status: 'success' })
    }
  }
}

describe('GameRoom single-round flow', () => {
  it('removes a departed hinting seat and gives that identity a fresh seat on rejoin', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const originalBoardIds = hinting(room).board!.map(({ id }) => id)

    expect(room.leave(hostToken, 1_003)).toEqual({ status: 'success' })
    expect(hinting(room, guestToken)).toMatchObject({
      player: { role: 'host' },
      hintStatuses: [
        expect.objectContaining({ name: 'Grace', submitted: false }),
      ],
    })
    expect(submitFirstHint(room, guestToken, 'Garden')).toEqual({
      status: 'success',
    })
    expect(room.startGuessing(guestToken)).toMatchObject({
      status: 'invalid',
      message: 'At least 2 players are required to start guessing.',
    })

    expect(room.join(hostToken, 'Ada', 1_004)).toEqual({ status: 'success' })
    const returned = hinting(room)
    expect(returned.player).toMatchObject({
      name: 'Ada',
      role: 'player',
      participation: 'player',
    })
    expect(returned.board!.map(({ id }) => id)).not.toEqual(originalBoardIds)
    expect(returned).toMatchObject({
      hint: null,
      hintSubmitted: false,
      hintRejected: false,
    })
    expect(returned.hintStatuses.map(({ name }) => name)).toEqual([
      'Grace',
      'Ada',
    ])
    expect(submitFirstHint(room, hostToken, 'Orbit')).toEqual({
      status: 'success',
    })
    expect(room.startGuessing(guestToken, 1_005)).toEqual({
      status: 'success',
    })
    expect(guessing(room).totalTurns).toBe(2)
  })

  it('rejects locked-role and target-count tampering atomically', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const before = hinting(room)
    const board = before.board!
    const neutral = board.find(({ kind }) => kind === 'neutral')!
    const neutrals = board.filter(({ kind }) => kind === 'neutral')
    const forbidden = board.filter(
      ({ kind }) => kind === 'civilian' || kind === 'assassin',
    )
    for (const targetCardIds of [
      [],
      [neutral.id, neutral.id],
      [neutral.id, 'not-a-card'],
      ...forbidden.map(({ id }) => [neutral.id, id]),
      [neutral.id, hinting(room, guestToken).board![0].id],
      neutrals.slice(0, 6).map(({ id }) => id),
    ]) {
      const activity = room.lastMeaningfulActivityAt
      expect(
        room.submitHint(hostToken, {
          roomCode: room.code,
          hint: 'Orbit',
          targetCardIds,
        }),
      ).toMatchObject({ status: 'invalid' })
      expect(hinting(room)).toEqual(before)
      expect(room.lastMeaningfulActivityAt).toBe(activity)
    }
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Orbit',
        targetCardIds: [neutral.id],
      }),
    ).toEqual({ status: 'success' })
    const submittedBoard = hinting(room).board
    expect(submittedBoard).toEqual(
      board.map((card) =>
        card.locked
          ? card
          : { ...card, kind: card.id === neutral.id ? 'target' : 'civilian' },
      ),
    )
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Changed',
        targetCardIds: [],
      }),
    ).toMatchObject({ status: 'invalid' })
    room.leave(hostToken)
    room.join(hostToken, 'Ada')
    const replacement = hinting(room)
    expect(replacement.board).not.toEqual(submittedBoard)
    expect(replacement.hintSubmitted).toBe(false)
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Orbit',
        targetCardIds: [
          replacement.board!.find(({ kind }) => kind === 'neutral')!.id,
        ],
      }),
    ).toEqual({ status: 'success' })
    room.join(thirdToken, 'Linus')
    expect(hinting(room, thirdToken).board).toHaveLength(12)
    submitFirstHint(room, guestToken, 'Garden')
    submitFirstHint(room, thirdToken, 'Metal')
    room.startGuessing(guestToken)
    expect(guessing(room)).toMatchObject({
      clueGiverName: 'Grace',
      hintNumber: 2,
    })
    expect(
      guessing(room).board.every(
        (card) => card.revealedKind === null && !('locked' in card),
      ),
    ).toBe(true)
    finishActiveGuessers(room)
    expect(room.advanceTurn(guestToken)).toEqual({ status: 'success' })
    expect(guessing(room)).toMatchObject({
      clueGiverName: 'Ada',
      hintNumber: 1,
    })
    expect(
      guessing(room).board.filter(
        ({ revealedKind }) => revealedKind === 'target',
      ),
    ).toHaveLength(1)
  })

  it('unlocks and relocks hints while preserving private edits and readiness', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const initialHost = hinting(room)
    const targetIds = initialHost
      .board!.filter(({ kind }) => kind === 'neutral')
      .slice(0, 2)
      .map(({ id }) => id)
    const fixedRoles = initialHost
      .board!.filter(({ locked }) => locked)
      .map(({ id, kind, locked }) => ({ id, kind, locked }))

    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Orbit',
        targetCardIds: targetIds,
      }),
    ).toEqual({ status: 'success' })
    const locked = hinting(room)
    expect(locked).toMatchObject({
      hint: 'Orbit',
      hintSubmitted: true,
      allHintsSubmitted: false,
    })
    expect(
      locked
        .board!.filter(({ kind, locked }) => !locked && kind === 'target')
        .map(({ id }) => id),
    ).toEqual(targetIds)
    expect(
      locked.board!.filter(
        ({ kind, locked }) => !locked && kind === 'civilian',
      ),
    ).toHaveLength(6)
    expect(hinting(room, guestToken).hint).toBeNull()

    expect(submitFirstHint(room, guestToken, 'Garden')).toEqual({
      status: 'success',
    })
    expect(room.unlockHint(hostToken, 1_003)).toEqual({ status: 'success' })
    const unlocked = hinting(room)
    expect(unlocked).toMatchObject({
      hint: 'Orbit',
      hintSubmitted: false,
      allHintsSubmitted: false,
    })
    expect(
      unlocked
        .board!.filter(({ kind }) => kind === 'target')
        .map(({ id }) => id),
    ).toEqual(targetIds)
    expect(
      unlocked.board!.filter(({ kind }) => kind === 'neutral'),
    ).toHaveLength(6)
    expect(
      unlocked
        .board!.filter(({ locked }) => locked)
        .map(({ id, kind, locked }) => ({
          id,
          kind,
          locked,
        })),
    ).toEqual(fixedRoles)
    expect(room.startGuessing(hostToken)).toMatchObject({ status: 'invalid' })

    const activity = room.lastMeaningfulActivityAt
    expect(room.unlockHint(hostToken)).toMatchObject({ status: 'invalid' })
    expect(room.lastMeaningfulActivityAt).toBe(activity)
    const revisedTargets = [targetIds[1]!]
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Galaxy',
        targetCardIds: revisedTargets,
      }),
    ).toEqual({ status: 'success' })
    expect(hinting(room)).toMatchObject({
      hint: 'Galaxy',
      hintSubmitted: true,
      allHintsSubmitted: true,
    })
    expect(room.unlockHint(hostToken, 1_004)).toEqual({ status: 'success' })
    expect(hinting(room)).toMatchObject({
      hint: 'Galaxy',
      hintSubmitted: false,
      allHintsSubmitted: false,
    })
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Nebula',
        targetCardIds: targetIds,
      }),
    ).toEqual({ status: 'success' })
    expect(room.startGuessing(hostToken)).toEqual({ status: 'success' })
    expect(room.unlockHint(hostToken)).toMatchObject({ status: 'forbidden' })
    expect(guessing(room).hint).toBe('Nebula')
    expect(guessing(room).hintNumber).toBe(2)
  })

  it('removes an explicitly departed unlocked hint and board', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const targetIds = hinting(room)
      .board!.filter(({ kind }) => kind === 'neutral')
      .slice(0, 2)
      .map(({ id }) => id)
    room.submitHint(hostToken, {
      roomCode: room.code,
      hint: 'Orbit',
      targetCardIds: targetIds,
    })
    room.unlockHint(hostToken)

    expect(room.leave(hostToken)).toEqual({ status: 'success' })
    expect(hinting(room, guestToken).hintStatuses).toEqual([
      expect.objectContaining({ name: 'Grace', submitted: false }),
    ])
    expect(room.join(hostToken, 'Ada')).toEqual({ status: 'success' })
    expect(hinting(room)).toMatchObject({
      hint: null,
      hintSubmitted: false,
      hintRejected: false,
    })
    expect(
      hinting(room).board!.every(({ id }) => !targetIds.includes(id)),
    ).toBe(true)
    submitFirstHint(room, hostToken, 'Galaxy')
    submitFirstHint(room, guestToken, 'Garden')
    expect(room.startGuessing(guestToken)).toEqual({ status: 'success' })
    expect(guessing(room).hint).toBe('Garden')
  })

  it('allows up to five of eight editable words and rejects six atomically', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const board = hinting(room).board!
    const editableIds = board
      .filter(({ kind }) => kind === 'neutral')
      .map(({ id }) => id)
    expect(editableIds).toHaveLength(8)
    const before = hinting(room)
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Too many',
        targetCardIds: editableIds.slice(0, 6),
      }),
    ).toMatchObject({ status: 'invalid' })
    expect(hinting(room)).toEqual(before)
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Five',
        targetCardIds: editableIds.slice(0, 5),
      }),
    ).toEqual({ status: 'success' })
    submitFirstHint(room, guestToken, 'Garden')
    room.startGuessing(hostToken)
    expect(guessing(room).hintNumber).toBe(5)
    expect(
      guessing(room).board.filter(
        ({ revealedKind }) => revealedKind === 'civilian',
      ),
    ).toHaveLength(6)
  })

  it.each([1, 2, 3, 4, 5])(
    'accepts a hint with %i selected targets',
    (count) => {
      const room = createRoom()
      room.join(guestToken, 'Grace', 1_001)
      room.start(hostToken, 1_002)
      const editableIds = hinting(room)
        .board!.filter(({ kind }) => kind === 'neutral')
        .slice(0, count)
        .map(({ id }) => id)
      expect(
        room.submitHint(hostToken, {
          roomCode: room.code,
          hint: 'Orbit',
          targetCardIds: editableIds,
        }),
      ).toEqual({ status: 'success' })
      expect(submitFirstHint(room, guestToken, 'Garden')).toEqual({
        status: 'success',
      })
      expect(room.startGuessing(hostToken)).toEqual({ status: 'success' })
      expect(guessing(room).hintNumber).toBe(count)
    },
  )
  it('accepts different targets from an older snapshot despite unrelated membership changes', () => {
    const room = startTwoPlayerGame(true)
    const before = guessing(room)
    const targets = before.board.filter(
      ({ revealedKind }) => revealedKind === 'target',
    )
    const spectator = 'd'.repeat(32)
    room.join(spectator, 'Spectator')
    room.leave(spectator)
    for (const [index, token] of [guestToken, thirdToken].entries()) {
      const payload = {
        roomCode: room.code,
        turnId: before.turnId,
        cardId: targets[index].id,
        commandId: `older-snapshot-${index}`,
      }
      expect(room.claimCard(token, payload)).toEqual({
        status: 'success',
        kind: 'target',
      })
      expect(guessing(room).turnId).toBe(before.turnId)
      const after = guessing(room)
      const activity = room.lastMeaningfulActivityAt
      expect(room.claimCard(token, payload)).toEqual({
        status: 'success',
        kind: 'target',
      })
      expect(guessing(room)).toEqual(after)
      expect(room.lastMeaningfulActivityAt).toBe(activity)
    }
    expect(guessing(room).scoreboard.map(({ score }) => score)).toEqual([
      6, 3, 3,
    ])
  })

  it('rejects old-game commands even when room code, players, clock, seed, and card IDs repeat', () => {
    const previous = startTwoPlayerGame()
    const oldView = guessing(previous)
    const room = startTwoPlayerGame()
    const current = guessing(room)
    expect(current.board).toEqual(oldView.board)
    expect(current.turnId).not.toBe(oldView.turnId)
    const target = current.board.find(
      ({ revealedKind }) => revealedKind === 'target',
    )!
    const payload = {
      roomCode: room.code,
      turnId: oldView.turnId,
      cardId: target.id,
      commandId: 'prior-game-command',
    }
    const activity = room.lastMeaningfulActivityAt
    expect(room.claimCard(guestToken, payload)).toMatchObject({
      status: 'stale',
    })
    expect(room.finishGuessing(guestToken, payload)).toMatchObject({
      status: 'stale',
    })
    expect(guessing(room)).toEqual(current)
    expect(room.lastMeaningfulActivityAt).toBe(activity)
    expect(
      room.claimCard(guestToken, { ...payload, turnId: current.turnId }),
    ).toEqual({ status: 'success', kind: 'target' })
  })

  it('checks turn identity before a cached command ID and rejects invalid tiles and finished games', () => {
    const room = startTwoPlayerGame(true)
    const oldTurnId = guessing(room).turnId
    finishActiveGuessers(room)
    room.advanceTurn(hostToken)
    const view = guessing(room, guestToken)
    expect(view.turnId).not.toBe(oldTurnId)
    const target = view.board.find(
      ({ revealedKind }) => revealedKind === 'target',
    )!
    const payload = {
      roomCode: room.code,
      turnId: view.turnId,
      cardId: target.id,
      commandId: 'reused-command-id',
    }
    expect(room.claimCard(thirdToken, payload)).toEqual({
      status: 'success',
      kind: 'target',
    })
    const after = guessing(room)
    expect(
      room.claimCard(thirdToken, { ...payload, turnId: oldTurnId }),
    ).toMatchObject({ status: 'stale' })
    expect(
      room.claimCard(thirdToken, {
        ...payload,
        cardId: 'p9-card-0',
        commandId: 'invalid-tile',
      }),
    ).toMatchObject({ status: 'invalid' })
    expect(guessing(room)).toEqual(after)
    for (let remainingTurn = 0; remainingTurn < 2; remainingTurn++) {
      finishActiveGuessers(room)
      expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
    }
    const finished = room.snapshotFor(thirdToken)
    expect(finished.status).toBe('finished')
    const activity = room.lastMeaningfulActivityAt
    expect(room.claimCard(thirdToken, payload)).toMatchObject({
      status: 'forbidden',
    })
    expect(room.finishGuessing(thirdToken, payload)).toMatchObject({
      status: 'forbidden',
    })
    expect(room.snapshotFor(thirdToken)).toEqual(finished)
    expect(room.lastMeaningfulActivityAt).toBe(activity)
  })

  it('rejects advancement without effects until the last eligible picker finishes', () => {
    const room = startTwoPlayerGame(true)
    const spectator = 'd'.repeat(32)
    room.join(spectator, 'Spectator')
    const payload = { roomCode: room.code, turnId: guessing(room).turnId }
    expect(room.finishGuessing(guestToken, payload)).toEqual({
      status: 'success',
    })
    const tokens = [hostToken, guestToken, thirdToken, spectator]
    const before = tokens.map((token) => room.snapshotFor(token))
    const activity = room.lastMeaningfulActivityAt
    expect(guessing(room).canAdvanceTurn).toBe(false)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(room.advanceTurn(hostToken)).toEqual({
        status: 'invalid',
        message: 'Waiting for players to finish guessing.',
      })
      expect(tokens.map((token) => room.snapshotFor(token))).toEqual(before)
      expect(room.lastMeaningfulActivityAt).toBe(activity)
    }
    // Both passes may arrive from the same snapshot; current eligibility wins.
    expect(room.finishGuessing(thirdToken, payload)).toEqual({
      status: 'success',
    })
    expect(guessing(room).canAdvanceTurn).toBe(true)
    expect(guessing(room).turnSettled).toBe(true)
    expect(guessing(room).turnNumber).toBe(1)
    expect(guessing(room, guestToken).canAdvanceTurn).toBe(false)
    const settledSpectator = guessing(room, spectator)
    expect(settledSpectator.canAdvanceTurn).toBe(false)
    expect(settledSpectator.turnSettled).toBe(true)
    expect(
      settledSpectator.board.every(
        ({ revealedKind, disabled }) => revealedKind !== null && disabled,
      ),
    ).toBe(true)
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
    // A delayed retry from the now-completed turn cannot skip new pickers.
    const next = guessing(room)
    expect(room.advanceTurn(hostToken)).toMatchObject({ status: 'invalid' })
    expect(guessing(room)).toEqual(next)
  })

  it('keeps a finished host waiting for other pickers', () => {
    const room = startTwoPlayerGame(true)
    finishActiveGuessers(room)
    room.advanceTurn(hostToken)
    room.finishGuessing(hostToken, {
      roomCode: room.code,
      turnId: guessing(room).turnId,
    })
    expect(guessing(room).canGuess).toBe(false)
    expect(guessing(room).canAdvanceTurn).toBe(false)
    expect(room.advanceTurn(hostToken)).toMatchObject({ status: 'invalid' })
    room.finishGuessing(thirdToken, {
      roomCode: room.code,
      turnId: guessing(room).turnId,
    })
    expect(guessing(room).canAdvanceTurn).toBe(true)
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
  })

  it.each(['civilian', 'assassin'] as const)(
    'enables advancement after the final picker selects a %s',
    (kind) => {
      const room = startTwoPlayerGame()
      const before = guessing(room)
      const card = before.board.find(
        ({ revealedKind }) => revealedKind === kind,
      )!
      expect(
        room.claimCard(guestToken, {
          roomCode: room.code,
          turnId: before.turnId,
          cardId: card.id,
          commandId: 'last-picker',
        }),
      ).toEqual({ status: 'success', kind })
      expect(guessing(room).canAdvanceTurn).toBe(true)
      expect(guessing(room).turnNumber).toBe(1)
      expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
    },
  )

  it('enables advancement when racing claims find every target without requiring passes', () => {
    const room = startTwoPlayerGame(true)
    const spectatorToken = 'd'.repeat(32)
    room.join(spectatorToken, 'Spectator')
    const before = guessing(room)
    const targets = before.board.filter(
      ({ revealedKind }) => revealedKind === 'target',
    )
    for (const [index, card] of targets.entries()) {
      const payload = {
        roomCode: room.code,
        turnId: before.turnId,
        cardId: card.id,
        commandId: `target-${index}`,
      }
      const token = index === 0 ? guestToken : thirdToken
      expect(room.claimCard(token, payload)).toEqual({
        status: 'success',
        kind: 'target',
      })
      const after = guessing(room)
      expect(after.boardCompleted).toBe(index === targets.length - 1)
      expect(after.canAdvanceTurn).toBe(index === targets.length - 1)
      expect(room.claimCard(token, payload)).toEqual({
        status: 'success',
        kind: 'target',
      })
      expect(guessing(room)).toEqual(after)
    }
    expect(guessing(room).turnNumber).toBe(1)
    for (const token of [hostToken, guestToken, thirdToken, spectatorToken]) {
      const completed = guessing(room, token)
      expect(completed.boardCompleted).toBe(true)
      expect(completed.canGuess).toBe(false)
      expect(
        completed.board.every(
          ({ revealedKind, disabled }) => revealedKind !== null && disabled,
        ),
      ).toBe(true)
      expect(
        completed.board
          .filter(({ claimedBy }) => claimedBy.length > 0)
          .flatMap(({ claimedBy }) => claimedBy)
          .sort(),
      ).toEqual(['Grace', 'Linus'])
    }
    const completed = guessing(room, thirdToken)
    const unselected = completed.board.find(
      ({ claimedBy }) => claimedBy.length === 0,
    )!
    expect(
      room.claimCard(thirdToken, {
        roomCode: room.code,
        turnId: completed.turnId,
        cardId: unselected.id,
        commandId: 'after-target-completion',
      }),
    ).toMatchObject({
      status: 'forbidden',
      message: 'This board is already complete.',
    })
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
  })

  it('does not wait on explicitly departed pickers or reopen their turn on rejoin', () => {
    const room = startTwoPlayerGame()
    room.leave(guestToken)
    expect(guessing(room).canAdvanceTurn).toBe(true)
    room.join(guestToken, 'Grace')
    expect(guessing(room, guestToken).canGuess).toBe(false)
    expect(guessing(room).canAdvanceTurn).toBe(true)
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
  })

  it('acknowledges repeated passes without effects and rejects passes from another turn', () => {
    const room = startTwoPlayerGame(true)
    const payload = { roomCode: room.code, turnId: guessing(room).turnId }
    expect(room.finishGuessing(hostToken, payload)).toMatchObject({
      status: 'forbidden',
    })
    expect(
      room.finishGuessing(guestToken, {
        ...payload,
        turnId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toMatchObject({ status: 'stale' })
    expect(room.finishGuessing(guestToken, payload, 2_000)).toEqual({
      status: 'success',
    })
    const after = guessing(room, guestToken)
    expect(room.finishGuessing(guestToken, payload, 3_000)).toEqual({
      status: 'success',
    })
    expect(guessing(room, guestToken)).toEqual(after)
    expect(room.lastMeaningfulActivityAt).toBe(2_000)
    finishActiveGuessers(room)
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
    finishActiveGuessers(room)
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
    const next = guessing(room, guestToken)
    expect(next.canGuess).toBe(true)
    expect(room.finishGuessing(guestToken, payload)).toMatchObject({
      status: 'stale',
    })
    expect(guessing(room, guestToken)).toEqual(next)
  })

  it('treats explicit leave as ending the turn and never restores guessing after rejoining', () => {
    const room = startTwoPlayerGame(true)
    const before = guessing(room, guestToken)
    room.leave(guestToken)
    room.join(guestToken, 'Grace')
    const returned = guessing(room, guestToken)
    expect(returned.player.playerId).toBe(before.player.playerId)
    expect(returned.canGuess).toBe(false)
    expect(
      returned.board.every(
        ({ revealedKind, disabled }) => revealedKind !== null && disabled,
      ),
    ).toBe(true)
    expect(
      room.claimCard(guestToken, {
        roomCode: room.code,
        cardId: returned.board[0].id,
        turnId: returned.turnId,
        commandId: 'after-leave-rejoin',
      }),
    ).toMatchObject({ status: 'forbidden' })
    expect(
      guessing(room, thirdToken).board.every(
        ({ revealedKind }) => revealedKind === null,
      ),
    ).toBe(true)
    expect(guessing(room, guestToken)).toEqual(returned)
    expect(returned.scoreboard.map(({ score }) => score)).toEqual([0, 0, 0])
  })

  it.each(['pass', 'civilian', 'assassin'] as const)(
    'privately reveals a finished picker after %s and hides the next board',
    (ending) => {
      const room = startTwoPlayerGame(true)
      const spectatorToken = 'd'.repeat(32)
      room.join(spectatorToken, 'Spectator')
      const before = guessing(room, hostToken)
      if (ending === 'pass') {
        expect(
          room.finishGuessing(guestToken, {
            roomCode: room.code,
            turnId: before.turnId,
          }),
        ).toEqual({ status: 'success' })
      } else {
        const card = before.board.find(
          ({ revealedKind }) => revealedKind === ending,
        )!
        expect(
          room.claimCard(guestToken, {
            roomCode: room.code,
            cardId: card.id,
            turnId: before.turnId,
            commandId: `finish-${ending}`,
          }),
        ).toEqual({ status: 'success', kind: ending })
      }

      const finished = guessing(room, guestToken)
      expect(finished.board.map(({ revealedKind }) => revealedKind)).toEqual(
        before.board.map(({ revealedKind }) => revealedKind),
      )
      expect(finished.board.every(({ disabled }) => disabled)).toBe(true)
      expect(finished.canGuess).toBe(false)
      expect(finished.canMarkDone).toBe(false)
      const target = before.board.find(
        ({ revealedKind }) => revealedKind === 'target',
      )!
      expect(
        room.claimCard(guestToken, {
          roomCode: room.code,
          cardId: target.id,
          turnId: finished.turnId,
          commandId: 'after-finishing',
        }),
      ).toMatchObject({ status: 'forbidden' })
      expect(guessing(room, guestToken)).toEqual(finished)

      for (const token of [thirdToken, spectatorToken]) {
        const view = guessing(room, token)
        expect(
          view.board.filter(({ revealedKind }) => revealedKind !== null),
        ).toHaveLength(
          ending === 'assassin' ? 12 : ending === 'civilian' ? 1 : 0,
        )
        const assassin = before.board.find(
          ({ revealedKind }) => revealedKind === 'assassin',
        )!
        expect(view.board.find(({ id }) => id === assassin.id)).toMatchObject({
          revealedKind: ending === 'assassin' ? 'assassin' : null,
          claimedBy: ending === 'assassin' ? ['Grace'] : [],
          selectedByYou: false,
          disabled: ending === 'assassin' || token === spectatorToken,
        })
      }
      expect(
        room.claimCard(thirdToken, {
          roomCode: room.code,
          cardId: target.id,
          turnId: before.turnId,
          commandId: 'active-picker-target',
        }),
      ).toMatchObject({
        status: ending === 'assassin' ? 'forbidden' : 'success',
      })

      finishActiveGuessers(room)
      expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
      finishActiveGuessers(room)
      expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
      const next = guessing(room, guestToken)
      expect(next.clueGiverName).toBe('Linus')
      expect(next.canGuess).toBe(true)
      expect(
        next.board.every(({ revealedKind }) => revealedKind === null),
      ).toBe(true)
      expect(
        room.claimCard(guestToken, {
          roomCode: room.code,
          cardId: next.board[0].id,
          turnId: finished.turnId,
          commandId: 'previous-turn',
        }),
      ).toMatchObject({ status: 'stale' })
      expect(guessing(room, guestToken)).toEqual(next)
    },
  )

  it.each(['target', 'civilian', 'assassin'] as const)(
    'arbitrates same-snapshot %s claims and retries without duplicate effects',
    (kind) => {
      const room = startTwoPlayerGame(true)
      const before = guessing(room)
      const card = before.board.find(
        ({ revealedKind }) => revealedKind === kind,
      )!
      const payload = {
        roomCode: room.code,
        cardId: card.id,
        turnId: before.turnId,
        commandId: 'same-command-id-per-player',
      }
      expect(room.claimCard(guestToken, payload)).toEqual({
        status: 'success',
        kind,
      })
      const second = room.claimCard(thirdToken, payload)
      expect(second).toMatchObject({
        status: kind === 'assassin' ? 'forbidden' : 'already_claimed',
      })
      const after = guessing(room)
      expect(after.board.find(({ id }) => id === card.id)?.claimedBy).toEqual([
        'Grace',
      ])
      expect(after.scoreboard.map(({ score }) => score)).toEqual(
        kind === 'assassin'
          ? [-5, -5, 0]
          : kind === 'target'
            ? [3, 3, 0]
            : [-1, -1, 0],
      )
      expect(room.claimCard(guestToken, payload)).toEqual({
        status: 'success',
        kind,
      })
      expect(room.claimCard(thirdToken, payload)).toEqual(second)
      expect(
        room.claimCard(guestToken, {
          ...payload,
          commandId: 'new-id-retry',
          turnId: after.turnId,
        }),
      ).toMatchObject({
        status: kind === 'target' ? 'already_claimed' : 'forbidden',
      })
      expect(guessing(room)).toEqual(after)
    },
  )

  it('reserves starting seats when spectators fill capacity', () => {
    const room = startTwoPlayerGame()
    const playerId = guessing(room, guestToken).player.playerId
    room.leave(guestToken)
    for (let index = 0; index < MAX_ROOM_MEMBERS - 2; index += 1) {
      expect(
        room.join(index.toString(16).padStart(32, '0'), 'Spectator'),
      ).toEqual({ status: 'success' })
    }
    expect(room.join(thirdToken, 'Overflow')).toMatchObject({
      status: 'room_full',
    })
    expect(room.join(guestToken, 'Grace')).toEqual({ status: 'success' })
    expect(guessing(room, guestToken).player.playerId).toBe(playerId)
    expect(guessing(room, guestToken).members).toHaveLength(MAX_ROOM_MEMBERS)
    expect(room.join(thirdToken, 'Still full')).toMatchObject({
      status: 'room_full',
    })
  })

  it('bounds room history by rejecting new identities instead of forgetting removals', () => {
    const room = createRoom()
    for (let index = 0; index < MAX_ROOM_IDENTITIES - 2; index += 1) {
      const token = index.toString(16).padStart(32, '0')
      joinAndRemove(token)
    }

    expect(room.join(guestToken, 'Last guest')).toEqual({ status: 'success' })
    const snapshot = room.snapshotFor(guestToken)
    if (snapshot.status !== 'lobby') throw new Error('Expected guest lobby.')
    expect(room.join(thirdToken, 'Over capacity')).toMatchObject({
      status: 'room_full',
    })
    expect(room.join(hostToken, 'Ada')).toEqual({ status: 'success' })
    expect(room.join(guestToken, 'Last guest')).toEqual({ status: 'success' })
    expect(
      room.removePlayer(hostToken, snapshot.player.playerId),
    ).toMatchObject({ status: 'success' })
    expect(room.join(thirdToken, 'Still over capacity')).toMatchObject({
      status: 'room_full',
    })
    expect(room.join('0'.repeat(32), 'Removed guest')).toMatchObject({
      status: 'removed_from_room',
    })
    expect(room.join(guestToken, 'Removed last guest')).toMatchObject({
      status: 'removed_from_room',
    })

    function joinAndRemove(token: string) {
      expect(room.join(token, 'Guest')).toEqual({ status: 'success' })
      const member = room.snapshotFor(token)
      if (member.status !== 'lobby') throw new Error('Expected guest lobby.')
      expect(
        room.removePlayer(hostToken, member.player.playerId),
      ).toMatchObject({ status: 'success' })
    }
  })

  it('bounds spectator history while allowing existing game seats to reconnect', () => {
    const room = startTwoPlayerGame()
    for (let index = 0; index < MAX_ROOM_IDENTITIES - 2; index += 1) {
      const token = index.toString(16).padStart(32, '0')
      expect(room.join(token, 'Spectator')).toEqual({ status: 'success' })
      expect(room.leave(token)).toEqual({ status: 'success' })
    }
    expect(room.join(thirdToken, 'New spectator')).toMatchObject({
      status: 'room_full',
    })
    expect(room.leave(guestToken)).toEqual({ status: 'success' })
    expect(room.join(guestToken, 'Grace')).toEqual({ status: 'success' })
    expect(guessing(room, guestToken).player.participation).toBe('player')
  })

  it('retains every removal restriction for the room lifetime', () => {
    const room = createRoom()
    const removedTokens = Array.from({ length: 300 }, (_, index) =>
      index.toString(16).padStart(32, '0'),
    )
    for (const token of removedTokens) {
      expect(room.join(token, 'Guest')).toEqual({ status: 'success' })
      const snapshot = room.snapshotFor(token)
      if (snapshot.status !== 'lobby') throw new Error('Expected lobby member.')
      expect(room.removePlayer(hostToken, snapshot.player.playerId)).toEqual({
        status: 'success',
        removedToken: token,
      })
    }

    for (const token of removedTokens) {
      expect(room.join(token, 'Returning guest')).toMatchObject({
        status: 'removed_from_room',
      })
      expect(room.snapshotFor(token)).toMatchObject({
        status: 'removed_from_room',
      })
    }
    const host = room.snapshotFor(hostToken)
    if (host.status !== 'lobby') throw new Error('Expected host lobby.')
    expect(host.members).toHaveLength(1)

    const anotherRoom = createRoom()
    expect(anotherRoom.join(removedTokens[0], 'Guest')).toEqual({
      status: 'success',
    })
  })

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

  it('reveals submitted hints immediately and lets only the host reject another player', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    submitFirstHint(room, hostToken, 'Orbit')

    expect(
      hinting(room).hintStatuses.map(({ hint, hintNumber }) => ({
        hint,
        hintNumber,
      })),
    ).toEqual([
      { hint: 'Orbit', hintNumber: 2 },
      { hint: null, hintNumber: null },
    ])
    const guestId = hinting(room, guestToken).player.playerId
    expect(
      room.rejectHint(hostToken, {
        roomCode: room.code,
        playerId: guestId,
      }),
    ).toMatchObject({ status: 'stale' })

    submitFirstHint(room, guestToken, 'New York')
    expect(hinting(room).hintStatuses).toEqual([
      {
        playerId: hinting(room).player.playerId,
        name: 'Ada',
        submitted: true,
        needsRevision: false,
        hint: 'Orbit',
        hintNumber: 2,
      },
      {
        playerId: guestId,
        name: 'Grace',
        submitted: true,
        needsRevision: false,
        hint: 'New York',
        hintNumber: 2,
      },
    ])
    expect(
      room.rejectHint(guestToken, {
        roomCode: room.code,
        playerId: hinting(room).player.playerId,
      }),
    ).toMatchObject({ status: 'forbidden' })
    expect(
      room.rejectHint(hostToken, {
        roomCode: room.code,
        playerId: hinting(room).player.playerId,
      }),
    ).toMatchObject({ status: 'forbidden' })

    const submittedGuestBoard = hinting(room, guestToken).board!
    expect(
      room.rejectHint(hostToken, { roomCode: room.code, playerId: guestId }),
    ).toEqual({ status: 'success' })
    expect(hinting(room).hintStatuses).toEqual([
      expect.objectContaining({
        name: 'Ada',
        submitted: true,
        needsRevision: false,
        hint: 'Orbit',
        hintNumber: 2,
      }),
      expect.objectContaining({
        name: 'Grace',
        submitted: false,
        needsRevision: true,
        hint: null,
        hintNumber: null,
      }),
    ])
    expect(hinting(room, guestToken)).toMatchObject({
      hint: null,
      hintSubmitted: false,
      hintRejected: true,
    })
    const replacementGuestBoard = hinting(room, guestToken).board!
    expect(replacementGuestBoard).toHaveLength(12)
    expect(replacementGuestBoard.map(({ id }) => id)).not.toEqual(
      submittedGuestBoard.map(({ id }) => id),
    )
    expect(replacementGuestBoard.every(({ id }) => id.startsWith('p2-'))).toBe(
      true,
    )
    expect(
      replacementGuestBoard.filter(({ kind }) => kind === 'neutral'),
    ).toHaveLength(8)
    expect(replacementGuestBoard.filter(({ locked }) => locked)).toHaveLength(4)
    expect(room.startGuessing(hostToken)).toMatchObject({ status: 'invalid' })
    expect(submitFirstHint(room, guestToken, 'City')).toEqual({
      status: 'success',
    })
    expect(hinting(room, guestToken)).toMatchObject({
      allHintsSubmitted: true,
      hintRejected: false,
    })
  })

  it('lets the host reject a submitted hint while another player is still choosing', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.join(thirdToken, 'Linus', 1_002)
    room.start(hostToken, 1_003)
    submitFirstHint(room, hostToken, 'Orbit')
    submitFirstHint(room, guestToken, 'Garden')

    const before = hinting(room, thirdToken)
    expect(before.allHintsSubmitted).toBe(false)
    expect(
      before.hintStatuses.map(({ hint, hintNumber }) => ({ hint, hintNumber })),
    ).toEqual([
      { hint: 'Orbit', hintNumber: 2 },
      { hint: 'Garden', hintNumber: 2 },
      { hint: null, hintNumber: null },
    ])

    const guestId = hinting(room, guestToken).player.playerId
    expect(
      room.rejectHint(hostToken, { roomCode: room.code, playerId: guestId }),
    ).toEqual({ status: 'success' })
    expect(hinting(room).hintStatuses).toEqual([
      expect.objectContaining({ name: 'Ada', hint: 'Orbit', hintNumber: 2 }),
      expect.objectContaining({
        name: 'Grace',
        submitted: false,
        needsRevision: true,
        hint: null,
        hintNumber: null,
      }),
      expect.objectContaining({ name: 'Linus', hint: null, hintNumber: null }),
    ])
  })

  it('does not reject a departed player hint that was removed', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.join(thirdToken, 'Linus', 1_002)
    room.start(hostToken, 1_003)
    const hostId = hinting(room).player.playerId
    room.leave(hostToken, 1_004)
    submitFirstHint(room, guestToken, 'Garden')
    submitFirstHint(room, thirdToken, 'Metal')

    expect(hinting(room, guestToken)).toMatchObject({
      player: { role: 'host' },
      allHintsSubmitted: true,
    })
    expect(
      room.rejectHint(guestToken, { roomCode: room.code, playerId: hostId }),
    ).toMatchObject({ status: 'stale' })
    expect(room.startGuessing(guestToken)).toEqual({ status: 'success' })
  })

  it('removes a rejected hinting seat and creates a clean seat on rejoin', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    submitFirstHint(room, hostToken, 'Garden')
    submitFirstHint(room, guestToken, 'Metal')
    const guestId = hinting(room, guestToken).player.playerId

    expect(
      room.rejectHint(hostToken, { roomCode: room.code, playerId: guestId }),
    ).toEqual({ status: 'success' })
    expect(room.leave(guestToken, 1_003)).toEqual({ status: 'success' })
    expect(hinting(room).hintStatuses).toEqual([
      expect.objectContaining({
        name: 'Ada',
        submitted: true,
        needsRevision: false,
      }),
    ])
    expect(room.startGuessing(hostToken)).toMatchObject({ status: 'invalid' })
    expect(room.join(guestToken, 'Grace', 1_004)).toEqual({ status: 'success' })
    expect(hinting(room, guestToken)).toMatchObject({
      hint: null,
      hintSubmitted: false,
      hintRejected: false,
    })
    submitFirstHint(room, guestToken, 'Metal')
    expect(room.startGuessing(hostToken)).toEqual({ status: 'success' })
  })

  it('orders late hinting joins atomically before the guessing cutoff', () => {
    const joinedFirst = createRoom()
    joinedFirst.join(guestToken, 'Grace', 1_001)
    joinedFirst.start(hostToken, 1_002)
    submitFirstHint(joinedFirst, hostToken, 'Orbit')
    expect(joinedFirst.snapshotFor(thirdToken)).toEqual({
      status: 'joinable',
      roomCode: joinedFirst.code,
      joinsAsSpectator: false,
    })
    expect(joinedFirst.join(thirdToken, 'Linus', 1_003)).toEqual({
      status: 'success',
    })
    const late = hinting(joinedFirst, thirdToken)
    expect(late.player.participation).toBe('player')
    expect(late.board).toHaveLength(12)
    expect(late.hintStatuses.map(({ name }) => name)).toEqual([
      'Ada',
      'Grace',
      'Linus',
    ])
    expect(joinedFirst.startGuessing(hostToken)).toMatchObject({
      status: 'invalid',
    })
    submitFirstHint(joinedFirst, guestToken, 'Garden')
    submitFirstHint(joinedFirst, thirdToken, 'Metal')
    expect(joinedFirst.startGuessing(hostToken)).toEqual({ status: 'success' })
    expect(guessing(joinedFirst)).toMatchObject({ totalTurns: 3 })

    const cutoffFirst = createRoom()
    cutoffFirst.join(guestToken, 'Grace', 1_001)
    cutoffFirst.start(hostToken, 1_002)
    submitFirstHint(cutoffFirst, hostToken, 'Orbit')
    submitFirstHint(cutoffFirst, guestToken, 'Garden')
    cutoffFirst.startGuessing(hostToken, 1_003)
    expect(cutoffFirst.snapshotFor(thirdToken)).toEqual({
      status: 'joinable',
      roomCode: cutoffFirst.code,
      joinsAsSpectator: true,
    })
    expect(cutoffFirst.join(thirdToken, 'Linus', 1_004)).toEqual({
      status: 'success',
    })
    expect(guessing(cutoffFirst, thirdToken).player.participation).toBe(
      'spectator',
    )
  })

  it('admits a hinting leaver as a spectator after guessing starts', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.join(thirdToken, 'Linus', 1_002)
    room.start(hostToken, 1_003)

    expect(room.leave(thirdToken, 1_004)).toEqual({ status: 'success' })
    submitFirstHint(room, hostToken, 'Orbit')
    submitFirstHint(room, guestToken, 'Garden')
    expect(room.startGuessing(hostToken, 1_005)).toEqual({ status: 'success' })
    expect(guessing(room).totalTurns).toBe(2)

    expect(room.join(thirdToken, 'Linus', 1_006)).toEqual({ status: 'success' })
    expect(guessing(room, thirdToken)).toMatchObject({
      player: { participation: 'spectator' },
      totalTurns: 2,
    })
    expect(
      guessing(room, thirdToken).scoreboard.find(
        ({ name }) => name === 'Linus',
      ),
    ).toMatchObject({ participation: 'spectator', position: null, score: null })
  })

  it('removes hinting participants and resets a one-player round to the lobby', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.join(thirdToken, 'Linus', 1_002)
    room.start(hostToken, 1_003)
    submitFirstHint(room, guestToken, 'Garden')
    const hostId = hinting(room).player.playerId
    const guestId = hinting(room, guestToken).player.playerId
    const thirdId = hinting(room, thirdToken).player.playerId

    expect(room.removePlayer(guestToken, thirdId)).toMatchObject({
      status: 'forbidden',
    })
    expect(room.removePlayer(hostToken, hostId)).toMatchObject({
      status: 'forbidden',
    })
    expect(room.removePlayer(hostToken, guestId)).toEqual({
      status: 'success',
      removedToken: guestToken,
    })
    expect(hinting(room).hintStatuses.map(({ name }) => name)).toEqual([
      'Ada',
      'Linus',
    ])
    expect(room.snapshotFor(guestToken)).toEqual({
      status: 'removed_from_room',
      roomCode: room.code,
    })
    expect(room.join(guestToken, 'Grace again')).toMatchObject({
      status: 'removed_from_room',
    })
    expect(room.removePlayer(hostToken, guestId)).toMatchObject({
      status: 'stale',
    })
    expect(room.removePlayer(hostToken, thirdId)).toEqual({
      status: 'invalid',
      message:
        'Removing this player ends the current round. Confirm the removal again to return everyone to the lobby.',
    })
    expect(room.removePlayer(hostToken, thirdId, true)).toEqual({
      status: 'success',
      removedToken: thirdToken,
    })
    expect(room.snapshotFor(hostToken)).toMatchObject({
      status: 'lobby',
      roomCode: room.code,
      members: [
        {
          name: 'Ada',
          role: 'host',
          participation: 'player',
        },
      ],
    })
    expect(room.snapshotFor(thirdToken)).toEqual({
      status: 'removed_from_room',
      roomCode: room.code,
    })
    expect(room.join(fourthToken, 'Margaret')).toEqual({ status: 'success' })
    expect(room.start(hostToken)).toEqual({ status: 'success' })
    expect(hinting(room)).toMatchObject({
      hint: null,
      hintSubmitted: false,
      hintStatuses: [
        { name: 'Ada', submitted: false },
        { name: 'Margaret', submitted: false },
      ],
    })
  })

  it('deactivates a removed guesser without deleting their board, turn, or score history', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.join(thirdToken, 'Linus', 1_002)
    room.start(hostToken, 1_003)
    const guestTargetId = hinting(room, guestToken).board!.filter(
      ({ kind }) => kind === 'neutral',
    )[0].id
    submitFirstHint(room, hostToken, 'Orbit')
    submitFirstHint(room, guestToken, 'Garden')
    submitFirstHint(room, thirdToken, 'Metal')
    room.startGuessing(hostToken, 1_004)

    const before = guessing(room)
    const guestId = guessing(room, guestToken).player.playerId
    expect(room.removePlayer(hostToken, guestId, false, 1_005)).toEqual({
      status: 'success',
      removedToken: guestToken,
    })

    const after = guessing(room)
    expect(after.totalTurns).toBe(before.totalTurns)
    expect(after.board).toEqual(before.board)
    expect(after.scoreboard.map(({ name }) => name)).toEqual([
      'Ada',
      'Grace',
      'Linus',
    ])
    expect(after.turnPlayers).toContainEqual({
      playerId: guestId,
      name: 'Grace',
      state: 'done',
    })
    expect(room.snapshotFor(guestToken)).toEqual({
      status: 'removed_from_room',
      roomCode: room.code,
    })
    expect(room.removePlayer(hostToken, guestId)).toMatchObject({
      status: 'stale',
    })

    expect(
      room.finishGuessing(thirdToken, {
        roomCode: room.code,
        turnId: after.turnId,
      }),
    ).toEqual({ status: 'success' })
    expect(guessing(room).canAdvanceTurn).toBe(true)
    expect(room.advanceTurn(hostToken, 1_006)).toEqual({ status: 'success' })

    const removedPlayersBoard = guessing(room)
    expect(removedPlayersBoard).toMatchObject({
      turnNumber: 2,
      totalTurns: 3,
      clueGiverId: guestId,
      clueGiverName: 'Grace',
      hint: 'Garden',
    })
    expect(
      room.claimCard(hostToken, {
        roomCode: room.code,
        turnId: removedPlayersBoard.turnId,
        commandId: 'removed-clue-giver-score',
        cardId: guestTargetId,
      }),
    ).toEqual({ status: 'success', kind: 'target' })
    expect(
      guessing(room).scoreboard.find(({ playerId }) => playerId === guestId),
    ).toMatchObject({ name: 'Grace', score: 3 })
  })

  it('never reuses a private board index after removal and reindexing', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.join(thirdToken, 'Linus', 1_002)
    room.start(hostToken, 1_003)
    const guestId = hinting(room, guestToken).player.playerId
    const thirdBoardIds = hinting(room, thirdToken).board!.map(({ id }) => id)

    expect(room.removePlayer(hostToken, guestId)).toMatchObject({
      status: 'success',
    })
    expect(room.join(fourthToken, 'Margaret', 1_004)).toEqual({
      status: 'success',
    })
    const replacement = hinting(room, fourthToken)
    expect(replacement.board).toHaveLength(12)
    expect(replacement.board!.map(({ id }) => id)).not.toEqual(thirdBoardIds)
    expect(replacement.board!.every(({ id }) => id.startsWith('p3-'))).toBe(
      true,
    )
    expect(replacement.hintStatuses.map(({ name }) => name)).toEqual([
      'Ada',
      'Linus',
      'Margaret',
    ])
  })

  it('caps late participants at twelve and clearly admits overflow as spectators', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    for (let index = 0; index < 10; index += 1) {
      expect(
        room.join((index + 10).toString(16).padStart(32, '0'), `Late ${index}`),
      ).toEqual({ status: 'success' })
    }
    const returningToken = (10).toString(16).padStart(32, '0')
    expect(room.leave(returningToken)).toEqual({ status: 'success' })
    expect(room.snapshotFor(returningToken)).toMatchObject({
      status: 'joinable',
      joinsAsSpectator: false,
    })
    expect(room.join(returningToken, 'Late 0')).toEqual({ status: 'success' })
    expect(hinting(room, returningToken).player.participation).toBe('player')

    const overflowToken = 'f'.repeat(32)
    expect(room.snapshotFor(overflowToken)).toMatchObject({
      status: 'joinable',
      joinsAsSpectator: true,
    })
    expect(room.join(overflowToken, 'Spectator')).toEqual({
      status: 'success',
    })
    expect(hinting(room, overflowToken)).toMatchObject({
      player: { participation: 'spectator' },
      board: null,
    })
    expect(hinting(room).hintStatuses).toHaveLength(12)
  })

  it('admits new identities and returning leavers with fresh seats during hinting', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const departedBoardIds = hinting(room, guestToken).board!.map(
      ({ id }) => id,
    )
    room.leave(guestToken, 1_003)
    expect(room.join(guestToken, 'Grace', 1_004)).toEqual({ status: 'success' })
    expect(hinting(room, guestToken).player.participation).toBe('player')
    expect(hinting(room, guestToken).board!.map(({ id }) => id)).not.toEqual(
      departedBoardIds,
    )

    expect(room.join(thirdToken, 'Linus', 1_005)).toEqual({ status: 'success' })
    const latePlayer = hinting(room, thirdToken)
    expect(latePlayer.player.participation).toBe('player')
    expect(latePlayer.board).toHaveLength(12)
    expect(
      room.submitHint(thirdToken, {
        roomCode: room.code,
        hint: 'Metal',
        targetCardIds: [
          latePlayer.board!.find(({ kind }) => kind === 'neutral')!.id,
        ],
      }),
    ).toMatchObject({ status: 'success' })
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
        turnId: guestView.turnId,
        cardId: target.id,
      }),
    ).toEqual({ status: 'success', kind: 'target' })
    expect(
      guessing(room)
        .scoreboard.filter(({ participation }) => participation === 'player')
        .map(({ score }) => score),
    ).toEqual([3, 3])

    const afterTarget = guessing(room, guestToken)
    const civilian = guessing(room, hostToken).board.find(
      ({ revealedKind }) => revealedKind === 'civilian',
    )!
    expect(
      room.claimCard(guestToken, {
        roomCode: room.code,
        commandId: 'civilian-command-1',
        turnId: afterTarget.turnId,
        cardId: civilian.id,
      }),
    ).toEqual({ status: 'success', kind: 'civilian' })
    expect(guessing(room, guestToken).canGuess).toBe(false)
    expect(
      guessing(room, guestToken)
        .scoreboard.filter(({ participation }) => participation === 'player')
        .map(({ score }) => score),
    ).toEqual([2, 2])
  })

  it('globally completes and reveals the board on the first assassin claim', () => {
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
        turnId: guestView.turnId,
        cardId: assassin.id,
      }),
    ).toEqual({ status: 'success', kind: 'assassin' })

    const thirdView = guessing(room, thirdToken)
    expect(thirdView.board.every(({ revealedKind }) => revealedKind)).toBe(true)
    expect(thirdView.canGuess).toBe(false)
    expect(guessing(room, hostToken).canAdvanceTurn).toBe(true)
    const scores = thirdView.scoreboard.filter(
      ({ participation }) => participation === 'player',
    )
    expect(scores.map(({ score }) => score)).toEqual([-5, -5, 0])
    expect(
      room.claimCard(thirdToken, {
        roomCode: room.code,
        commandId: 'assassin-command-2',
        turnId: thirdView.turnId,
        cardId: assassin.id,
      }),
    ).toMatchObject({ status: 'forbidden' })
  })

  it('lets only the host advance each clue and finishes after every starting player has one turn', () => {
    const room = startTwoPlayerGame()
    expect(room.advanceTurn(guestToken)).toMatchObject({ status: 'forbidden' })
    expect(room.advanceTurn(hostToken)).toMatchObject({ status: 'invalid' })
    finishActiveGuessers(room)
    expect(room.advanceTurn(hostToken)).toEqual({ status: 'success' })
    expect(guessing(room).turnNumber).toBe(2)
    expect(guessing(room).clueGiverName).toBe('Grace')
    const finalTurn = guessing(room)
    expect(room.advanceTurn(hostToken)).toMatchObject({ status: 'invalid' })
    expect(guessing(room)).toEqual(finalTurn)
    finishActiveGuessers(room)
    expect(guessing(room).canAdvanceTurn).toBe(true)
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
        turnId: '00000000-0000-4000-8000-000000000000',
        cardId: target.id,
      }),
    ).toMatchObject({ status: 'stale' })
    expect(guessing(room).scoreboard.map(({ score }) => score)).toEqual([0, 0])
  })

  describe('spectator host succession', () => {
    const spectatorToken = 'd'.repeat(32)

    it('requires every earlier active member to leave before a spectator inherits host authority', () => {
      const room = startTwoPlayerGame()
      room.join(spectatorToken, 'Spectator', 1_004)

      expect(guessing(room, spectatorToken)).toMatchObject({
        player: { role: 'player', participation: 'spectator' },
      })
      expect(room.startGuessing(spectatorToken)).toMatchObject({
        status: 'forbidden',
      })

      room.leave(hostToken, 1_005)
      expect(guessing(room, guestToken).player.role).toBe('host')
      expect(guessing(room, spectatorToken).player.role).toBe('player')
      expect(room.startGuessing(spectatorToken)).toMatchObject({
        status: 'forbidden',
      })

      room.leave(guestToken, 1_006)
      expect(guessing(room, spectatorToken).player).toMatchObject({
        role: 'host',
        participation: 'spectator',
      })
    })

    it('lets a legitimate spectator successor operate host transitions without gaining player-only actions', () => {
      const room = startTwoPlayerGame()
      room.join(spectatorToken, 'Spectator', 1_004)
      room.leave(hostToken, 1_005)
      room.leave(guestToken, 1_006)

      const inherited = guessing(room, spectatorToken)
      expect(inherited).toMatchObject({
        player: { role: 'host', participation: 'spectator' },
        canGuess: false,
        canMarkDone: false,
        canAdvanceTurn: true,
      })
      expect(JSON.stringify(inherited)).not.toContain(hostToken)
      expect(JSON.stringify(inherited)).not.toContain(guestToken)
      expect(
        room.submitHint(spectatorToken, {
          roomCode: room.code,
          hint: 'No private seat',
          targetCardIds: ['not-a-card'],
        }),
      ).toMatchObject({ status: 'forbidden' })

      const firstTurn = guessing(room, spectatorToken)
      expect(firstTurn).toMatchObject({
        player: { role: 'host', participation: 'spectator' },
        canGuess: false,
        canMarkDone: false,
        canAdvanceTurn: true,
      })
      expect(
        firstTurn.board.every(
          ({ revealedKind, claimedBy, disabled }) =>
            revealedKind !== null && claimedBy.length === 0 && disabled,
        ),
      ).toBe(true)
      expect(
        room.finishGuessing(spectatorToken, {
          roomCode: room.code,
          turnId: firstTurn.turnId,
        }),
      ).toMatchObject({ status: 'forbidden' })
      expect(
        room.claimCard(spectatorToken, {
          roomCode: room.code,
          turnId: firstTurn.turnId,
          commandId: 'spectator-host-claim',
          cardId: firstTurn.board[0]!.id,
        }),
      ).toMatchObject({ status: 'forbidden' })

      expect(room.advanceTurn(spectatorToken, 1_007)).toEqual({
        status: 'success',
      })
      expect(guessing(room, spectatorToken).canAdvanceTurn).toBe(true)
      expect(room.advanceTurn(spectatorToken, 1_008)).toEqual({
        status: 'success',
      })
      expect(room.snapshotFor(spectatorToken)).toMatchObject({
        status: 'finished',
        player: { role: 'host', participation: 'spectator' },
      })

      room.join(hostToken, 'Ada', 1_009)
      room.join(guestToken, 'Grace', 1_010)
      expect(room.snapshotFor(hostToken)).toMatchObject({
        player: { role: 'player', participation: 'player' },
      })
      expect(room.snapshotFor(guestToken)).toMatchObject({
        player: { role: 'player', participation: 'player' },
      })
    })
  })
})
