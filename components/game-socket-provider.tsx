'use client'

import { io, type Socket } from 'socket.io-client'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { usePlayerSession } from '@/components/player-session-provider'
import {
  GAME_PROTOCOL_VERSION,
  type CardKind,
  type ClaimCardPayload,
  type ClientToServerEvents,
  type CommandFailure,
  type CommandResult,
  type FinishGuessingPayload,
  type GameCommandPayload,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SubmitHintPayload,
} from '@/lib/game-protocol'

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

type GameSocketContextValue = {
  connectionStatus: ConnectionStatus
  snapshots: Readonly<Record<string, RoomSnapshot>>
  watchRoom: (roomCode: string) => () => void
  createRoom: (name: string) => Promise<CommandResult<{ roomCode: string }>>
  joinRoom: (
    roomCode: string,
    name: string,
  ) => Promise<CommandResult<{ roomCode: string }>>
  leaveRoom: (roomCode: string) => Promise<CommandResult>
  removePlayer: (roomCode: string, playerId: string) => Promise<CommandResult>
  startGame: (roomCode: string) => Promise<CommandResult>
  submitHint: (payload: SubmitHintPayload) => Promise<CommandResult>
  unlockHint: (payload: GameCommandPayload) => Promise<CommandResult>
  startGuessing: (payload: GameCommandPayload) => Promise<CommandResult>
  claimCard: (
    payload: ClaimCardPayload,
  ) => Promise<CommandResult<{ kind: CardKind }>>
  finishGuessing: (payload: FinishGuessingPayload) => Promise<CommandResult>
  advanceTurn: (payload: GameCommandPayload) => Promise<CommandResult>
  showScoreboard: (payload: GameCommandPayload) => Promise<CommandResult>
  returnToLobby: (payload: GameCommandPayload) => Promise<CommandResult>
}

const GameSocketContext = createContext<GameSocketContextValue | null>(null)
const COMMAND_TIMEOUT_MS = 6_000
const RESUME_RETRY_DELAY_MS = 1_000
const MAX_RESUME_RETRIES = 3
const DEFAULT_GAME_SERVER_PORT = 3200

export function defaultGameServerUrl(hostname: string): string {
  const bareHostname =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
  const host = bareHostname.includes(':') ? `[${bareHostname}]` : bareHostname
  return `http://${host}:${DEFAULT_GAME_SERVER_PORT}`
}

export function GameSocketProvider({ children }: { children: ReactNode }) {
  const { clientToken, ensureClientToken } = usePlayerSession()
  const socketRef = useRef<GameSocket | null>(null)
  const watchedRoomsRef = useRef(new Map<string, number>())
  const synchronizedRef = useRef(false)
  const synchronizationGenerationRef = useRef(0)
  const receiveSnapshotRef = useRef<(snapshot: RoomSnapshot) => void>(() => {})
  const resumeWatchedRoomsRef = useRef<() => void>(() => {})
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [snapshots, setSnapshots] = useState<Record<string, RoomSnapshot>>({})

  useEffect(() => {
    if (clientToken === null) ensureClientToken()
  }, [clientToken, ensureClientToken])

  useEffect(() => {
    if (!clientToken) return

    const gameServerUrl =
      process.env.NEXT_PUBLIC_GAME_SERVER_URL?.trim() ||
      defaultGameServerUrl(window.location.hostname)
    // HTTP is for local/LAN development only. Fail closed before constructing
    // the socket so a production misconfiguration cannot expose the token.
    try {
      const endpoint = new URL(gameServerUrl)
      if (
        endpoint.protocol !== 'https:' &&
        !(
          process.env.NODE_ENV === 'development' &&
          endpoint.protocol === 'http:'
        )
      ) {
        // Report a configuration failure just like a socket connection error.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConnectionStatus('disconnected')
        return
      }
    } catch {
      setConnectionStatus('disconnected')
      return
    }
    const socket: GameSocket = io(gameServerUrl, {
      auth: { token: clientToken, protocolVersion: GAME_PROTOCOL_VERSION },
      autoConnect: true,
      reconnection: true,
    })
    socketRef.current = socket
    let resumeRetryTimer: ReturnType<typeof setTimeout> | null = null
    let resumeRetryAttempts = 0

    const clearResumeRetry = () => {
      if (resumeRetryTimer === null) return
      clearTimeout(resumeRetryTimer)
      resumeRetryTimer = null
    }
    const scheduleResumeRetry = () => {
      if (!socket.connected || resumeRetryAttempts >= MAX_RESUME_RETRIES) return
      resumeRetryAttempts += 1
      resumeRetryTimer = setTimeout(() => {
        resumeRetryTimer = null
        if (socketRef.current === socket && socket.connected) {
          resumeWatchedRooms(true)
        }
      }, RESUME_RETRY_DELAY_MS)
    }
    function resumeWatchedRooms(isRetry = false) {
      if (!isRetry) {
        clearResumeRetry()
        resumeRetryAttempts = 0
      }
      const generation = ++synchronizationGenerationRef.current
      synchronizedRef.current = false
      setConnectionStatus('connecting')
      const roomCodes = [...watchedRoomsRef.current.keys()]
      if (roomCodes.length === 0) {
        synchronizedRef.current = true
        setConnectionStatus('connected')
        return
      }

      let remaining = roomCodes.length
      for (const roomCode of roomCodes) {
        socket
          .timeout(COMMAND_TIMEOUT_MS)
          .emit('session:resume', { roomCode }, (error, result) => {
            if (
              socketRef.current !== socket ||
              synchronizationGenerationRef.current !== generation ||
              !socket.connected
            )
              return
            if (!error && result.status === 'success' && result.snapshot) {
              remaining -= 1
              if (remaining === 0) {
                clearResumeRetry()
                resumeRetryAttempts = 0
                synchronizedRef.current = true
                setConnectionStatus('connected')
              }
              receiveSnapshot(result.snapshot)
            } else {
              synchronizationGenerationRef.current += 1
              synchronizedRef.current = false
              setConnectionStatus('disconnected')
              scheduleResumeRetry()
            }
          })
      }
    }
    resumeWatchedRoomsRef.current = () => resumeWatchedRooms()
    const receiveSnapshot = (snapshot: RoomSnapshot) => {
      setSnapshots((current) => {
        return { ...current, [snapshot.roomCode]: snapshot }
      })
    }
    receiveSnapshotRef.current = receiveSnapshot
    const markDisconnected = () => {
      clearResumeRetry()
      resumeRetryAttempts = 0
      synchronizationGenerationRef.current += 1
      synchronizedRef.current = false
      setConnectionStatus('disconnected')
    }
    const handleDisconnect = () => markDisconnected()
    const handleConnectError = () => markDisconnected()
    const handleShutdown = () => {
      markDisconnected()
    }

    socket.on('connect', resumeWatchedRooms)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('room:snapshot', receiveSnapshot)
    socket.on('server:shutdown', handleShutdown)

    if (socket.connected) resumeWatchedRooms()

    return () => {
      socketRef.current = null
      synchronizationGenerationRef.current += 1
      synchronizedRef.current = false
      receiveSnapshotRef.current = () => {}
      resumeWatchedRoomsRef.current = () => {}
      clearResumeRetry()
      setSnapshots({})
      socket.disconnect()
    }
  }, [clientToken])

  const watchRoom = useCallback((roomCode: string) => {
    const watchers = watchedRoomsRef.current
    const existingWatchers = watchers.get(roomCode) ?? 0
    watchers.set(roomCode, existingWatchers + 1)
    const socket = socketRef.current
    if (socket?.connected && existingWatchers === 0) {
      resumeWatchedRoomsRef.current()
    }

    return () => {
      const count = watchers.get(roomCode) ?? 0
      if (count <= 1) watchers.delete(roomCode)
      else watchers.set(roomCode, count - 1)
    }
  }, [])

  const createRoom = useCallback(
    async (name: string): Promise<CommandResult<{ roomCode: string }>> => {
      const socket = socketRef.current
      const result = await runCommand(
        socket,
        synchronizedRef.current,
        (socket) => socket.emitWithAck('room:create', { name }),
      )
      if (socketRef.current !== socket) return unavailable()
      return result
    },
    [],
  )
  const joinRoom = useCallback(
    async (
      roomCode: string,
      name: string,
    ): Promise<CommandResult<{ roomCode: string }>> => {
      const socket = socketRef.current
      const result = await runCommand(
        socket,
        synchronizedRef.current,
        (socket) => socket.emitWithAck('room:join', { roomCode, name }),
      )
      if (socketRef.current !== socket) return unavailable()
      return result
    },
    [],
  )
  const leaveRoom = useCallback(
    async (roomCode: string): Promise<CommandResult> => {
      const socket = socketRef.current
      const result = await runCommand(
        socket,
        synchronizedRef.current,
        (socket) => socket.emitWithAck('room:leave', { roomCode }),
      )
      if (socketRef.current !== socket) return unavailable()
      return result
    },
    [],
  )
  const startGame = useCallback(
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:start', { roomCode }),
      ),
    [],
  )
  const removePlayer = useCallback(
    async (roomCode: string, playerId: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('room:remove-player', { roomCode, playerId }),
      ),
    [],
  )
  const submitHint = useCallback(
    async (payload: SubmitHintPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:submit-hint', payload),
      ),
    [],
  )
  const unlockHint = useCallback(
    async (payload: GameCommandPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:unlock-hint', payload),
      ),
    [],
  )
  const startGuessing = useCallback(
    async (payload: GameCommandPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:start-guessing', payload),
      ),
    [],
  )
  const claimCard = useCallback(
    async (
      payload: ClaimCardPayload,
    ): Promise<CommandResult<{ kind: CardKind }>> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:claim-card', payload),
      ),
    [],
  )
  const finishGuessing = useCallback(
    async (payload: FinishGuessingPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:finish-guessing', payload),
      ),
    [],
  )
  const advanceTurn = useCallback(
    async (payload: GameCommandPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:advance-turn', payload),
      ),
    [],
  )
  const showScoreboard = useCallback(
    async (payload: GameCommandPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:show-scoreboard', payload),
      ),
    [],
  )
  const returnToLobby = useCallback(
    async (payload: GameCommandPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:return-to-lobby', payload),
      ),
    [],
  )

  const value = useMemo<GameSocketContextValue>(
    () => ({
      connectionStatus,
      snapshots,
      watchRoom,
      createRoom,
      joinRoom,
      leaveRoom,
      removePlayer,
      startGame,
      submitHint,
      unlockHint,
      startGuessing,
      claimCard,
      finishGuessing,
      advanceTurn,
      showScoreboard,
      returnToLobby,
    }),
    [
      advanceTurn,
      claimCard,
      connectionStatus,
      createRoom,
      joinRoom,
      leaveRoom,
      finishGuessing,
      removePlayer,
      returnToLobby,
      snapshots,
      startGame,
      startGuessing,
      showScoreboard,
      submitHint,
      unlockHint,
      watchRoom,
    ],
  )

  return (
    <GameSocketContext.Provider value={value}>
      {children}
    </GameSocketContext.Provider>
  )
}

export function useGameSocket() {
  const context = useContext(GameSocketContext)
  if (!context) {
    throw new Error('useGameSocket must be used within GameSocketProvider.')
  }
  return context
}

export function useRoomSnapshot(roomCode: string) {
  const { watchRoom, snapshots, connectionStatus } = useGameSocket()
  useEffect(() => watchRoom(roomCode), [roomCode, watchRoom])
  return {
    snapshot: snapshots[roomCode],
    connectionStatus,
  }
}

async function runCommand<TResult extends object>(
  socket: GameSocket | null,
  synchronized: boolean,
  command: (connectedSocket: GameSocket) => Promise<CommandResult<TResult>>,
): Promise<CommandResult<TResult>> {
  if (!socket?.connected || !synchronized) return unavailable()

  try {
    return await command(socket.timeout(COMMAND_TIMEOUT_MS))
  } catch {
    return unavailable()
  }
}

function unavailable(): CommandFailure {
  return {
    status: 'server_unavailable',
    message: 'The game server is unavailable. Please try again.',
  }
}
