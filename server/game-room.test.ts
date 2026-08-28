import { describe, expect, it } from 'vitest'

import { GameRoom, MAX_ROOM_IDENTITIES, MAX_ROOM_MEMBERS } from './game-room'

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
      ?.filter(({ kind }) => kind === 'target' || kind === 'neutral')
      .sort((a, b) => Number(b.kind === 'target') - Number(a.kind === 'target'))
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
          revision: view.revision,
        }),
      ).toEqual({ status: 'success' })
    }
  }
}

describe('GameRoom single-round flow', () => {
  it.each([false, true])(
    'counts the fixed target when a player leaves before hinting (rejoins: %s)',
    (rejoins) => {
      const room = createRoom()
      room.join(guestToken, 'Grace', 1_001)
      room.start(hostToken, 1_002)
      const originalBoard = hinting(room).board!
      const fixedTarget = originalBoard.find(({ kind }) => kind === 'target')!

      expect(room.leave(hostToken, 1_003)).toEqual({ status: 'success' })
      if (rejoins) {
        expect(room.join(hostToken, 'Ada', 1_004)).toEqual({
          status: 'success',
        })
        expect(hinting(room).board).toEqual(originalBoard)
        expect(hinting(room).hintSubmitted).toBe(true)
      }
      expect(submitFirstHint(room, guestToken, 'Garden')).toEqual({
        status: 'success',
      })
      expect(room.startGuessing(guestToken, 1_005)).toEqual({
        status: 'success',
      })
      const view = guessing(room, guestToken)
      expect(view.hint).toBe('PASS')
      expect(view.hintNumber).toBe(1)
      expect(
        view.board.every(({ revealedKind }) => revealedKind === null),
      ).toBe(true)
      expect(
        room.claimCard(guestToken, {
          roomCode: room.code,
          commandId: 'departed-fixed-target',
          revision: view.revision,
          cardId: fixedTarget.id,
        }),
      ).toEqual({ status: 'success', kind: 'target' })
      const after = guessing(room, guestToken)
      expect(after.scoreboard.map(({ score }) => score)).toEqual([1, 1])
      expect(after.canGuess).toBe(false)
      expect(after.canAdvanceTurn).toBe(true)
    },
  )

  it('rejects fixed-role tampering atomically and keeps assignments through resubmission and rejoin', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const before = hinting(room)
    const board = before.board!
    const target = board.find(({ kind }) => kind === 'target')!
    const neutral = board.find(({ kind }) => kind === 'neutral')!
    const forbidden = board.filter(
      ({ kind }) => kind === 'civilian' || kind === 'assassin',
    )
    for (const targetCardIds of [
      [],
      [neutral.id],
      [target.id, target.id],
      [target.id, 'not-a-card'],
      ...forbidden.map(({ id }) => [target.id, id]),
      [target.id, hinting(room, guestToken).board![0].id],
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
        targetCardIds: [target.id],
      }),
    ).toEqual({ status: 'success' })
    expect(hinting(room).board).toEqual(board)
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'Changed',
        targetCardIds: [neutral.id],
      }),
    ).toMatchObject({ status: 'invalid' })
    room.leave(hostToken)
    room.join(hostToken, 'Ada')
    expect(hinting(room).board).toEqual(board)
    expect(hinting(room).hintSubmitted).toBe(true)
    room.join(thirdToken, 'Spectator')
    expect(hinting(room, thirdToken).board).toBeNull()
    submitFirstHint(room, guestToken, 'Garden')
    room.startGuessing(guestToken)
    expect(guessing(room).hintNumber).toBe(1)
    expect(
      guessing(room).board.filter(
        ({ revealedKind }) => revealedKind === 'target',
      ),
    ).toHaveLength(1)
    expect(
      guessing(room, guestToken).board.every(
        (card) => card.revealedKind === null && !('locked' in card),
      ),
    ).toBe(true)
  })

  it('allows all eight editable words as targets without changing the four locks', () => {
    const room = createRoom()
    room.join(guestToken, 'Grace', 1_001)
    room.start(hostToken, 1_002)
    const board = hinting(room).board!
    const targetCardIds = board
      .filter(({ kind }) => kind === 'neutral' || kind === 'target')
      .map(({ id }) => id)
    expect(targetCardIds).toHaveLength(9)
    expect(
      room.submitHint(hostToken, {
        roomCode: room.code,
        hint: 'All',
        targetCardIds,
      }),
    ).toEqual({ status: 'success' })
    submitFirstHint(room, guestToken, 'Garden')
    room.startGuessing(hostToken)
    expect(guessing(room).hintNumber).toBe(9)
    expect(
      guessing(room).board.filter(
        ({ revealedKind }) => revealedKind === 'civilian',
      ),
    ).toHaveLength(2)
  })
  it('rejects advancement without effects until the last eligible picker finishes', () => {
    const room = startTwoPlayerGame(true)
    const spectator = 'd'.repeat(32)
    room.join(spectator, 'Spectator')
    const payload = { roomCode: room.code, revision: guessing(room).revision }
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
    expect(guessing(room).turnNumber).toBe(1)
    expect(guessing(room, guestToken).canAdvanceTurn).toBe(false)
    expect(guessing(room, spectator).canAdvanceTurn).toBe(false)
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
      revision: guessing(room).revision,
    })
    expect(guessing(room).canGuess).toBe(false)
    expect(guessing(room).canAdvanceTurn).toBe(false)
    expect(room.advanceTurn(hostToken)).toMatchObject({ status: 'invalid' })
    room.finishGuessing(thirdToken, {
      roomCode: room.code,
      revision: guessing(room).revision,
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
          revision: before.revision,
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
    const before = guessing(room)
    const targets = before.board.filter(
      ({ revealedKind }) => revealedKind === 'target',
    )
    for (const [index, card] of targets.entries()) {
      const payload = {
        roomCode: room.code,
        revision: before.revision,
        cardId: card.id,
        commandId: `target-${index}`,
      }
      const token = index === 0 ? guestToken : thirdToken
      expect(room.claimCard(token, payload)).toEqual({
        status: 'success',
        kind: 'target',
      })
      const after = guessing(room)
      expect(after.canAdvanceTurn).toBe(index === targets.length - 1)
      expect(room.claimCard(token, payload)).toEqual({
        status: 'success',
        kind: 'target',
      })
      expect(guessing(room)).toEqual(after)
    }
    expect(guessing(room).turnNumber).toBe(1)
    for (const token of [guestToken, thirdToken]) {
      expect(guessing(room, token).canGuess).toBe(false)
    }
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
    const payload = { roomCode: room.code, revision: guessing(room).revision }
    expect(room.finishGuessing(hostToken, payload)).toMatchObject({
      status: 'forbidden',
    })
    expect(
      room.finishGuessing(guestToken, {
        ...payload,
        revision: payload.revision + 1,
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
        revision: returned.revision,
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
            revision: before.revision,
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
            revision: before.revision,
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
          revision: finished.revision,
          commandId: 'after-finishing',
        }),
      ).toMatchObject({ status: 'forbidden' })
      expect(guessing(room, guestToken)).toEqual(finished)

      for (const token of [thirdToken, spectatorToken]) {
        const view = guessing(room, token)
        expect(
          view.board.filter(({ revealedKind }) => revealedKind !== null),
        ).toHaveLength(ending === 'civilian' ? 1 : 0)
        const assassin = before.board.find(
          ({ revealedKind }) => revealedKind === 'assassin',
        )!
        expect(view.board.find(({ id }) => id === assassin.id)).toMatchObject({
          revealedKind: null,
          claimedBy: [],
          selectedByYou: false,
          disabled: token === spectatorToken,
        })
      }
      expect(
        room.claimCard(thirdToken, {
          roomCode: room.code,
          cardId: target.id,
          revision: before.revision,
          commandId: 'active-picker-target',
        }),
      ).toEqual({ status: 'success', kind: 'target' })

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
          revision: finished.revision,
          commandId: 'previous-turn',
        }),
      ).toMatchObject({ status: 'stale' })
      expect(guessing(room, guestToken)).toEqual(next)
    },
  )

  it.each(['target', 'civilian', 'assassin'] as const)(
    'arbitrates same-revision %s claims and retries without duplicate effects',
    (kind) => {
      const room = startTwoPlayerGame(true)
      const before = guessing(room)
      const card = before.board.find(
        ({ revealedKind }) => revealedKind === kind,
      )!
      const payload = {
        roomCode: room.code,
        cardId: card.id,
        revision: before.revision,
        commandId: 'same-command-id-per-player',
      }
      expect(room.claimCard(guestToken, payload)).toEqual({
        status: 'success',
        kind,
      })
      const second = room.claimCard(thirdToken, payload)
      expect(second).toMatchObject({
        status: kind === 'assassin' ? 'success' : 'already_claimed',
      })
      const after = guessing(room)
      expect(after.board.find(({ id }) => id === card.id)?.claimedBy).toEqual(
        kind === 'assassin' ? ['Grace', 'Linus'] : ['Grace'],
      )
      expect(after.scoreboard.map(({ score }) => score)).toEqual(
        kind === 'assassin'
          ? [-2, -1, -1]
          : kind === 'target'
            ? [1, 1, 0]
            : [0, 0, 0],
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
          revision: after.revision,
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
      host.board
        ?.filter(({ kind }) => kind === 'target' || kind === 'neutral')
        .sort(
          (a, b) => Number(b.kind === 'target') - Number(a.kind === 'target'),
        )
        .slice(0, 3) ?? []

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
        revision: hostView.revision - 1,
        cardId: target.id,
      }),
    ).toMatchObject({ status: 'stale' })
    expect(guessing(room).scoreboard.map(({ score }) => score)).toEqual([0, 0])
  })
})
