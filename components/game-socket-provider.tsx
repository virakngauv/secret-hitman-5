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
  isMemberSnapshot,
  type CardKind,
  type ClaimCardPayload,
  type ClientToServerEvents,
  type CommandResult,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SubmitHintPayload,
} from '@/lib/game-protocol'

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
export type RoomEndedReason = 'expired' | 'removed' | 'server_restart'

type GameSocketContextValue = {
  connectionStatus: ConnectionStatus
  snapshots: Readonly<Record<string, RoomSnapshot>>
  endedRooms: Readonly<Record<string, RoomEndedReason>>
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
  startGuessing: (roomCode: string) => Promise<CommandResult>
  claimCard: (
    payload: ClaimCardPayload,
  ) => Promise<CommandResult<{ kind: CardKind }>>
  finishGuessing: (roomCode: string) => Promise<CommandResult>
  advanceTurn: (roomCode: string) => Promise<CommandResult>
}

const GameSocketContext = createContext<GameSocketContextValue | null>(null)
const COMMAND_TIMEOUT_MS = 6_000
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
  const memberRoomsRef = useRef(new Set<string>())
  const receiveSnapshotRef = useRef<(snapshot: RoomSnapshot) => void>(() => {})
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting')
  const [snapshots, setSnapshots] = useState<Record<string, RoomSnapshot>>({})
  const [endedRooms, setEndedRooms] = useState<Record<string, RoomEndedReason>>(
    {},
  )

  useEffect(() => {
    if (clientToken === null) ensureClientToken()
  }, [clientToken, ensureClientToken])

  useEffect(() => {
    if (!clientToken) return

    const memberRooms = memberRoomsRef.current
    const gameServerUrl =
      process.env.NEXT_PUBLIC_GAME_SERVER_URL?.trim() ||
      defaultGameServerUrl(window.location.hostname)
    const socket: GameSocket = io(gameServerUrl, {
      auth: { token: clientToken, protocolVersion: GAME_PROTOCOL_VERSION },
      autoConnect: true,
      reconnection: true,
    })
    socketRef.current = socket

    const resumeWatchedRooms = () => {
      setConnectionStatus('connected')
      for (const roomCode of watchedRoomsRef.current.keys()) {
        socket.emit('session:resume', { roomCode }, (result) => {
          if (result.status === 'success' && result.snapshot) {
            receiveSnapshot(result.snapshot)
          }
        })
      }
    }
    const receiveSnapshot = (snapshot: RoomSnapshot) => {
      if (isMemberSnapshot(snapshot)) {
        memberRooms.add(snapshot.roomCode)
        setEndedRooms((rooms) => {
          if (!(snapshot.roomCode in rooms)) return rooms
          const next = { ...rooms }
          delete next[snapshot.roomCode]
          return next
        })
      } else if (
        snapshot.status === 'not_found' &&
        memberRooms.has(snapshot.roomCode)
      ) {
        setEndedRooms((rooms) => ({
          ...rooms,
          [snapshot.roomCode]: 'server_restart',
        }))
      } else if (snapshot.status === 'removed_from_room') {
        memberRooms.delete(snapshot.roomCode)
        setEndedRooms((rooms) => ({
          ...rooms,
          [snapshot.roomCode]: 'removed',
        }))
      }
      setSnapshots((current) => {
        return { ...current, [snapshot.roomCode]: snapshot }
      })
    }
    receiveSnapshotRef.current = receiveSnapshot
    const handleDisconnect = () => setConnectionStatus('disconnected')
    const handleConnectError = () => setConnectionStatus('disconnected')
    const handleExpired = ({ roomCode }: { roomCode: string }) => {
      memberRooms.delete(roomCode)
      setEndedRooms((current) => ({ ...current, [roomCode]: 'expired' }))
      setSnapshots((current) => ({
        ...current,
        [roomCode]: { status: 'not_found', roomCode },
      }))
    }
    const handleRemoved = ({ roomCode }: { roomCode: string }) => {
      memberRooms.delete(roomCode)
      setEndedRooms((current) => ({ ...current, [roomCode]: 'removed' }))
      setSnapshots((current) => ({
        ...current,
        [roomCode]: { status: 'removed_from_room', roomCode },
      }))
    }
    const handleShutdown = () => {
      const ended: Record<string, RoomEndedReason> = {}
      for (const roomCode of memberRooms) {
        ended[roomCode] = 'server_restart'
      }
      memberRooms.clear()
      setEndedRooms((current) => ({ ...current, ...ended }))
      setConnectionStatus('disconnected')
    }

    socket.on('connect', resumeWatchedRooms)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('room:snapshot', receiveSnapshot)
    socket.on('room:removed', handleRemoved)
    socket.on('room:expired', handleExpired)
    socket.on('server:shutdown', handleShutdown)

    return () => {
      socketRef.current = null
      receiveSnapshotRef.current = () => {}
      memberRooms.clear()
      setSnapshots({})
      setEndedRooms({})
      socket.disconnect()
    }
  }, [clientToken])

  const watchRoom = useCallback((roomCode: string) => {
    const watchers = watchedRoomsRef.current
    watchers.set(roomCode, (watchers.get(roomCode) ?? 0) + 1)
    const socket = socketRef.current
    if (socket?.connected) {
      socket.emit('session:resume', { roomCode }, (result) => {
        if (result.status === 'success' && result.snapshot) {
          receiveSnapshotRef.current(result.snapshot)
        }
      })
    }

    return () => {
      const count = watchers.get(roomCode) ?? 0
      if (count <= 1) watchers.delete(roomCode)
      else watchers.set(roomCode, count - 1)
    }
  }, [])

  const createRoom = useCallback(
    async (name: string): Promise<CommandResult<{ roomCode: string }>> => {
      const result = await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('room:create', { name }),
      )
      if (result.status === 'success') {
        memberRoomsRef.current.add(result.roomCode)
      }
      return result
    },
    [],
  )
  const joinRoom = useCallback(
    async (
      roomCode: string,
      name: string,
    ): Promise<CommandResult<{ roomCode: string }>> => {
      const result = await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('room:join', { roomCode, name }),
      )
      if (result.status === 'success') {
        memberRoomsRef.current.add(result.roomCode)
      }
      return result
    },
    [],
  )
  const leaveRoom = useCallback(
    async (roomCode: string): Promise<CommandResult> => {
      const result = await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('room:leave', { roomCode }),
      )
      if (result.status === 'success') {
        memberRoomsRef.current.delete(roomCode)
        setEndedRooms((rooms) => {
          if (!(roomCode in rooms)) return rooms
          const next = { ...rooms }
          delete next[roomCode]
          return next
        })
      }
      return result
    },
    [],
  )
  const startGame = useCallback(
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('game:start', { roomCode }),
      ),
    [],
  )
  const removePlayer = useCallback(
    async (roomCode: string, playerId: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('room:remove-player', { roomCode, playerId }),
      ),
    [],
  )
  const submitHint = useCallback(
    async (payload: SubmitHintPayload): Promise<CommandResult> =>
      await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('game:submit-hint', payload),
      ),
    [],
  )
  const startGuessing = useCallback(
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('game:start-guessing', { roomCode }),
      ),
    [],
  )
  const claimCard = useCallback(
    async (
      payload: ClaimCardPayload,
    ): Promise<CommandResult<{ kind: CardKind }>> =>
      await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('game:claim-card', payload),
      ),
    [],
  )
  const finishGuessing = useCallback(
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('game:finish-guessing', { roomCode }),
      ),
    [],
  )
  const advanceTurn = useCallback(
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, (socket) =>
        socket.emitWithAck('game:advance-turn', { roomCode }),
      ),
    [],
  )

  const value = useMemo<GameSocketContextValue>(
    () => ({
      connectionStatus,
      snapshots,
      endedRooms,
      watchRoom,
      createRoom,
      joinRoom,
      leaveRoom,
      removePlayer,
      startGame,
      submitHint,
      startGuessing,
      claimCard,
      finishGuessing,
      advanceTurn,
    }),
    [
      advanceTurn,
      claimCard,
      connectionStatus,
      createRoom,
      endedRooms,
      joinRoom,
      leaveRoom,
      finishGuessing,
      removePlayer,
      snapshots,
      startGame,
      startGuessing,
      submitHint,
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
  const { watchRoom, snapshots, endedRooms, connectionStatus } = useGameSocket()
  useEffect(() => watchRoom(roomCode), [roomCode, watchRoom])
  return {
    snapshot: snapshots[roomCode],
    endedReason: endedRooms[roomCode] ?? null,
    connectionStatus,
  }
}

async function runCommand<TResult extends object>(
  socket: GameSocket | null,
  command: (connectedSocket: GameSocket) => Promise<CommandResult<TResult>>,
): Promise<CommandResult<TResult>> {
  if (!socket?.connected) return unavailable()

  try {
    return await command(socket.timeout(COMMAND_TIMEOUT_MS))
  } catch {
    return unavailable()
  }
}

function unavailable(): CommandResult {
  return {
    status: 'server_unavailable',
    message: 'The game server is unavailable. Please try again.',
  }
}
