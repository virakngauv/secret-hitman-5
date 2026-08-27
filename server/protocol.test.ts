import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  io as createClient,
  type Socket as ClientSocket,
} from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  GAME_PROTOCOL_VERSION,
  type ClientToServerEvents,
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

  beforeEach(async () => {
    httpServer = createServer()
    socketServer = createGameSocketServer(httpServer, {
      allowedOrigins: [allowedOrigin],
      entryCommandLimits: {
        perPlayerPerMinute: 30,
        perAddressPerMinute: 2,
        globalPerMinute: 2_000,
      },
      logger: { info() {}, warn() {}, error() {} },
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
  })

  async function connect(token: string, forwardedFor?: string) {
    const client: TestClient = createClient(url, {
      auth: { token, protocolVersion: GAME_PROTOCOL_VERSION },
      extraHeaders: {
        Origin: allowedOrigin,
        ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
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
    const hostTargets =
      hostHint.board
        ?.filter(({ kind }) => kind === 'neutral')
        .slice(0, 2)
        .map(({ id }) => id) ?? []
    const guestTargets =
      guestHint.board
        ?.filter(({ kind }) => kind === 'neutral')
        .slice(0, 3)
        .map(({ id }) => id) ?? []

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
