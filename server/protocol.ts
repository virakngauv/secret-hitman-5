import type { Server as HttpServer } from 'node:http'

import { Server, type Socket } from 'socket.io'

import {
  isMemberSnapshot,
  type ClientToServerEvents,
  type CommandFailure,
  type CommandResult,
  type ServerToClientEvents,
} from '../lib/game-protocol'
import { GameServer } from './game-server'
import { isPrivateNetworkOrigin } from './origins'
import {
  resolveClientAddress,
  resolveDigitalOceanClientAddress,
} from './proxy-trust'
import {
  parseCreateRoom,
  parseClaimCard,
  parseFinishGuessing,
  parseGameCommand,
  parseHandshakeAuth,
  parseJoinRoom,
  parseRejectHint,
  parseRemovePlayer,
  parseRoomCommand,
  parseSessionResume,
  parseSubmitHint,
} from './validation'

type InterServerEvents = Record<string, never>
type SocketData = { token: string; address: string }
type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>

export type EntryCommandLimits = {
  perPlayerPerMinute: number
  perAddressPerMinute: number
  globalPerMinute: number
}

export const DEFAULT_ENTRY_COMMAND_LIMITS: EntryCommandLimits = {
  perPlayerPerMinute: 30,
  perAddressPerMinute: 120,
  globalPerMinute: 2_000,
}

const LOOPBACK_PROXY_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

export type GameSocketServerOptions = {
  allowedOrigins: string[]
  allowPrivateNetworkOrigins?: boolean
  trustedProxyAddresses?: string[]
  trustDigitalOceanProxy?: boolean
  gameServer?: GameServer
  expirationSweepMs?: number
  entryCommandLimits?: EntryCommandLimits
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

const invalid = (): CommandFailure => ({
  status: 'invalid',
  message: 'Invalid command payload.',
})

const GLOBAL_ENTRY_KEY = 'global'

export function createGameSocketServer(
  httpServer: HttpServer,
  options: GameSocketServerOptions,
) {
  const gameServer = options.gameServer ?? new GameServer()
  const logger = options.logger ?? console
  const allowedOrigins = new Set(options.allowedOrigins)
  const isOriginAllowed = (origin: string | undefined) =>
    origin === undefined ||
    allowedOrigins.has(origin) ||
    (options.allowPrivateNetworkOrigins === true &&
      isPrivateNetworkOrigin(origin))
  const trustedProxyAddresses =
    options.trustedProxyAddresses ?? LOOPBACK_PROXY_ADDRESSES
  const entryLimits: EntryCommandLimits = {
    ...DEFAULT_ENTRY_COMMAND_LIMITS,
    ...options.entryCommandLimits,
  }
  const socketCommands = new SlidingWindowRateLimiter(40, 10_000)
  const playerCommands = new SlidingWindowRateLimiter(80, 10_000)
  const addressCommands = new SlidingWindowRateLimiter(400, 10_000)
  const playerEntryCommands = new SlidingWindowRateLimiter(
    entryLimits.perPlayerPerMinute,
    60_000,
  )
  const entryCommands = new SlidingWindowRateLimiter(
    entryLimits.perAddressPerMinute,
    60_000,
  )
  const globalEntryCommands = new SlidingWindowRateLimiter(
    entryLimits.globalPerMinute,
    60_000,
  )
  let acceptingCommands = true

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    maxHttpBufferSize: 16 * 1_024,
    cors: {
      credentials: false,
      origin(origin, callback) {
        callback(null, isOriginAllowed(origin))
      },
    },
    allowRequest(request, callback) {
      callback(null, isOriginAllowed(request.headers.origin))
    },
  })

  io.use((socket, next) => {
    const auth = parseHandshakeAuth(socket.handshake.auth)
    if (!auth) return next(new Error('Unsupported or invalid game session.'))
    socket.data.token = auth.token
    socket.data.address =
      options.trustDigitalOceanProxy === true
        ? resolveDigitalOceanClientAddress(
            socket.handshake.address,
            socket.handshake.headers['do-connecting-ip'],
          )
        : resolveClientAddress(
            socket.handshake.address,
            socket.handshake.headers['x-forwarded-for'],
            trustedProxyAddresses,
          )
    next()
  })

  io.on('connection', (socket) => {
    logger.info(
      JSON.stringify({ event: 'socket_connected', socketId: socket.id }),
    )

    socket.on('session:resume', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      const parsed = parseSessionResume(payload)
      if (!canRun(socket, acknowledge)) return
      safely('session:resume', acknowledge, async () => {
        if (!parsed) return acknowledge(invalid())
        if (!parsed.roomCode) return acknowledge({ status: 'success' })

        const snapshot = gameServer.snapshot(socket.data.token, parsed.roomCode)
        if (isMemberSnapshot(snapshot)) {
          await socket.join(parsed.roomCode)
        } else if (!takeEntryBudget(socket)) {
          return acknowledge({
            status: 'rate_limited',
            message: 'Too many commands.',
          })
        }
        acknowledge({ status: 'success', snapshot })
      })
    })

    socket.on('room:create', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge, true)) return
      safely('room:create', acknowledge, async () => {
        const parsed = parseCreateRoom(payload)
        if (!parsed) return acknowledge(invalid())

        const result = gameServer.createRoom(socket.data.token, parsed.name)
        if (result.status !== 'success') return acknowledge(result)
        await socket.join(result.roomCode)
        acknowledge(result)
        broadcastSnapshots(result.roomCode)
      })
    })

    socket.on('room:join', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge, true)) return
      safely('room:join', acknowledge, async () => {
        const parsed = parseJoinRoom(payload)
        if (!parsed) return acknowledge(invalid())

        const result = gameServer.joinRoom(
          socket.data.token,
          parsed.roomCode,
          parsed.name,
        )
        if (result.status !== 'success') return acknowledge(result)
        await socket.join(parsed.roomCode)
        acknowledge(result)
        broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('room:leave', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('room:leave', acknowledge, async () => {
        const parsed = parseRoomCommand(payload)
        if (!parsed) return acknowledge(invalid())

        const result = gameServer.leaveRoom(socket.data.token, parsed.roomCode)
        await socket.leave(parsed.roomCode)
        acknowledge(result)
        broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('room:remove-player', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('room:remove-player', acknowledge, async () => {
        const parsed = parseRemovePlayer(payload)
        if (!parsed) return acknowledge(invalid())

        const result = gameServer.removePlayer(
          socket.data.token,
          parsed.roomCode,
          parsed.playerId,
          parsed.allowRoundReset ?? false,
        )
        if (result.status !== 'success') return acknowledge(result)

        try {
          await notifyRemovedPlayer(parsed.roomCode, result.removedToken)
        } catch (error) {
          logFailure('removed_player_notification_failed', error)
        }
        acknowledge({ status: 'success' })
        broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:start', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:start', acknowledge, () => {
        const parsed = parseRoomCommand(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.startGame(socket.data.token, parsed.roomCode)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:submit-hint', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:submit-hint', acknowledge, () => {
        const parsed = parseSubmitHint(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.submitHint(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:unlock-hint', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:unlock-hint', acknowledge, () => {
        const parsed = parseGameCommand(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.unlockHint(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:reject-hint', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:reject-hint', acknowledge, () => {
        const parsed = parseRejectHint(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.rejectHint(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:start-guessing', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:start-guessing', acknowledge, () => {
        const parsed = parseGameCommand(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.startGuessing(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:claim-card', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:claim-card', acknowledge, () => {
        const parsed = parseClaimCard(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.claimCard(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:finish-guessing', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:finish-guessing', acknowledge, () => {
        const parsed = parseFinishGuessing(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.finishGuessing(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:advance-turn', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:advance-turn', acknowledge, () => {
        const parsed = parseGameCommand(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.advanceTurn(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:show-scoreboard', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:show-scoreboard', acknowledge, () => {
        const parsed = parseGameCommand(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.showScoreboard(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('game:return-to-lobby', (payload, callback) => {
      const acknowledge = normalizeAcknowledgement(callback)
      if (!canRun(socket, acknowledge)) return
      safely('game:return-to-lobby', acknowledge, () => {
        const parsed = parseGameCommand(payload)
        if (!parsed) return acknowledge(invalid())
        const result = gameServer.returnToLobby(socket.data.token, parsed)
        acknowledge(result)
        if (result.status === 'success') broadcastSnapshots(parsed.roomCode)
      })
    })

    socket.on('disconnect', (reason) => {
      socketCommands.delete(socket.id)
      logger.info(
        JSON.stringify({
          event: 'socket_disconnected',
          socketId: socket.id,
          reason,
        }),
      )
    })
  })

  const sweepTimer = setInterval(() => {
    try {
      for (const roomCode of gameServer.expireRooms()) {
        try {
          io.to(roomCode).emit('room:snapshot', {
            status: 'expired',
            roomCode,
          })
          io.in(roomCode).socketsLeave(roomCode)
        } catch (error) {
          logFailure('expiration_room_failed', error)
        }
      }
    } catch (error) {
      logFailure('expiration_sweep_failed', error)
    }
  }, options.expirationSweepMs ?? 60_000)
  sweepTimer.unref()

  async function emitSnapshots(roomCode: string) {
    const sockets = await io.in(roomCode).fetchSockets()
    for (const roomSocket of sockets) {
      try {
        roomSocket.emit(
          'room:snapshot',
          gameServer.snapshot(roomSocket.data.token, roomCode),
        )
      } catch (error) {
        logFailure('snapshot_failed', error)
      }
    }
  }

  function broadcastSnapshots(roomCode: string) {
    void emitSnapshots(roomCode).catch((error: unknown) => {
      logFailure('snapshot_broadcast_failed', error)
    })
  }

  async function notifyRemovedPlayer(roomCode: string, token: string) {
    const sockets = await io.fetchSockets()
    for (const roomSocket of sockets) {
      if (roomSocket.data.token !== token) continue
      try {
        roomSocket.emit('room:snapshot', {
          status: 'removed_from_room',
          roomCode,
        })
        await roomSocket.leave(roomCode)
      } catch (error) {
        logFailure('removed_player_socket_failed', error)
      }
    }
  }

  function safely<TResult extends object>(
    command: string,
    callback: (result: CommandResult<TResult>) => void,
    run: () => void | Promise<void>,
  ) {
    const acknowledge = normalizeAcknowledgement(callback)
    const fail = (error: unknown) => {
      logFailure('command_failed', error, command)
      acknowledge({
        status: 'server_unavailable',
        message: 'The command could not be processed. Please try again.',
      })
    }

    try {
      const pending = run()
      if (pending) void pending.catch(fail)
    } catch (error) {
      fail(error)
    }
  }

  function logFailure(event: string, error: unknown, command?: string) {
    logger.error(
      JSON.stringify({
        event,
        command,
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    )
  }

  function canRun(
    socket: GameSocket,
    acknowledge: (result: CommandFailure) => void,
    isEntryCommand = false,
  ) {
    if (!acceptingCommands) {
      acknowledge({
        status: 'server_unavailable',
        message: 'The game server is restarting.',
      })
      return false
    }

    const now = Date.now()
    const permitted =
      socketCommands.take(socket.id, now) &&
      playerCommands.take(socket.data.token, now) &&
      addressCommands.take(socket.data.address, now)
    const entryPermitted =
      !permitted || !isEntryCommand || takeEntryBudget(socket, now)
    if (!permitted || !entryPermitted) {
      acknowledge({ status: 'rate_limited', message: 'Too many commands.' })
      return false
    }
    return true
  }

  function entryKey(socket: GameSocket) {
    const isDirectLocalClient =
      options.trustDigitalOceanProxy !== true &&
      isLoopbackAddress(socket.handshake.address) &&
      socket.handshake.headers['x-forwarded-for'] === undefined
    return isDirectLocalClient
      ? `${socket.data.address}:${socket.data.token}`
      : socket.data.address
  }

  function takeEntryBudget(socket: GameSocket, now = Date.now()) {
    return (
      playerEntryCommands.take(socket.data.token, now) &&
      entryCommands.take(entryKey(socket), now) &&
      globalEntryCommands.take(GLOBAL_ENTRY_KEY, now)
    )
  }

  return {
    io,
    gameServer,
    async shutdown() {
      acceptingCommands = false
      clearInterval(sweepTimer)
      io.emit('server:shutdown')
      await new Promise<void>((resolve) => io.close(() => resolve()))
    },
  }
}

/** Socket.IO clients may omit acknowledgement IDs or send non-functions. */
function normalizeAcknowledgement<TResult>(
  callback: ((result: TResult) => void) | undefined,
): (result: TResult) => void {
  return typeof callback === 'function' ? callback : () => {}
}

function isLoopbackAddress(address: string) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address.startsWith('::ffff:127.')
  )
}

class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>()
  private readonly maxKeys = 10_000

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now: number) {
    if (!this.attempts.has(key) && this.attempts.size >= this.maxKeys) {
      const oldestKey = this.attempts.keys().next().value as string | undefined
      if (oldestKey) this.attempts.delete(oldestKey)
    }
    const cutoff = now - this.windowMs
    const attempts = (this.attempts.get(key) ?? []).filter(
      (attempt) => attempt > cutoff,
    )
    this.attempts.delete(key)
    if (attempts.length >= this.limit) {
      this.attempts.set(key, attempts)
      return false
    }
    attempts.push(now)
    this.attempts.set(key, attempts)
    return true
  }

  delete(key: string) {
    this.attempts.delete(key)
  }
}
