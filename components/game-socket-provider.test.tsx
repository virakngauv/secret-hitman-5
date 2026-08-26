import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GameSocketProvider,
  defaultGameServerUrl,
  useGameSocket,
  useRoomSnapshot,
} from './game-socket-provider'
import type { RoomSnapshot } from '../lib/game-protocol'

const mocks = vi.hoisted(() => ({
  clientToken: 'a'.repeat(32) as string | null,
  handlers: new Map<string, (...args: never[]) => void>(),
  resumeSnapshots: new Map<string, RoomSnapshot>(),
  emitWithAck: vi.fn(),
  io: vi.fn(),
  socket: {
    connected: true,
    on: vi.fn((event: string, handler: (...args: never[]) => void) => {
      mocks.handlers.set(event, handler)
    }),
    emit: vi.fn(
      (
        event: string,
        payload: { roomCode?: string },
        acknowledge?: (result: unknown) => void,
      ) => {
        if (event !== 'session:resume' || !acknowledge) return
        const snapshot = payload.roomCode
          ? mocks.resumeSnapshots.get(payload.roomCode)
          : undefined
        acknowledge({ status: 'success', snapshot })
      },
    ),
    emitWithAck: (...args: unknown[]) => mocks.emitWithAck(...args),
    timeout: vi.fn(),
    disconnect: vi.fn(),
  },
}))

vi.mock('socket.io-client', () => ({
  io: mocks.io,
}))

vi.mock('@/components/player-session-provider', () => ({
  usePlayerSession: () => ({
    clientToken: mocks.clientToken,
    ensureClientToken: vi.fn(),
  }),
}))

function RoomProbe({ roomCode }: { roomCode: string }) {
  const { snapshot, endedReason } = useRoomSnapshot(roomCode)
  const { leaveRoom, removePlayer } = useGameSocket()
  return (
    <>
      <div data-testid="status">{snapshot?.status ?? 'missing'}</div>
      <div data-testid="ended">{endedReason ?? 'active'}</div>
      <button type="button" onClick={() => void leaveRoom(roomCode)}>
        Leave
      </button>
      <button
        type="button"
        onClick={() => void removePlayer(roomCode, 'player-2')}
      >
        Remove
      </button>
    </>
  )
}

function MembershipProbe({
  command,
  roomCode,
}: {
  command: 'create' | 'join'
  roomCode: string
}) {
  const { createRoom, joinRoom } = useGameSocket()
  const { endedReason } = useRoomSnapshot(roomCode)
  const [completed, setCompleted] = useState(false)
  const [resultStatus, setResultStatus] = useState('pending')

  async function runCommand() {
    const result = await (command === 'create'
      ? createRoom('Ada')
      : joinRoom(roomCode, 'Ada'))
    setResultStatus(result.status)
    setCompleted(true)
  }

  return (
    <>
      <div data-testid="membership-ended">{endedReason ?? 'active'}</div>
      <div data-testid="command-completed">{completed ? 'yes' : 'no'}</div>
      <div data-testid="command-status">{resultStatus}</div>
      <button type="button" onClick={() => void runCommand()}>
        {command}
      </button>
    </>
  )
}

describe('GameSocketProvider', () => {
  beforeEach(() => {
    mocks.clientToken = 'a'.repeat(32)
    mocks.handlers.clear()
    mocks.resumeSnapshots.clear()
    mocks.emitWithAck.mockReset().mockResolvedValue({ status: 'success' })
    mocks.io.mockReset().mockReturnValue(mocks.socket)
    mocks.socket.connected = true
    mocks.socket.on.mockClear()
    mocks.socket.emit.mockClear()
    mocks.socket.timeout.mockReset().mockReturnValue(mocks.socket)
    mocks.socket.disconnect.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the local game server when the public URL is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_GAME_SERVER_URL', '')
    render(
      <GameSocketProvider>
        <RoomProbe roomCode="bcdf2" />
      </GameSocketProvider>,
    )

    await waitFor(() =>
      expect(mocks.io).toHaveBeenCalledWith(
        'http://localhost:3200',
        expect.any(Object),
      ),
    )
  })

  it('derives the game server URL from a LAN page hostname when the public URL is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_GAME_SERVER_URL', '')
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { hostname: '192.168.1.172' },
      configurable: true,
    })
    try {
      render(
        <GameSocketProvider>
          <RoomProbe roomCode="bcdf2" />
        </GameSocketProvider>,
      )

      await waitFor(() =>
        expect(mocks.io).toHaveBeenCalledWith(
          'http://192.168.1.172:3200',
          expect.any(Object),
        ),
      )
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        configurable: true,
      })
    }
  })

  it('classifies a missing room after watch resume as a server restart', async () => {
    const firstRoom = 'bcdf2'
    const resumedRoom = 'cdfg3'
    mocks.resumeSnapshots.set(resumedRoom, lobbySnapshot(resumedRoom))

    const view = render(
      <GameSocketProvider>
        <RoomProbe roomCode={firstRoom} />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())

    view.rerender(
      <GameSocketProvider>
        <RoomProbe roomCode={resumedRoom} />
      </GameSocketProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('lobby'),
    )

    act(() => {
      mocks.handlers.get('room:snapshot')?.({
        status: 'not_found',
        roomCode: resumedRoom,
      } as never)
    })

    expect(screen.getByTestId('ended')).toHaveTextContent('server_restart')
  })

  it('clears identity-scoped room state when the client token changes', async () => {
    const roomCode = 'bcdf2'
    const view = render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalledOnce())

    act(() => {
      mocks.handlers.get('room:snapshot')?.(lobbySnapshot(roomCode) as never)
      mocks.handlers.get('server:shutdown')?.()
    })
    expect(screen.getByTestId('status')).toHaveTextContent('lobby')
    expect(screen.getByTestId('ended')).toHaveTextContent('server_restart')

    mocks.clientToken = 'b'.repeat(32)
    view.rerender(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )

    await waitFor(() => expect(mocks.io).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('status')).toHaveTextContent('missing')
    expect(screen.getByTestId('ended')).toHaveTextContent('active')
    expect(mocks.socket.disconnect).toHaveBeenCalledOnce()
  })

  it('keeps an expired room classified as expired after shutdown', async () => {
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())
    act(() => mocks.handlers.get('connect')?.())
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('lobby'),
    )

    act(() => {
      mocks.handlers.get('room:expired')?.({
        roomCode,
        reason: 'idle',
      } as never)
    })

    expect(screen.getByTestId('status')).toHaveTextContent('not_found')
    expect(screen.getByTestId('ended')).toHaveTextContent('expired')

    act(() => mocks.handlers.get('server:shutdown')?.())
    expect(screen.getByTestId('ended')).toHaveTextContent('expired')
  })

  it('classifies host removal as terminal and clears membership before shutdown', async () => {
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())
    act(() => mocks.handlers.get('connect')?.())
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('lobby'),
    )

    act(() => mocks.handlers.get('room:removed')?.({ roomCode } as never))

    expect(screen.getByTestId('status')).toHaveTextContent('removed_from_room')
    expect(screen.getByTestId('ended')).toHaveTextContent('removed')

    act(() => mocks.handlers.get('server:shutdown')?.())
    expect(screen.getByTestId('ended')).toHaveTextContent('removed')
  })

  it('classifies a removed_from_room snapshot after reload as terminal', async () => {
    const roomCode = 'bcdf2'
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())
    act(() => mocks.handlers.get('connect')?.())

    act(() => {
      mocks.handlers.get('room:snapshot')?.({
        status: 'removed_from_room',
        roomCode,
      } as never)
    })

    expect(screen.getByTestId('status')).toHaveTextContent('removed_from_room')
    expect(screen.getByTestId('ended')).toHaveTextContent('removed')
  })

  it('sends a typed host-removal command through the socket timeout', async () => {
    const user = userEvent.setup()
    render(
      <GameSocketProvider>
        <RoomProbe roomCode="bcdf2" />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(mocks.socket.timeout).toHaveBeenCalledWith(6_000)
    expect(mocks.emitWithAck).toHaveBeenCalledWith('room:remove-player', {
      roomCode: 'bcdf2',
      playerId: 'player-2',
    })
  })

  it.each(['create', 'join'] as const)(
    'records membership after a successful %s acknowledgement',
    async (command) => {
      const user = userEvent.setup()
      const roomCode = 'bcdf2'
      mocks.emitWithAck.mockResolvedValue({ status: 'success', roomCode })
      render(
        <GameSocketProvider>
          <MembershipProbe command={command} roomCode={roomCode} />
        </GameSocketProvider>,
      )
      await waitFor(() => expect(mocks.io).toHaveBeenCalled())

      await user.click(screen.getByRole('button', { name: command }))
      await waitFor(() =>
        expect(screen.getByTestId('command-completed')).toHaveTextContent(
          'yes',
        ),
      )
      act(() => mocks.handlers.get('server:shutdown')?.())

      expect(screen.getByTestId('membership-ended')).toHaveTextContent(
        'server_restart',
      )
    },
  )

  it.each(['create', 'join'] as const)(
    'returns server_unavailable without emitting a disconnected %s command',
    async (command) => {
      const user = userEvent.setup()
      mocks.socket.connected = false
      render(
        <GameSocketProvider>
          <MembershipProbe command={command} roomCode="bcdf2" />
        </GameSocketProvider>,
      )
      await waitFor(() => expect(mocks.io).toHaveBeenCalled())

      await user.click(screen.getByRole('button', { name: command }))

      expect(screen.getByTestId('command-status')).toHaveTextContent(
        'server_unavailable',
      )
      expect(mocks.socket.timeout).not.toHaveBeenCalled()
      expect(mocks.emitWithAck).not.toHaveBeenCalled()
    },
  )

  it('uses Socket.IO acknowledgement timeouts for commands', async () => {
    const user = userEvent.setup()
    render(
      <GameSocketProvider>
        <MembershipProbe command="create" roomCode="bcdf2" />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'create' }))

    expect(mocks.socket.timeout).toHaveBeenCalledWith(6_000)
    expect(screen.getByTestId('command-status')).toHaveTextContent('success')
  })

  it('maps a Socket.IO acknowledgement timeout to server_unavailable', async () => {
    const user = userEvent.setup()
    mocks.emitWithAck.mockRejectedValue(new Error('operation has timed out'))
    render(
      <GameSocketProvider>
        <MembershipProbe command="create" roomCode="bcdf2" />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'create' }))

    expect(mocks.socket.timeout).toHaveBeenCalledWith(6_000)
    expect(screen.getByTestId('command-status')).toHaveTextContent(
      'server_unavailable',
    )
  })

  it('does not mark an explicitly left room as ended on shutdown', async () => {
    const user = userEvent.setup()
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())
    act(() => mocks.handlers.get('connect')?.())
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('lobby'),
    )

    await user.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(mocks.emitWithAck).toHaveBeenCalled())
    act(() => mocks.handlers.get('server:shutdown')?.())

    expect(screen.getByTestId('ended')).toHaveTextContent('active')
  })
})

describe('defaultGameServerUrl', () => {
  it('builds a same-host URL on the default game server port', () => {
    expect(defaultGameServerUrl('localhost')).toBe('http://localhost:3200')
    expect(defaultGameServerUrl('127.0.0.1')).toBe('http://127.0.0.1:3200')
    expect(defaultGameServerUrl('192.168.1.172')).toBe(
      'http://192.168.1.172:3200',
    )
    expect(defaultGameServerUrl('my-macbook.local')).toBe(
      'http://my-macbook.local:3200',
    )
    expect(defaultGameServerUrl('::1')).toBe('http://[::1]:3200')
    expect(defaultGameServerUrl('[::1]')).toBe('http://[::1]:3200')
  })
})

function lobbySnapshot(roomCode: string): RoomSnapshot {
  return {
    status: 'lobby',
    roomCode,
    revision: 1,
    minimumPlayers: 2,
    members: [
      {
        playerId: 'player-1',
        name: 'Ada',
        role: 'host',
        participation: 'player',
      },
    ],
    player: {
      playerId: 'player-1',
      name: 'Ada',
      role: 'host',
      participation: 'player',
    },
  }
}
