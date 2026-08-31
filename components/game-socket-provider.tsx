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
  type CommandFailure,
  type CommandResult,
  type FinishGuessingPayload,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SubmitHintPayload,
} from '@/lib/game-protocol'

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
export type RoomEndedReason = 'expired' | 'removed' | 'unavailable'

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
  unlockHint: (roomCode: string) => Promise<CommandResult>
  startGuessing: (roomCode: string) => Promise<CommandResult>
  claimCard: (
    payload: ClaimCardPayload,
  ) => Promise<CommandResult<{ kind: CardKind }>>
  finishGuessing: (payload: FinishGuessingPayload) => Promise<CommandResult>
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
  const synchronizedRef = useRef(false)
  const synchronizationGenerationRef = useRef(0)
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

    const resumeWatchedRooms = () => {
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
        socket.emit('session:resume', { roomCode }, (result) => {
          if (
            socketRef.current !== socket ||
            synchronizationGenerationRef.current !== generation ||
            !socket.connected
          )
            return
          if (result.status === 'success' && result.snapshot) {
            remaining -= 1
            if (remaining === 0) {
              synchronizedRef.current = true
              setConnectionStatus('connected')
            }
            receiveSnapshot(result.snapshot)
          } else {
            return
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
          [snapshot.roomCode]: 'unavailable',
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
    const markDisconnected = () => {
      synchronizationGenerationRef.current += 1
      synchronizedRef.current = false
      setConnectionStatus('disconnected')
    }
    const handleDisconnect = () => markDisconnected()
    const handleConnectError = () => markDisconnected()
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
      markDisconnected()
    }

    socket.on('connect', resumeWatchedRooms)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('room:snapshot', receiveSnapshot)
    socket.on('room:removed', handleRemoved)
    socket.on('room:expired', handleExpired)
    socket.on('server:shutdown', handleShutdown)

    if (socket.connected) resumeWatchedRooms()

    return () => {
      socketRef.current = null
      synchronizationGenerationRef.current += 1
      synchronizedRef.current = false
      receiveSnapshotRef.current = () => {}
      memberRooms.clear()
      setSnapshots({})
      setEndedRooms({})
      socket.disconnect()
    }
  }, [clientToken])

  const watchRoom = useCallback((roomCode: string) => {
    const watchers = watchedRoomsRef.current
    const existingWatchers = watchers.get(roomCode) ?? 0
    watchers.set(roomCode, existingWatchers + 1)
    const socket = socketRef.current
    if (socket?.connected && existingWatchers === 0) {
      const generation = ++synchronizationGenerationRef.current
      synchronizedRef.current = false
      setConnectionStatus('connecting')
      socket.emit('session:resume', { roomCode }, (result) => {
        if (
          socketRef.current !== socket ||
          synchronizationGenerationRef.current !== generation ||
          !socket.connected
        )
          return
        if (result.status === 'success' && result.snapshot) {
          synchronizedRef.current = true
          setConnectionStatus('connected')
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
      const socket = socketRef.current
      const result = await runCommand(
        socket,
        synchronizedRef.current,
        (socket) => socket.emitWithAck('room:create', { name }),
      )
      if (socketRef.current !== socket) return unavailable()
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
      const socket = socketRef.current
      const result = await runCommand(
        socket,
        synchronizedRef.current,
        (socket) => socket.emitWithAck('room:join', { roomCode, name }),
      )
      if (socketRef.current !== socket) return unavailable()
      if (result.status === 'success') {
        memberRoomsRef.current.add(result.roomCode)
      }
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
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:unlock-hint', { roomCode }),
      ),
    [],
  )
  const startGuessing = useCallback(
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
        socket.emitWithAck('game:start-guessing', { roomCode }),
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
    async (roomCode: string): Promise<CommandResult> =>
      await runCommand(socketRef.current, synchronizedRef.current, (socket) =>
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
      unlockHint,
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
