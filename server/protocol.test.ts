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
const watcherToken = 'd'.repeat(32)
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
      leaveIntentGraceMs: 20,
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

  async function createTwoPlayerLobby() {
    const host = await connect(hostToken)
    const guest = await connect(guestToken)
    const created = await host.emitWithAck('room:create', { name: 'Ada' })
    if (created.status !== 'success') throw new Error('Expected room creation.')
    await guest.emitWithAck('room:join', {
      roomCode: created.roomCode,
      name: 'Grace',
    })
    return { host, guest, roomCode: created.roomCode }
  }

  it('finalizes a leave intent after the reconnect grace period', async () => {
    const { guest, roomCode } = await createTwoPlayerLobby()

    await socketServer.receiveLeaveIntent(guestToken, [roomCode], guest.id!)
    guest.disconnect()
    await vi.waitFor(() =>
      expect(
        socketServer.gameServer.snapshot(hostToken, roomCode),
      ).toMatchObject({
        status: 'lobby',
        members: [{ name: 'Ada' }],
      }),
    )
  })

  it('cancels a pending leave intent when the same identity reconnects', async () => {
    const { guest, roomCode } = await createTwoPlayerLobby()

    await socketServer.receiveLeaveIntent(guestToken, [roomCode], guest.id!)
    guest.disconnect()
    const reconnected = await connect(guestToken)
    expect(
      await reconnected.emitWithAck('session:resume', { roomCode }),
    ).toMatchObject({ status: 'success', snapshot: { status: 'lobby' } })
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(socketServer.gameServer.snapshot(hostToken, roomCode)).toMatchObject(
      {
        members: [{ name: 'Ada' }, { name: 'Grace' }],
      },
    )
  })

  it('ignores an old finalizer after reconnect and honors a subsequent leave intent', async () => {
    const { host, guest, roomCode } = await createTwoPlayerLobby()
    const server = socketServer.gameServer
    expect(server.startGame(hostToken, roomCode)).toEqual({ status: 'success' })

    const participants = [
      { token: hostToken, client: host, name: 'Ada' },
      { token: guestToken, client: guest, name: 'Grace' },
    ]
    const targetByPlayerId = new Map<string, string>()
    for (const token of [hostToken, guestToken]) {
      const view = server.snapshot(token, roomCode)
      if (view.status !== 'hinting' || !view.board)
        throw new Error('Expected a private hinting board.')
      const targetCardId = view.board.find(({ kind }) => kind === 'neutral')!.id
      targetByPlayerId.set(view.player.playerId, targetCardId)
      expect(
        server.submitHint(token, {
          roomCode,
          gameId: view.gameId,
          hint: 'Orbit',
          targetCardIds: [targetCardId],
        }),
      ).toEqual({ status: 'success' })
    }

    const hinting = server.snapshot(hostToken, roomCode)
    if (hinting.status !== 'hinting')
      throw new Error('Expected the hinting phase.')
    expect(
      server.startGuessing(hostToken, {
        roomCode,
        gameId: hinting.gameId,
      }),
    ).toEqual({ status: 'success' })
    const sharedGuessing = server.snapshot(hostToken, roomCode)
    if (sharedGuessing.status !== 'guessing')
      throw new Error('Expected the guessing phase.')
    const leavingPlayer = participants.find(({ token }) => {
      const view = server.snapshot(token, roomCode)
      return (
        view.status === 'guessing' &&
        view.player.playerId !== sharedGuessing.clueGiverId
      )
    })!
    const remainingPlayer = participants.find(
      ({ token }) => token !== leavingPlayer.token,
    )!
    const guessing = server.snapshot(leavingPlayer.token, roomCode)
    if (guessing.status !== 'guessing')
      throw new Error('Expected the guessing phase.')
    const claim = {
      roomCode,
      gameId: guessing.gameId,
      turnId: guessing.turnId,
      cardId: targetByPlayerId.get(sharedGuessing.clueGiverId)!,
      commandId: 'leave-race-target',
    }
    expect(server.claimCard(leavingPlayer.token, claim)).toEqual({
      status: 'success',
      kind: 'target',
    })
    const beforeLeave = server.snapshot(leavingPlayer.token, roomCode)
    expect(beforeLeave).toMatchObject({
      status: 'guessing',
      scoreboard: [{ score: 3 }, { score: 3 }],
    })

    await socketServer.receiveLeaveIntent(
      leavingPlayer.token,
      [roomCode],
      leavingPlayer.client.id!,
    )
    leavingPlayer.client.disconnect()
    type FetchedSockets = Awaited<
      ReturnType<typeof socketServer.io.fetchSockets>
    >
    let resolveOldFetch!: (sockets: FetchedSockets) => void
    const oldFetch = new Promise<FetchedSockets>((resolve) => {
      resolveOldFetch = resolve
    })
    const fetchSockets = vi
      .spyOn(socketServer.io, 'fetchSockets')
      .mockImplementationOnce(() => oldFetch)
    await vi.waitFor(() => expect(fetchSockets).toHaveBeenCalledOnce())

    const reconnected = await connect(leavingPlayer.token)
    expect(
      await reconnected.emitWithAck('session:resume', { roomCode }),
    ).toEqual({ status: 'success', snapshot: beforeLeave })
    const reconnectedSocketId = reconnected.id!
    reconnected.disconnect()
    await socketServer.receiveLeaveIntent(
      leavingPlayer.token,
      [roomCode],
      reconnectedSocketId,
    )

    const leaveRoom = vi.spyOn(server, 'leaveRoom')
    resolveOldFetch([])
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(leaveRoom).not.toHaveBeenCalled()
    expect(server.snapshot(leavingPlayer.token, roomCode)).toEqual(beforeLeave)
    expect(server.claimCard(leavingPlayer.token, claim)).toEqual({
      status: 'success',
      kind: 'target',
    })
    expect(server.snapshot(leavingPlayer.token, roomCode)).toEqual(beforeLeave)

    await vi.waitFor(() => expect(leaveRoom).toHaveBeenCalledOnce())
    expect(server.snapshot(remainingPlayer.token, roomCode)).toMatchObject({
      status: 'guessing',
      members: [{ name: remainingPlayer.name }],
    })
  })

  it('keeps a player while the initiating socket remains connected', async () => {
    const { guest, roomCode } = await createTwoPlayerLobby()

    await socketServer.receiveLeaveIntent(guestToken, [roomCode], guest.id!)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(socketServer.gameServer.snapshot(hostToken, roomCode)).toMatchObject(
      {
        members: [{ name: 'Ada' }, { name: 'Grace' }],
      },
    )
  })

  it('keeps a player when another active tab shares the same identity', async () => {
    const { guest, roomCode } = await createTwoPlayerLobby()
    const otherTab = await connect(guestToken)
    await otherTab.emitWithAck('session:resume', { roomCode })

    await socketServer.receiveLeaveIntent(guestToken, [roomCode], guest.id!)
    guest.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(socketServer.gameServer.snapshot(hostToken, roomCode)).toMatchObject(
      {
        members: [{ name: 'Ada' }, { name: 'Grace' }],
      },
    )
  })

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
        'game:unlock-hint',
        'game:reject-hint',
        'game:start-guessing',
        'game:claim-card',
        'game:finish-guessing',
        'game:advance-turn',
        'game:show-scoreboard',
        'game:return-to-lobby',
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

  it('runs late entry, hint review, host moderation, transition, scoring, and spectator permissions', async () => {
    const host = await connect(hostToken)
    const guest = await connect(guestToken)
    const latePlayer = await connect(spectatorToken)

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
    const hostEditable = hostHint.board.filter(({ kind }) => kind === 'neutral')
    const hostTargets = hostEditable.slice(0, 2).map(({ id }) => id)
    const guestTargets = guestHint.board
      .filter(({ kind }) => kind === 'neutral')
      .slice(0, 3)
      .map(({ id }) => id)
    expect(hostTargets).toHaveLength(2)
    expect(guestTargets).toHaveLength(3)

    const lockedCivilian = hostHint.board.find(
      ({ kind, locked }) => kind === 'civilian' && locked,
    )!
    for (const targetCardIds of [
      hostEditable.slice(0, 6).map(({ id }) => id),
      [...hostTargets, lockedCivilian.id],
    ]) {
      expect(
        await host.emitWithAck('game:submit-hint', {
          roomCode,
          gameId: hostHint.gameId,
          hint: 'Invalid',
          targetCardIds,
        }),
      ).toMatchObject({ status: 'invalid' })
      expect(socketServer.gameServer.snapshot(hostToken, roomCode)).toEqual(
        hostHint,
      )
    }
    host.disconnect()
    const reconnectedHost = await connect(hostToken)
    const resumed = await reconnectedHost.emitWithAck('session:resume', {
      roomCode,
    })
    expect(resumed).toMatchObject({
      status: 'success',
      snapshot: {
        status: 'hinting',
        board: hostHint.board,
        hintSubmitted: false,
      },
    })
    reconnectedHost.disconnect()
    host.connect()
    await new Promise<void>((resolve) => host.once('connect', () => resolve()))

    expect(
      await host.emitWithAck('game:submit-hint', {
        roomCode,
        gameId: hostHint.gameId,
        hint: 'Orbit',
        targetCardIds: hostTargets,
      }),
    ).toEqual({ status: 'success' })
    expect(
      await guest.emitWithAck('game:submit-hint', {
        roomCode,
        gameId: guestHint.gameId,
        hint: 'Garden',
        targetCardIds: guestTargets,
      }),
    ).toEqual({ status: 'success' })
    expect(
      await host.emitWithAck('game:unlock-hint', {
        roomCode,
        gameId: hostHint.gameId,
      }),
    ).toEqual({
      status: 'success',
    })
    expect(socketServer.gameServer.snapshot(hostToken, roomCode)).toMatchObject(
      {
        status: 'hinting',
        hint: 'Orbit',
        hintSubmitted: false,
        allHintsSubmitted: false,
        hintStatuses: expect.arrayContaining([
          expect.objectContaining({
            name: 'Grace',
            hint: 'Garden',
            hintNumber: 3,
          }),
        ]),
        board: expect.arrayContaining(
          hostTargets.map((id) =>
            expect.objectContaining({ id, kind: 'target' }),
          ),
        ),
      },
    )
    expect(
      await host.emitWithAck('game:start-guessing', {
        roomCode,
        gameId: hostHint.gameId,
      }),
    ).toMatchObject({ status: 'invalid' })
    expect(
      await host.emitWithAck('game:submit-hint', {
        roomCode,
        gameId: hostHint.gameId,
        hint: 'Galaxy',
        targetCardIds: hostTargets.slice(0, 1),
      }),
    ).toEqual({ status: 'success' })

    expect(
      await latePlayer.emitWithAck('room:join', { roomCode, name: 'Linus' }),
    ).toEqual({ status: 'success', roomCode })
    const lateHint = socketServer.gameServer.snapshot(spectatorToken, roomCode)
    expect(lateHint).toMatchObject({
      status: 'hinting',
      player: { participation: 'player' },
      board: expect.any(Array),
      allHintsSubmitted: false,
      hintStatuses: expect.arrayContaining([
        expect.objectContaining({
          name: 'Ada',
          hint: 'Galaxy',
          hintNumber: 1,
        }),
        expect.objectContaining({
          name: 'Grace',
          hint: 'Garden',
          hintNumber: 3,
        }),
      ]),
    })
    if (lateHint.status !== 'hinting' || !lateHint.board)
      throw new Error('Expected a late-player hinting board.')
    const lateTargets = lateHint.board
      .filter(({ kind }) => kind === 'neutral')
      .slice(0, 2)
      .map(({ id }) => id)
    expect(
      await latePlayer.emitWithAck('game:submit-hint', {
        roomCode,
        gameId: hostHint.gameId,
        hint: 'New York',
        targetCardIds: lateTargets,
      }),
    ).toEqual({ status: 'success' })
    const review = socketServer.gameServer.snapshot(hostToken, roomCode)
    expect(review).toMatchObject({
      status: 'hinting',
      allHintsSubmitted: true,
      hintStatuses: expect.arrayContaining([
        expect.objectContaining({
          name: 'Linus',
          hint: 'New York',
          hintNumber: 2,
        }),
      ]),
    })
    const latePlayerId = lateHint.player.playerId
    expect(
      await guest.emitWithAck('game:reject-hint', {
        roomCode,
        gameId: hostHint.gameId,
        playerId: latePlayerId,
      }),
    ).toMatchObject({ status: 'forbidden' })
    expect(
      await host.emitWithAck('game:reject-hint', {
        roomCode,
        gameId: hostHint.gameId,
        playerId: latePlayerId,
      }),
    ).toEqual({ status: 'success' })
    expect(
      socketServer.gameServer.snapshot(spectatorToken, roomCode),
    ).toMatchObject({
      status: 'hinting',
      hint: null,
      hintSubmitted: false,
      hintRejected: true,
    })
    const rejectedSnapshot = socketServer.gameServer.snapshot(
      spectatorToken,
      roomCode,
    )
    if (rejectedSnapshot.status !== 'hinting' || !rejectedSnapshot.board)
      throw new Error('Expected a replacement late-player board.')
    const replacementLateTargets = rejectedSnapshot.board
      .filter(({ kind }) => kind === 'neutral')
      .slice(0, 2)
      .map(({ id }) => id)
    expect(replacementLateTargets).toHaveLength(2)
    expect(replacementLateTargets).not.toEqual(lateTargets)
    latePlayer.disconnect()
    const reconnectedLate = await connect(spectatorToken)
    expect(
      await reconnectedLate.emitWithAck('session:resume', { roomCode }),
    ).toEqual({ status: 'success', snapshot: rejectedSnapshot })
    expect(
      await reconnectedLate.emitWithAck('game:submit-hint', {
        roomCode,
        gameId: hostHint.gameId,
        hint: 'City',
        targetCardIds: replacementLateTargets,
      }),
    ).toEqual({ status: 'success' })

    expect(
      await host.emitWithAck('game:start-guessing', {
        roomCode,
        gameId: hostHint.gameId,
      }),
    ).toEqual({ status: 'success' })
    const spectator = await connect(watcherToken)
    expect(
      await spectator.emitWithAck('room:join', { roomCode, name: 'Spectator' }),
    ).toEqual({ status: 'success', roomCode })
    expect(
      socketServer.gameServer.snapshot(watcherToken, roomCode),
    ).toMatchObject({
      status: 'guessing',
      player: { participation: 'spectator' },
    })
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
        gameId: guestGuessing.gameId,
        commandId: 'guest-target-command',
        turnId: guestGuessing.turnId,
        cardId: target.id,
      }),
    ).toEqual({ status: 'success', kind: 'target' })
    expect(
      await spectator.emitWithAck('game:claim-card', {
        roomCode,
        gameId: guestGuessing.gameId,
        commandId: 'spectator-command-1',
        turnId: guestGuessing.turnId,
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
    ).toEqual([3, 3, 0])
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
            gameId: view.gameId,
            hint: 'Orbit',
            targetCardIds: [target.id],
          }),
        ).toEqual({ status: 'success' })
      }
      const hintingView = server.snapshot(hostToken, roomCode)
      if (hintingView.status !== 'hinting')
        throw new Error('Expected hinting phase.')
      expect(
        server.startGuessing(hostToken, {
          roomCode,
          gameId: hintingView.gameId,
        }),
      ).toEqual({
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
            gameId: before.gameId,
            turnId: before.turnId,
          }),
        ).toEqual({ status: 'success' })
      } else if (ending !== 'active') {
        const card = revealed.board.find(
          ({ revealedKind }) => revealedKind === ending,
        )!
        expect(
          await guest.emitWithAck('game:claim-card', {
            roomCode,
            gameId: before.gameId,
            cardId: card.id,
            turnId: before.turnId,
            commandId: `${ending}-before-reconnect`,
          }),
        ).toEqual({ status: 'success', kind: ending })
      }
      const completed = server.snapshot(guestToken, roomCode)
      expect(server.snapshot(hostToken, roomCode)).toMatchObject({
        canAdvanceTurn: true,
      })
      const serverGuest = [...socketServer.io.sockets.sockets.values()].find(
        (socket) => socket.data.token === guestToken,
      )!
      const disconnected = new Promise<void>((resolve) =>
        serverGuest.once('disconnect', () => resolve()),
      )
      guest.disconnect()
      await disconnected
      if (ending === 'active') {
        expect(server.snapshot(hostToken, roomCode)).toMatchObject({
          canAdvanceTurn: true,
          unfinishedPickerCount: 1,
        })
        expect(server.snapshot(guestToken, roomCode)).toEqual(completed)
      }
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
      expect(server.snapshot(hostToken, roomCode)).toMatchObject({
        canAdvanceTurn: true,
      })
      if (ending === 'pass') {
        expect(
          await reconnected.emitWithAck('game:finish-guessing', {
            roomCode,
            gameId: before.gameId,
            turnId: before.turnId,
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

  it('accepts distinct concurrent targets from an older snapshot, resumes that turn, and rejects delayed moves', async () => {
    const host = await connect(hostToken)
    const guest = await connect(guestToken)
    const thirdToken = 'd'.repeat(32)
    const third = await connect(thirdToken)
    const spectator = await connect(spectatorToken)
    const created = await host.emitWithAck('room:create', { name: 'Ada' })
    if (created.status !== 'success') throw new Error('Expected room.')
    const { roomCode } = created
    await guest.emitWithAck('room:join', { roomCode, name: 'Grace' })
    await third.emitWithAck('room:join', { roomCode, name: 'Linus' })
    await host.emitWithAck('game:start', { roomCode })
    for (const client of [host, guest, third]) {
      const result = await client.emitWithAck('session:resume', { roomCode })
      if (
        result.status !== 'success' ||
        result.snapshot?.status !== 'hinting' ||
        !result.snapshot.board
      )
        throw new Error('Expected private board.')
      expect(
        await client.emitWithAck('game:submit-hint', {
          roomCode,
          gameId: result.snapshot.gameId,
          hint: 'Orbit',
          targetCardIds: result.snapshot.board
            .filter(({ kind }) => kind === 'neutral')
            .slice(0, 3)
            .map(({ id }) => id),
        }),
      ).toEqual({ status: 'success' })
    }
    const ready = socketServer.gameServer.snapshot(hostToken, roomCode)
    if (ready.status !== 'hinting') throw new Error('Expected hinting.')
    await host.emitWithAck('game:start-guessing', {
      roomCode,
      gameId: ready.gameId,
    })
    const before = socketServer.gameServer.snapshot(hostToken, roomCode)
    if (before.status !== 'guessing') throw new Error('Expected guessing.')
    const targets = before.board.filter(
      ({ revealedKind }) => revealedKind === 'target',
    )
    await spectator.emitWithAck('room:join', { roomCode, name: 'Spectator' })
    const payload = {
      roomCode,
      gameId: before.gameId,
      turnId: before.turnId,
      cardId: targets[0].id,
      commandId: 'concurrent-target',
    }
    expect(
      await Promise.all([
        guest.emitWithAck('game:claim-card', payload),
        third.emitWithAck('game:claim-card', {
          ...payload,
          cardId: targets[1].id,
        }),
      ]),
    ).toEqual([
      { status: 'success', kind: 'target' },
      { status: 'success', kind: 'target' },
    ])
    const scored = socketServer.gameServer.snapshot(guestToken, roomCode)
    expect(scored).toMatchObject({
      turnId: before.turnId,
      scoreboard: [{ score: 6 }, { score: 3 }, { score: 3 }, { score: null }],
    })
    guest.disconnect()
    const resumedGuest = await connect(guestToken)
    expect(
      await resumedGuest.emitWithAck('session:resume', { roomCode }),
    ).toEqual({ status: 'success', snapshot: scored })
    expect(await resumedGuest.emitWithAck('game:claim-card', payload)).toEqual({
      status: 'success',
      kind: 'target',
    })
    expect(socketServer.gameServer.snapshot(guestToken, roomCode)).toEqual(
      scored,
    )
    for (const client of [resumedGuest, third]) {
      expect(
        await client.emitWithAck('game:finish-guessing', {
          roomCode,
          gameId: before.gameId,
          turnId: before.turnId,
        }),
      ).toEqual({ status: 'success' })
    }
    await host.emitWithAck('game:advance-turn', {
      roomCode,
      gameId: before.gameId,
      turnId: before.turnId,
    })
    const next = socketServer.gameServer.snapshot(thirdToken, roomCode)
    if (next.status !== 'guessing') throw new Error('Expected next turn.')
    expect(next.turnId).not.toBe(before.turnId)
    expect(
      await third.emitWithAck('game:claim-card', {
        ...payload,
        cardId: next.board[0].id,
      }),
    ).toMatchObject({ status: 'stale' })
    expect(
      await third.emitWithAck('game:finish-guessing', {
        roomCode,
        gameId: before.gameId,
        turnId: before.turnId,
      }),
    ).toMatchObject({ status: 'stale' })
    expect(
      await third.emitWithAck('game:claim-card', {
        ...payload,
        turnId: 'invalid',
      }),
    ).toMatchObject({ status: 'invalid' })
    expect(socketServer.gameServer.snapshot(thirdToken, roomCode)).toEqual(next)
  })

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
            gameId: view.gameId,
            hint: 'Orbit',
            targetCardIds: view.board
              .filter(({ kind }) => kind === 'neutral')
              .slice(0, 2)
              .map(({ id }) => id),
          }),
        ).toEqual({ status: 'success' })
      }
      const ready = socketServer.gameServer.snapshot(hostToken, roomCode)
      if (ready.status !== 'hinting') throw new Error('Expected hinting.')
      await host.emitWithAck('game:start-guessing', {
        roomCode,
        gameId: ready.gameId,
      })
      await spectator.emitWithAck('room:join', { roomCode, name: 'Spectator' })
      const before = socketServer.gameServer.snapshot(hostToken, roomCode)
      if (before.status !== 'guessing') throw new Error('Expected guessing.')
      const card = before.board.find(
        ({ revealedKind }) => revealedKind === kind,
      )!
      // Drain the initial guessing broadcast before recording claim updates.
      // A resume acknowledgement follows earlier packets on this connection.
      expect(
        await spectator.emitWithAck('session:resume', { roomCode }),
      ).toEqual({
        status: 'success',
        snapshot: socketServer.gameServer.snapshot(spectatorToken, roomCode),
      })
      const spectatorSnapshots = vi.fn<(snapshot: RoomSnapshot) => void>()
      spectator.on('room:snapshot', spectatorSnapshots)
      const payload = {
        roomCode,
        gameId: before.gameId,
        cardId: card.id,
        turnId: before.turnId,
        commandId: `race-${kind}`,
      }
      const results = await Promise.all([
        guest.emitWithAck('game:claim-card', payload),
        third.emitWithAck('game:claim-card', payload),
      ])
      expect(results.map(({ status }) => status).sort()).toEqual(
        kind === 'assassin'
          ? ['forbidden', 'success']
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
      ).toEqual([
        kind === 'target' ? 3 : kind === 'civilian' ? -1 : -5,
        ...results.map(({ status }) =>
          status === 'success'
            ? kind === 'target'
              ? 3
              : kind === 'civilian'
                ? -1
                : -5
            : 0,
        ),
      ])
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
          socketServer.gameServer.snapshot(spectatorToken, roomCode),
        ),
      )
      for (const [snapshot] of spectatorSnapshots.mock.calls) {
        if (snapshot.status !== 'guessing' || snapshot.turnId !== before.turnId)
          continue
        const visibleCard = snapshot.board.find(({ id }) => id === card.id)
        expect(visibleCard).toMatchObject({
          revealedKind: kind,
          claimedBy: winnerNames,
          disabled: true,
        })
      }
    },
  )

  it('synchronizes board-free results and an idempotent lobby reset for every connected member', async () => {
    const host = await connect(hostToken)
    const guest = await connect(guestToken)
    const spectator = await connect(spectatorToken)
    const created = await host.emitWithAck('room:create', { name: 'Ada' })
    if (created.status !== 'success') throw new Error('Expected room.')
    const { roomCode } = created
    await guest.emitWithAck('room:join', { roomCode, name: 'Grace' })

    const server = socketServer.gameServer
    expect(server.startGame(hostToken, roomCode)).toEqual({ status: 'success' })
    for (const [token, hint] of [
      [hostToken, 'Orbit'],
      [guestToken, 'Garden'],
    ] as const) {
      const view = server.snapshot(token, roomCode)
      if (view.status !== 'hinting' || !view.board)
        throw new Error('Expected hinting board.')
      expect(
        server.submitHint(token, {
          roomCode,
          gameId: view.gameId,
          hint,
          targetCardIds: [
            view.board.find(({ kind }) => kind === 'neutral')!.id,
          ],
        }),
      ).toEqual({ status: 'success' })
    }
    const ready = server.snapshot(hostToken, roomCode)
    if (ready.status !== 'hinting') throw new Error('Expected hinting.')
    expect(
      server.startGuessing(hostToken, {
        roomCode,
        gameId: ready.gameId,
      }),
    ).toEqual({ status: 'success' })
    await spectator.emitWithAck('room:join', { roomCode, name: 'Linus' })

    while (true) {
      const hostView = server.snapshot(hostToken, roomCode)
      if (hostView.status !== 'guessing') throw new Error('Expected guessing.')
      for (const token of [hostToken, guestToken]) {
        const playerView = server.snapshot(token, roomCode)
        if (playerView.status === 'guessing' && playerView.canMarkDone) {
          expect(
            server.finishGuessing(token, {
              roomCode,
              gameId: playerView.gameId,
              turnId: playerView.turnId,
            }),
          ).toEqual({ status: 'success' })
        }
      }
      const complete = server.snapshot(hostToken, roomCode)
      if (complete.status !== 'guessing') throw new Error('Expected guessing.')
      if (complete.isFinalTurn) break
      expect(
        server.advanceTurn(hostToken, {
          roomCode,
          gameId: complete.gameId,
          turnId: complete.turnId,
        }),
      ).toEqual({ status: 'success' })
    }

    const finalBoard = server.snapshot(hostToken, roomCode)
    if (finalBoard.status !== 'guessing')
      throw new Error('Expected final board.')
    expect(finalBoard.canViewScoreboard).toBe(true)
    expect(
      await guest.emitWithAck('game:show-scoreboard', {
        roomCode,
        gameId: finalBoard.gameId,
        turnId: finalBoard.turnId,
      }),
    ).toMatchObject({ status: 'forbidden' })

    const resultSnapshots = [host, guest, spectator].map(
      (client) =>
        new Promise<RoomSnapshot>((resolve) =>
          client.once('room:snapshot', resolve),
        ),
    )
    expect(
      await host.emitWithAck('game:show-scoreboard', {
        roomCode,
        gameId: finalBoard.gameId,
        turnId: finalBoard.turnId,
      }),
    ).toEqual({ status: 'success' })
    for (const snapshot of await Promise.all(resultSnapshots)) {
      expect(snapshot.status).toBe('finished')
      expect(snapshot).not.toHaveProperty('board')
    }
    expect(
      await guest.emitWithAck('session:resume', { roomCode }),
    ).toMatchObject({ status: 'success', snapshot: { status: 'finished' } })

    const lobbySnapshots = [host, guest, spectator].map(
      (client) =>
        new Promise<RoomSnapshot>((resolve) =>
          client.once('room:snapshot', resolve),
        ),
    )
    expect(
      await host.emitWithAck('game:return-to-lobby', {
        roomCode,
        gameId: finalBoard.gameId,
      }),
    ).toEqual({ status: 'success' })
    for (const snapshot of await Promise.all(lobbySnapshots)) {
      expect(snapshot).toMatchObject({ status: 'lobby', roomCode })
      if (snapshot.status !== 'lobby') throw new Error('Expected lobby.')
      expect(
        snapshot.members.every(
          ({ participation }) => participation === 'player',
        ),
      ).toBe(true)
    }
    expect(
      await host.emitWithAck('game:return-to-lobby', {
        roomCode,
        gameId: finalBoard.gameId,
      }),
    ).toEqual({ status: 'success' })

    expect(await host.emitWithAck('game:start', { roomCode })).toEqual({
      status: 'success',
    })
    const nextGame = server.snapshot(hostToken, roomCode)
    if (nextGame.status !== 'hinting') throw new Error('Expected next game.')
    expect(nextGame.gameId).not.toBe(finalBoard.gameId)
    expect(
      await host.emitWithAck('game:submit-hint', {
        roomCode,
        gameId: finalBoard.gameId,
        hint: 'Stale',
        targetCardIds: [
          nextGame.board!.find(({ kind }) => kind === 'neutral')!.id,
        ],
      }),
    ).toMatchObject({ status: 'stale' })
  })

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

  it('keeps host authority through transport disconnects and multiple sockets sharing one identity', async () => {
    const firstHostSocket = await connect(hostToken)
    const secondHostSocket = await connect(hostToken)
    const guest = await connect(guestToken)
    const spectator = await connect(spectatorToken)
    const created = await firstHostSocket.emitWithAck('room:create', {
      name: 'Ada',
    })
    if (created.status !== 'success') throw new Error('Unable to create room.')
    const { roomCode } = created

    await guest.emitWithAck('room:join', { roomCode, name: 'Grace' })
    await firstHostSocket.emitWithAck('game:start', { roomCode })
    for (const [token, hint] of [
      [hostToken, 'Orbit'],
      [guestToken, 'Garden'],
    ] as const) {
      const view = socketServer.gameServer.snapshot(token, roomCode)
      if (view.status !== 'hinting' || !view.board)
        throw new Error('Expected hinting board.')
      const target = view.board.find(({ kind }) => kind === 'neutral')!
      expect(
        socketServer.gameServer.submitHint(token, {
          gameId: view.gameId,
          roomCode,
          hint,
          targetCardIds: [target.id],
        }),
      ).toEqual({ status: 'success' })
    }
    const ready = socketServer.gameServer.snapshot(hostToken, roomCode)
    if (ready.status !== 'hinting') throw new Error('Expected hinting phase.')
    expect(
      socketServer.gameServer.startGuessing(hostToken, {
        gameId: ready.gameId,
        roomCode,
      }),
    ).toEqual({ status: 'success' })
    await spectator.emitWithAck('room:join', { roomCode, name: 'Spectator' })
    const before = socketServer.gameServer.snapshot(hostToken, roomCode)
    if (before.status !== 'guessing')
      throw new Error('Expected guessing phase.')

    expect(
      await secondHostSocket.emitWithAck('session:resume', { roomCode }),
    ).toMatchObject({
      status: 'success',
      snapshot: {
        player: { playerId: before.player.playerId, role: 'host' },
      },
    })
    const serverHostSocket = socketServer.io.sockets.sockets.get(
      firstHostSocket.id!,
    )
    if (!serverHostSocket) throw new Error('Expected the first host socket.')
    const disconnected = new Promise<void>((resolve) =>
      serverHostSocket.once('disconnect', () => resolve()),
    )
    firstHostSocket.disconnect()
    await disconnected

    expect(
      await secondHostSocket.emitWithAck('session:resume', { roomCode }),
    ).toMatchObject({
      status: 'success',
      snapshot: {
        player: { playerId: before.player.playerId, role: 'host' },
      },
    })
    expect(
      socketServer.gameServer.snapshot(spectatorToken, roomCode),
    ).toMatchObject({
      player: { role: 'player', participation: 'spectator' },
    })
    expect(
      await spectator.emitWithAck('game:start-guessing', {
        gameId: before.gameId,
        roomCode,
      }),
    ).toMatchObject({ status: 'forbidden' })
  })

  it('returns a resume snapshot only through the acknowledgement', async () => {
    const client = await connect(hostToken)
    const roomSnapshots = vi.fn<(snapshot: RoomSnapshot) => void>()
    client.on('room:snapshot', roomSnapshots)

    await expect(
      client.emitWithAck('session:resume', { roomCode: 'bcdf2' }),
    ).resolves.toEqual({
      status: 'success',
      snapshot: { status: 'not_found', roomCode: 'bcdf2' },
    })
    expect(roomSnapshots).not.toHaveBeenCalled()
  })

  it('returns an expired snapshot while the expiration tombstone is active', async () => {
    const host = await connect(hostToken)
    const created = await host.emitWithAck('room:create', { name: 'Ada' })
    if (created.status !== 'success') throw new Error('Unable to create room.')

    socketServer.gameServer.expireRooms(Date.now() + 3 * 60 * 60 * 1_000)

    expect(
      await host.emitWithAck('session:resume', { roomCode: created.roomCode }),
    ).toEqual({
      status: 'success',
      snapshot: { status: 'expired', roomCode: created.roomCode },
    })
  })
})
