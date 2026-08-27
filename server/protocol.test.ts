import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  io as createClient,
  type Socket as ClientSocket,
} from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GAME_PROTOCOL_VERSION,
  type ClientToServerEvents,
  type RoomSnapshot,
  type ServerToClientEvents,
} from '../lib/game-protocol'
import { createGameSocketServer } from './protocol'

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>

const hostToken = 'a'.repeat(32)
const guestToken = 'b'.repeat(32)
const spectatorToken = 'c'.repeat(32)
const allowedOrigin = 'http://localhost:3100'

describe('Socket.IO Secret Hitman protocol', () => {
  let httpServer: HttpServer
  let socketServer: ReturnType<typeof createGameSocketServer>
  let url: string
  const clients: TestClient[] = []
  const logError = vi.fn()

  beforeEach(async () => {
    logError.mockClear()
    httpServer = createServer()
    socketServer = createGameSocketServer(httpServer, {
      allowedOrigins: [allowedOrigin],
      entryCommandLimits: {
        perPlayerPerMinute: 30,
        perAddressPerMinute: 2,
        globalPerMinute: 2_000,
      },
      logger: { info() {}, warn() {}, error: logError },
    })
    await new Promise<void>((resolve) =>
      httpServer.listen(0, '127.0.0.1', resolve),
    )
    const address = httpServer.address() as AddressInfo
    url = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    for (const client of clients) client.disconnect()
    clients.length = 0
    if (httpServer.listening) await socketServer.shutdown()
    vi.restoreAllMocks()
  })

  async function connect(
    token: string,
    forwardedFor?: string,
    connectingIp?: string,
  ) {
    const client: TestClient = createClient(url, {
      auth: { token, protocolVersion: GAME_PROTOCOL_VERSION },
      extraHeaders: {
        Origin: allowedOrigin,
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
        ...(connectingIp ? { 'do-connecting-ip': connectingIp } : {}),
      },
      forceNew: true,
      transports: ['websocket'],
    })
    clients.push(client)
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve)
      client.once('connect_error', reject)
    })
    return client
  }

  it.each([true, false])(
    'trusts the provider header only when explicitly enabled: %s',
    async (enabled) => {
      await socketServer.shutdown()
      httpServer = createServer()
      socketServer = createGameSocketServer(httpServer, {
        allowedOrigins: [allowedOrigin],
        trustDigitalOceanProxy: enabled,
        entryCommandLimits: {
          perPlayerPerMinute: 30,
          perAddressPerMinute: 2,
          globalPerMinute: 2000,
        },
        logger: { info() {}, warn() {}, error: logError },
      })
      await new Promise<void>((resolve) =>
        httpServer.listen(0, '127.0.0.1', resolve),
      )
      url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
      const first = await connect(hostToken, '203.0.113.1', '198.51.100.1')
      const second = await connect(guestToken, '203.0.113.2', '198.51.100.1')
      expect(
        await first.emitWithAck('room:create', { name: 'Ada' }),
      ).toMatchObject({ status: 'success' })
      expect(
        await first.emitWithAck('room:create', { name: 'Ada' }),
      ).toMatchObject({ status: 'success' })
      expect(
        await second.emitWithAck('room:create', { name: 'Grace' }),
      ).toMatchObject({ status: enabled ? 'rate_limited' : 'success' })
    },
  )

  it('shares the client address budget despite spoofed forwarding prefixes', async () => {
    const first = await connect(hostToken, '198.51.100.1, 203.0.113.7')
    const second = await connect(guestToken, '198.51.100.2, 203.0.113.7')

    expect(
      await first.emitWithAck('room:create', { name: 'Ada' }),
    ).toMatchObject({
      status: 'success',
    })
    expect(
      await second.emitWithAck('room:create', { name: 'Grace' }),
    ).toMatchObject({ status: 'success' })
    expect(
      await second.emitWithAck('room:create', { name: 'Grace' }),
    ).toMatchObject({ status: 'rate_limited' })
  })

  it('shares budgets across forwarded source ports without merging different IPs', async () => {
    const first = await connect(hostToken, '203.0.113.7:12345')
    const second = await connect(guestToken, '203.0.113.7:54321')
    const third = await connect(spectatorToken, '203.0.113.8:12345')
    expect(
      await first.emitWithAck('room:create', { name: 'Ada' }),
    ).toMatchObject({ status: 'success' })
    expect(
      await second.emitWithAck('room:create', { name: 'Grace' }),
    ).toMatchObject({ status: 'success' })
    expect(
      await second.emitWithAck('room:create', { name: 'Grace' }),
    ).toMatchObject({ status: 'rate_limited' })
    expect(
      await third.emitWithAck('room:create', { name: 'Linus' }),
    ).toMatchObject({ status: 'success' })
  })

  it('does not replace an explicit empty proxy allowlist with loopback trust', async () => {
    await socketServer.shutdown()
    httpServer = createServer()
    socketServer = createGameSocketServer(httpServer, {
      allowedOrigins: [allowedOrigin],
      trustedProxyAddresses: [],
      entryCommandLimits: {
        perPlayerPerMinute: 30,
        perAddressPerMinute: 2,
        globalPerMinute: 2_000,
      },
      logger: { info() {}, warn() {}, error: logError },
    })
    await new Promise<void>((resolve) =>
      httpServer.listen(0, '127.0.0.1', resolve),
    )
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
    const first = await connect(hostToken, '203.0.113.1')
    const second = await connect(guestToken, '203.0.113.2')
    const third = await connect(spectatorToken, '203.0.113.3')
    expect(
      await first.emitWithAck('room:create', { name: 'Ada' }),
    ).toMatchObject({ status: 'success' })
    expect(
      await second.emitWithAck('room:create', { name: 'Grace' }),
    ).toMatchObject({ status: 'success' })
    expect(
      await third.emitWithAck('room:create', { name: 'Linus' }),
    ).toMatchObject({ status: 'rate_limited' })
  })

  describe.each([undefined, null, 'not-a-callback'])(
    'with acknowledgement %s',
    (callback) => {
      it.each([
        'session:resume',
        'room:create',
        'room:join',
        'room:leave',
        'room:remove-player',
        'game:start',
        'game:submit-hint',
        'game:start-guessing',
        'game:claim-card',
        'game:finish-guessing',
        'game:advance-turn',
      ] satisfies (keyof ClientToServerEvents)[])(
        'handles %s without crashing',
        async (event) => {
          const client = await connect(hostToken)
          // Deliberately bypass the client types to model malformed wire packets.
          const rawClient = client as ClientSocket
          if (callback === undefined) rawClient.emit(event, {})
          else rawClient.emit(event, {}, callback)

          await expect(
            client.timeout(2_000).emitWithAck('session:resume', {}),
          ).resolves.toEqual({ status: 'success' })
          expect(logError).not.toHaveBeenCalled()
        },
      )
    },
  )

  it('creates a room and broadcasts its snapshot without an acknowledgement', async () => {
    const client = await connect(hostToken)
    const snapshot = new Promise<unknown>((resolve) =>
      client.once('room:snapshot', resolve),
    )
    ;(client as ClientSocket).emit('room:create', { name: 'Ada' })

    await expect(snapshot).resolves.toMatchObject({
      status: 'lobby',
      player: { name: 'Ada' },
    })
    expect(logError).not.toHaveBeenCalled()
  })

  it('handles rate-limited commands without acknowledgements', async () => {
    const client = await connect(hostToken)
    for (let index = 0; index < 45; index += 1) {
      ;(client as ClientSocket).emit('session:resume', {})
    }
    await expect(
      client.timeout(2_000).emitWithAck('session:resume', {}),
    ).resolves.toMatchObject({ status: 'rate_limited' })
    expect(logError).not.toHaveBeenCalled()
  })

  it.each(['room:create', 'game:start'] as const)(
    'contains %s failures without an acknowledgement',
    async (event) => {
      const client = await connect(hostToken)
      if (event === 'room:create')
        vi.spyOn(socketServer.gameServer, 'createRoom').mockImplementation(
          () => {
            throw new Error('test failure')
          },
        )
      else
        vi.spyOn(socketServer.gameServer, 'startGame').mockImplementation(
          () => {
            throw new Error('test failure')
          },
        )
      ;(client as ClientSocket).emit(
        event,
        event === 'room:create' ? { name: 'Ada' } : { roomCode: 'bcdf2' },
      )

      await vi.waitFor(() => expect(logError).toHaveBeenCalledOnce())
      expect(JSON.parse(logError.mock.calls[0][0] as string)).toMatchObject({
        event: 'command_failed',
        command: event,
        message: 'test failure',
      })
      await expect(
        client.timeout(2_000).emitWithAck('session:resume', {}),
      ).resolves.toEqual({ status: 'success' })
    },
  )

  it('does not grant the local token exemption to forwarded loopback clients', async () => {
    const first = await connect(hostToken, '127.0.0.1')
    const second = await connect(guestToken, '127.0.0.1')
    const third = await connect(spectatorToken, '127.0.0.1')

    expect(
      await first.emitWithAck('room:create', { name: 'Ada' }),
    ).toMatchObject({
      status: 'success',
    })
    expect(
      await second.emitWithAck('room:create', { name: 'Grace' }),
    ).toMatchObject({ status: 'success' })
    expect(
      await third.emitWithAck('room:create', { name: 'Linus' }),
    ).toMatchObject({ status: 'rate_limited' })
  })

  it('runs room entry, hint readiness, host transition, scoring, and spectator permissions', async () => {
    const host = await connect(hostToken)
    const guest = await connect(guestToken)
    const spectator = await connect(spectatorToken)

    const created = await host.emitWithAck('room:create', { name: 'Ada' })
    expect(created.status).toBe('success')
    if (created.status !== 'success') return
    const roomCode = created.roomCode
    expect(
      await guest.emitWithAck('room:join', { roomCode, name: 'Grace' }),
    ).toEqual({
      status: 'success',
      roomCode,
    })
    expect(await host.emitWithAck('game:start', { roomCode })).toEqual({
      status: 'success',
    })

    const hostHint = socketServer.gameServer.snapshot(hostToken, roomCode)
    const guestHint = socketServer.gameServer.snapshot(guestToken, roomCode)
    if (hostHint.status !== 'hinting' || guestHint.status !== 'hinting') {
      throw new Error('Expected hinting snapshots.')
    }
    if (!hostHint.board || !guestHint.board) {
      throw new Error('Expected boards for participating players.')
    }
    const hostTargets = hostHint.board
      .filter(({ kind }) => kind === 'neutral')
      .slice(0, 2)
      .map(({ id }) => id)
    const guestTargets = guestHint.board
      .filter(({ kind }) => kind === 'neutral')
      .slice(0, 3)
      .map(({ id }) => id)
    expect(hostTargets).toHaveLength(2)
    expect(guestTargets).toHaveLength(3)

    expect(
      await host.emitWithAck('game:submit-hint', {
        roomCode,
        hint: 'Orbit',
        targetCardIds: hostTargets,
      }),
    ).toEqual({ status: 'success' })
    expect(
      await guest.emitWithAck('game:submit-hint', {
        roomCode,
        hint: 'Garden',
        targetCardIds: guestTargets,
      }),
    ).toEqual({ status: 'success' })

    expect(
      await spectator.emitWithAck('room:join', { roomCode, name: 'Linus' }),
    ).toEqual({ status: 'success', roomCode })
    const spectatorHint = socketServer.gameServer.snapshot(
      spectatorToken,
      roomCode,
    )
    expect(spectatorHint).toMatchObject({
      status: 'hinting',
      player: { participation: 'spectator' },
      board: null,
    })
    expect(
      await spectator.emitWithAck('game:submit-hint', {
        roomCode,
        hint: 'Cheat',
        targetCardIds: hostTargets,
      }),
    ).toMatchObject({ status: 'forbidden' })

    expect(await host.emitWithAck('game:start-guessing', { roomCode })).toEqual(
      { status: 'success' },
    )
    const hostGuessing = socketServer.gameServer.snapshot(hostToken, roomCode)
    const guestGuessing = socketServer.gameServer.snapshot(guestToken, roomCode)
    if (
      hostGuessing.status !== 'guessing' ||
      guestGuessing.status !== 'guessing'
    ) {
      throw new Error('Expected guessing snapshots.')
    }
    const target = hostGuessing.board.find(
      ({ revealedKind }) => revealedKind === 'target',
    )
    if (!target) throw new Error('Expected a target card.')

    expect(
      await guest.emitWithAck('game:claim-card', {
        roomCode,
        commandId: 'guest-target-command',
        revision: guestGuessing.revision,
        cardId: target.id,
      }),
    ).toEqual({ status: 'success', kind: 'target' })
    expect(
      await spectator.emitWithAck('game:claim-card', {
        roomCode,
        commandId: 'spectator-command-1',
        revision: guestGuessing.revision,
        cardId: target.id,
      }),
    ).toMatchObject({ status: 'forbidden' })

    const scored = socketServer.gameServer.snapshot(guestToken, roomCode)
    if (scored.status !== 'guessing')
      throw new Error('Expected guessing snapshot.')
    expect(
      scored.scoreboard
        .filter(({ participation }) => participation === 'player')
        .map(({ score }) => score),
    ).toEqual([1, 1])
  })

  it.each(['active', 'pass', 'civilian', 'assassin'] as const)(
    'preserves guessing eligibility and private visibility across a socket disconnect: %s',
    async (ending) => {
      const host = await connect(hostToken)
      const guest = await connect(guestToken)
      const created = await host.emitWithAck('room:create', { name: 'Ada' })
      if (created.status !== 'success')
        throw new Error('Unable to create room.')
      const { roomCode } = created
      await guest.emitWithAck('room:join', { roomCode, name: 'Grace' })
      const server = socketServer.gameServer
      expect(server.startGame(hostToken, roomCode)).toEqual({
        status: 'success',
      })
      for (const token of [hostToken, guestToken]) {
        const view = server.snapshot(token, roomCode)
        if (view.status !== 'hinting' || !view.board)
          throw new Error('Expected hinting board.')
        const target = view.board.find(({ kind }) => kind === 'neutral')!
        expect(
          server.submitHint(token, {
            roomCode,
            hint: 'Orbit',
            targetCardIds: [target.id],
          }),
        ).toEqual({ status: 'success' })
      }
      expect(server.startGuessing(hostToken, roomCode)).toEqual({
        status: 'success',
      })
      const revealed = server.snapshot(hostToken, roomCode)
      const before = server.snapshot(guestToken, roomCode)
      if (revealed.status !== 'guessing' || before.status !== 'guessing')
        throw new Error('Expected guessing phase.')
      if (ending === 'pass') {
        expect(
          await guest.emitWithAck('game:finish-guessing', {
            roomCode,
            revision: before.revision,
          }),
        ).toEqual({ status: 'success' })
      } else if (ending !== 'active') {
        const card = revealed.board.find(
          ({ revealedKind }) => revealedKind === ending,
        )!
        expect(
          await guest.emitWithAck('game:claim-card', {
            roomCode,
            cardId: card.id,
            revision: before.revision,
            commandId: `${ending}-before-reconnect`,
          }),
        ).toEqual({ status: 'success', kind: ending })
      }
      const completed = server.snapshot(guestToken, roomCode)
      guest.disconnect()
      const reconnected = await connect(guestToken)
      const resumed = await reconnected.emitWithAck('session:resume', {
        roomCode,
      })
      expect(resumed).toMatchObject({
        status: 'success',
        snapshot: {
          status: 'guessing',
          player: { playerId: before.player.playerId },
          canGuess: ending === 'active',
          canMarkDone: ending === 'active',
        },
      })
      if (
        resumed.status !== 'success' ||
        resumed.snapshot?.status !== 'guessing'
      )
        throw new Error('Expected resumed guessing snapshot.')
      expect(resumed.snapshot).toEqual(completed)
      if (ending === 'pass') {
        expect(
          await reconnected.emitWithAck('game:finish-guessing', {
            roomCode,
            revision: before.revision,
          }),
        ).toEqual({ status: 'success' })
        expect(server.snapshot(guestToken, roomCode)).toEqual(completed)
      }
      expect(
        resumed.snapshot.board.map(({ revealedKind }) => revealedKind),
      ).toEqual(
        ending === 'active'
          ? before.board.map(({ revealedKind }) => revealedKind)
          : revealed.board.map(({ revealedKind }) => revealedKind),
      )
    },
  )

  it.each(['target', 'civilian', 'assassin'] as const)(
    'handles concurrent %s requests through distinct sockets with private broadcasts',
    async (kind) => {
      const host = await connect(hostToken)
      const guest = await connect(guestToken)
      const thirdToken = 'd'.repeat(32)
      const third = await connect(thirdToken)
      const spectator = await connect(spectatorToken)
      const created = await host.emitWithAck('room:create', { name: 'Ada' })
      if (created.status !== 'success')
        throw new Error('Unable to create room.')
      const { roomCode } = created
      await guest.emitWithAck('room:join', { roomCode, name: 'Grace' })
      await third.emitWithAck('room:join', { roomCode, name: 'Linus' })
      await host.emitWithAck('game:start', { roomCode })
      for (const [client, token] of [
        [host, hostToken],
        [guest, guestToken],
        [third, thirdToken],
      ] as const) {
        const view = socketServer.gameServer.snapshot(token, roomCode)
        if (view.status !== 'hinting' || !view.board)
          throw new Error('Expected private board.')
        expect(
          await client.emitWithAck('game:submit-hint', {
            roomCode,
            hint: 'Orbit',
            targetCardIds: view.board
              .filter(({ kind }) => kind === 'neutral')
              .slice(0, 2)
              .map(({ id }) => id),
          }),
        ).toEqual({ status: 'success' })
      }
      await spectator.emitWithAck('room:join', { roomCode, name: 'Spectator' })
      await host.emitWithAck('game:start-guessing', { roomCode })
      const before = socketServer.gameServer.snapshot(hostToken, roomCode)
      if (before.status !== 'guessing') throw new Error('Expected guessing.')
      const card = before.board.find(
        ({ revealedKind }) => revealedKind === kind,
      )!
      const spectatorSnapshots = vi.fn<(snapshot: RoomSnapshot) => void>()
      spectator.on('room:snapshot', spectatorSnapshots)
      const payload = {
        roomCode,
        cardId: card.id,
        revision: before.revision,
        commandId: `race-${kind}`,
      }
      const results = await Promise.all([
        guest.emitWithAck('game:claim-card', payload),
        third.emitWithAck('game:claim-card', payload),
      ])
      expect(results.map(({ status }) => status).sort()).toEqual(
        kind === 'assassin'
          ? ['success', 'success']
          : ['already_claimed', 'success'],
      )
      const after = socketServer.gameServer.snapshot(hostToken, roomCode)
      if (after.status !== 'guessing') throw new Error('Expected guessing.')
      const winnerNames = results.flatMap((result, index) =>
        result.status === 'success' ? [index === 0 ? 'Grace' : 'Linus'] : [],
      )
      expect(
        after.board.find(({ id }) => id === card.id)?.claimedBy.toSorted(),
      ).toEqual(winnerNames.toSorted())
      expect(
        after.scoreboard
          .filter(({ participation }) => participation === 'player')
          .map(({ score }) => score),
      ).toEqual(
        kind === 'assassin'
          ? [-2, -1, -1]
          : kind === 'civilian'
            ? [0, 0, 0]
            : [
                1,
                ...results.map(({ status }) => (status === 'success' ? 1 : 0)),
              ],
      )
      expect(await guest.emitWithAck('game:claim-card', payload)).toEqual(
        results[0],
      )
      expect(await third.emitWithAck('game:claim-card', payload)).toEqual(
        results[1],
      )
      expect(socketServer.gameServer.snapshot(hostToken, roomCode)).toEqual(
        after,
      )
      await vi.waitFor(() =>
        expect(spectatorSnapshots).toHaveBeenCalledWith(
          expect.objectContaining({ revision: after.revision }),
        ),
      )
      for (const [snapshot] of spectatorSnapshots.mock.calls) {
        if (
          snapshot.status !== 'guessing' ||
          snapshot.revision <= before.revision
        )
          continue
        const visibleCard = snapshot.board.find(({ id }) => id === card.id)
        expect(visibleCard).toMatchObject(
          kind === 'assassin'
            ? {
                revealedKind: null,
                claimedBy: [],
                selectedByYou: false,
                disabled: true,
              }
            : { revealedKind: kind, claimedBy: winnerNames, disabled: true },
        )
      }
    },
  )

  it('restores the same player identity after reconnecting', async () => {
    const host = await connect(hostToken)
    const guest = await connect(guestToken)
    const created = await host.emitWithAck('room:create', { name: 'Ada' })
    if (created.status !== 'success') throw new Error('Unable to create room.')
    await guest.emitWithAck('room:join', {
      roomCode: created.roomCode,
      name: 'Grace',
    })
    const before = socketServer.gameServer.snapshot(
      guestToken,
      created.roomCode,
    )
    if (before.status !== 'lobby') throw new Error('Expected lobby snapshot.')
    guest.disconnect()

    const reconnected = await connect(guestToken)
    const resumed = await reconnected.emitWithAck('session:resume', {
      roomCode: created.roomCode,
    })
    expect(resumed).toMatchObject({
      status: 'success',
      snapshot: {
        status: 'lobby',
        player: { playerId: before.player.playerId },
      },
    })
  })
})
