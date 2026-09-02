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
  delayResumes: false,
  resumeCallbacks: new Map<string, (result: unknown) => void>(),
  emitWithAck: vi.fn(),
  io: vi.fn(),
  socket: {
    id: 'socket-1',
    connected: true,
    on: vi.fn((event: string, handler: (...args: never[]) => void) => {
      mocks.handlers.set(event, handler)
    }),
    emit: vi.fn(),
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
  const { snapshot } = useRoomSnapshot(roomCode)
  const { connectionStatus, leaveRoom, removePlayer } = useGameSocket()
  return (
    <>
      <div data-testid="status">{snapshot?.status ?? 'missing'}</div>
      <div data-testid="connection">{connectionStatus}</div>
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
  command: 'create' | 'join' | 'leave'
  roomCode: string
}) {
  const { createRoom, joinRoom, leaveRoom } = useGameSocket()
  useRoomSnapshot(roomCode)
  const [completed, setCompleted] = useState(false)
  const [resultStatus, setResultStatus] = useState('pending')

  async function runCommand() {
    const result = await (command === 'create'
      ? createRoom('Ada')
      : command === 'join'
        ? joinRoom(roomCode, 'Ada')
        : leaveRoom(roomCode))
    setResultStatus(result.status)
    setCompleted(true)
  }

  return (
    <>
      <div data-testid="command-completed">{completed ? 'yes' : 'no'}</div>
      <div data-testid="command-status">{resultStatus}</div>
      <button type="button" onClick={() => void runCommand()}>
        {command}
      </button>
    </>
  )
}

function UnlockHintProbe({ roomCode }: { roomCode: string }) {
  const { rejectHint, unlockHint } = useGameSocket()
  const [resultStatus, setResultStatus] = useState('pending')
  return (
    <>
      <div data-testid="unlock-status">{resultStatus}</div>
      <button
        type="button"
        onClick={async () => {
          const result = await unlockHint({
            roomCode,
            gameId: '10000000-0000-4000-8000-000000000001',
          })
          setResultStatus(result.status)
        }}
      >
        Unlock hint
      </button>
      <button
        type="button"
        onClick={async () => {
          const result = await rejectHint({
            roomCode,
            gameId: '10000000-0000-4000-8000-000000000001',
            playerId: 'player-2',
          })
          setResultStatus(result.status)
        }}
      >
        Reject hint
      </button>
    </>
  )
}

describe('GameSocketProvider', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    mocks.clientToken = 'a'.repeat(32)
    mocks.handlers.clear()
    mocks.resumeSnapshots.clear()
    mocks.delayResumes = false
    mocks.resumeCallbacks.clear()
    mocks.emitWithAck.mockReset().mockResolvedValue({ status: 'success' })
    mocks.io.mockReset().mockReturnValue(mocks.socket)
    mocks.socket.connected = true
    mocks.socket.on.mockClear()
    mocks.socket.emit
      .mockReset()
      .mockImplementation(
        (
          event: string,
          payload: { roomCode?: string },
          acknowledge?: (error: Error | null, result: unknown) => void,
        ) => {
          if (event !== 'session:resume' || !acknowledge || !payload.roomCode)
            return
          if (mocks.delayResumes) {
            mocks.resumeCallbacks.set(payload.roomCode, (result) =>
              acknowledge(null, result),
            )
            return
          }
          const snapshot = mocks.resumeSnapshots.get(payload.roomCode) ?? {
            status: 'not_found',
            roomCode: payload.roomCode,
          }
          acknowledge(null, { status: 'success', snapshot })
        },
      )
    mocks.socket.timeout.mockReset().mockReturnValue(mocks.socket)
    mocks.socket.disconnect.mockClear()
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('sends the authenticated unlock-hint command for the current room', async () => {
    const user = userEvent.setup()
    render(
      <GameSocketProvider>
        <UnlockHintProbe roomCode="bcdf2" />
      </GameSocketProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Unlock hint' }))

    expect(mocks.emitWithAck).toHaveBeenCalledWith('game:unlock-hint', {
      roomCode: 'bcdf2',
      gameId: '10000000-0000-4000-8000-000000000001',
    })
    expect(screen.getByTestId('unlock-status')).toHaveTextContent('success')
  })

  it('sends the host hint-rejection command for the selected player', async () => {
    const user = userEvent.setup()
    render(
      <GameSocketProvider>
        <UnlockHintProbe roomCode="bcdf2" />
      </GameSocketProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Reject hint' }))

    expect(mocks.emitWithAck).toHaveBeenCalledWith('game:reject-hint', {
      roomCode: 'bcdf2',
      gameId: '10000000-0000-4000-8000-000000000001',
      playerId: 'player-2',
    })
    expect(screen.getByTestId('unlock-status')).toHaveTextContent('success')
  })

  it.each(['create', 'join', 'leave'] as const)(
    'ignores a stale %s command after replacing the player token',
    async (command) => {
      const user = userEvent.setup()
      let resolveCommand!: (value: unknown) => void
      mocks.emitWithAck.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCommand = resolve
          }),
      )
      const view = render(
        <GameSocketProvider>
          <MembershipProbe command={command} roomCode="bcdf2" />
        </GameSocketProvider>,
      )
      await user.click(screen.getByRole('button', { name: command }))
      mocks.clientToken = 'b'.repeat(32)
      mocks.io.mockReturnValue({ ...mocks.socket })
      view.rerender(
        <GameSocketProvider>
          <MembershipProbe command={command} roomCode="bcdf2" />
        </GameSocketProvider>,
      )
      await waitFor(() => expect(mocks.io).toHaveBeenCalledTimes(2))
      if (command === 'leave') {
        act(() =>
          mocks.handlers.get('room:snapshot')?.(
            lobbySnapshot('bcdf2') as never,
          ),
        )
      }
      await act(async () =>
        resolveCommand({ status: 'success', roomCode: 'bcdf2' }),
      )
      expect(screen.getByTestId('command-status')).toHaveTextContent(
        'server_unavailable',
      )
      act(() => mocks.handlers.get('server:shutdown')?.())
    },
  )

  it.each([
    '',
    'http://example.com:3200',
    'http://localhost:3200',
    'not-a-url',
  ])(
    'does not transmit a production token to an insecure endpoint %s',
    (endpoint) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('NEXT_PUBLIC_GAME_SERVER_URL', endpoint)
      render(
        <GameSocketProvider>
          <RoomProbe roomCode="bcdf2" />
        </GameSocketProvider>,
      )
      expect(mocks.io).not.toHaveBeenCalled()
    },
  )

  it('authenticates production connections over HTTPS', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_GAME_SERVER_URL', 'https://game.example.com')
    render(
      <GameSocketProvider>
        <RoomProbe roomCode="bcdf2" />
      </GameSocketProvider>,
    )
    expect(mocks.io).toHaveBeenCalledWith(
      'https://game.example.com',
      expect.objectContaining({
        auth: expect.objectContaining({ token: mocks.clientToken }),
      }),
    )
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

  it('sends an unload-compatible leave intent for the watched room', async () => {
    render(
      <GameSocketProvider>
        <RoomProbe roomCode="bcdf2" />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())

    const event = new Event('pagehide')
    Object.defineProperty(event, 'persisted', { value: false })
    act(() => window.dispatchEvent(event))

    expect(navigator.sendBeacon).toHaveBeenCalledOnce()
    const [url, body] = vi.mocked(navigator.sendBeacon).mock.calls[0]
    expect(url).toBe('http://localhost:3200/leave-intent')
    expect(body).toBeInstanceOf(URLSearchParams)
    expect((body as URLSearchParams).get('token')).toBe(mocks.clientToken)
    expect((body as URLSearchParams).get('socketId')).toBe('socket-1')
    expect((body as URLSearchParams).getAll('roomCode')).toEqual(['bcdf2'])
  })

  it('does not send a leave intent when the page enters the back-forward cache', async () => {
    render(
      <GameSocketProvider>
        <RoomProbe roomCode="bcdf2" />
      </GameSocketProvider>,
    )
    await waitFor(() => expect(mocks.io).toHaveBeenCalled())

    const event = new Event('pagehide')
    Object.defineProperty(event, 'persisted', { value: true })
    act(() => window.dispatchEvent(event))

    expect(navigator.sendBeacon).not.toHaveBeenCalled()
  })

  it.each(['watchRoom', 'connect resume'] as const)(
    'ignores stale %s acknowledgements after replacing the player identity',
    async (flow) => {
      const replacementSocket = { ...mocks.socket }
      mocks.io
        .mockReturnValueOnce(mocks.socket)
        .mockReturnValueOnce(replacementSocket)
      let acknowledge: ((result: unknown) => void) | undefined
      const captureAcknowledgement = () =>
        mocks.socket.emit.mockImplementationOnce(
          (_event, _payload, callback) => {
            acknowledge = callback
          },
        )
      const view = render(
        <GameSocketProvider>
          <div />
        </GameSocketProvider>,
      )
      await waitFor(() => expect(mocks.io).toHaveBeenCalledOnce())

      if (flow === 'watchRoom') captureAcknowledgement()
      view.rerender(
        <GameSocketProvider>
          <RoomProbe roomCode="bcdf2" />
        </GameSocketProvider>,
      )
      if (flow === 'connect resume') {
        captureAcknowledgement()
        act(() => mocks.handlers.get('connect')?.())
      }
      expect(acknowledge).toBeTypeOf('function')
      mocks.clientToken = 'b'.repeat(32)
      view.rerender(
        <GameSocketProvider>
          <RoomProbe roomCode="bcdf2" />
        </GameSocketProvider>,
      )
      await waitFor(() => expect(mocks.io).toHaveBeenCalledTimes(2))

      act(() =>
        acknowledge?.({ status: 'success', snapshot: lobbySnapshot('bcdf2') }),
      )
      expect(screen.getByTestId('status')).toHaveTextContent('not_found')
      act(() =>
        mocks.handlers.get('room:snapshot')?.(lobbySnapshot('bcdf2') as never),
      )
      expect(screen.getByTestId('status')).toHaveTextContent('lobby')
    },
  )

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

  it('keeps a missing member room in the canonical not-found state', async () => {
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

    expect(screen.getByTestId('status')).toHaveTextContent('not_found')
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
    mocks.clientToken = 'b'.repeat(32)
    view.rerender(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )

    await waitFor(() => expect(mocks.io).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('status')).toHaveTextContent('not_found')
    expect(mocks.socket.disconnect).toHaveBeenCalledOnce()
  })

  it('keeps an expired snapshot after shutdown', async () => {
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
      mocks.handlers.get('room:snapshot')?.({
        status: 'expired',
        roomCode,
      } as never)
    })

    expect(screen.getByTestId('status')).toHaveTextContent('expired')

    act(() => mocks.handlers.get('server:shutdown')?.())
    expect(screen.getByTestId('status')).toHaveTextContent('expired')
  })

  it('keeps a removed snapshot after shutdown', async () => {
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

    act(() =>
      mocks.handlers.get('room:snapshot')?.({
        status: 'removed_from_room',
        roomCode,
      } as never),
    )

    expect(screen.getByTestId('status')).toHaveTextContent('removed_from_room')

    act(() => mocks.handlers.get('server:shutdown')?.())
    expect(screen.getByTestId('status')).toHaveTextContent('removed_from_room')
  })

  it('accepts a removed_from_room snapshot after reload', async () => {
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
      allowRoundReset: false,
    })
  })

  it('retains the last snapshot and blocks mutations until resume synchronizes it', async () => {
    const user = userEvent.setup()
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent('connected'),
    )
    expect(screen.getByTestId('status')).toHaveTextContent('lobby')

    mocks.emitWithAck.mockClear()
    mocks.socket.connected = false
    act(() => mocks.handlers.get('disconnect')?.())
    expect(screen.getByTestId('status')).toHaveTextContent('lobby')
    expect(screen.getByTestId('connection')).toHaveTextContent('disconnected')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.emitWithAck).not.toHaveBeenCalled()

    mocks.delayResumes = true
    mocks.socket.connected = true
    act(() => mocks.handlers.get('connect')?.())
    expect(screen.getByTestId('connection')).toHaveTextContent('connecting')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.emitWithAck).not.toHaveBeenCalled()

    act(() =>
      mocks.resumeCallbacks.get(roomCode)?.({
        status: 'success',
        snapshot: lobbySnapshot(roomCode),
      }),
    )
    expect(screen.getByTestId('connection')).toHaveTextContent('connected')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.emitWithAck).toHaveBeenCalledWith('room:remove-player', {
      roomCode,
      playerId: 'player-2',
      allowRoundReset: false,
    })
  })

  it('waits for resume to confirm that a room was not found', async () => {
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('lobby'),
    )

    mocks.delayResumes = true
    act(() => mocks.handlers.get('server:shutdown')?.())
    expect(screen.getByTestId('status')).toHaveTextContent('lobby')

    act(() => mocks.handlers.get('connect')?.())
    act(() =>
      mocks.resumeCallbacks.get(roomCode)?.({
        status: 'success',
        snapshot: { status: 'not_found', roomCode },
      }),
    )
    expect(screen.getByTestId('status')).toHaveTextContent('not_found')
  })

  it('retries a failed resume while keeping mutations blocked', async () => {
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent('connected'),
    )

    mocks.delayResumes = true
    act(() => mocks.handlers.get('connect')?.())
    expect(screen.getByTestId('connection')).toHaveTextContent('connecting')

    vi.useFakeTimers()
    act(() =>
      mocks.resumeCallbacks.get(roomCode)?.({
        status: 'server_unavailable',
        message: 'Please try again.',
      }),
    )

    expect(screen.getByTestId('connection')).toHaveTextContent('disconnected')
    expect(screen.getByTestId('status')).toHaveTextContent('lobby')

    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByTestId('connection')).toHaveTextContent('connecting')

    act(() =>
      mocks.resumeCallbacks.get(roomCode)?.({
        status: 'success',
        snapshot: lobbySnapshot(roomCode),
      }),
    )
    expect(screen.getByTestId('connection')).toHaveTextContent('connected')
  })

  it('stops retrying resume after the bounded attempt limit', async () => {
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent('connected'),
    )

    mocks.delayResumes = true
    act(() => mocks.handlers.get('connect')?.())
    vi.useFakeTimers()
    const failResume = () =>
      act(() =>
        mocks.resumeCallbacks.get(roomCode)?.({
          status: 'server_unavailable',
          message: 'Please try again.',
        }),
      )

    failResume()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      act(() => vi.advanceTimersByTime(1_000))
      failResume()
    }
    const resumeCallCount = mocks.socket.emit.mock.calls.filter(
      ([event]) => event === 'session:resume',
    ).length

    act(() => vi.advanceTimersByTime(10_000))

    expect(
      mocks.socket.emit.mock.calls.filter(
        ([event]) => event === 'session:resume',
      ),
    ).toHaveLength(resumeCallCount)
    expect(screen.getByTestId('connection')).toHaveTextContent('disconnected')
  })

  it('ignores a stale resume when connection changes repeat', async () => {
    const roomCode = 'bcdf2'
    mocks.resumeSnapshots.set(roomCode, lobbySnapshot(roomCode))
    render(
      <GameSocketProvider>
        <RoomProbe roomCode={roomCode} />
      </GameSocketProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent('connected'),
    )

    mocks.delayResumes = true
    mocks.socket.connected = false
    act(() => mocks.handlers.get('disconnect')?.())
    mocks.socket.connected = true
    act(() => mocks.handlers.get('connect')?.())
    const staleResume = mocks.resumeCallbacks.get(roomCode)

    mocks.socket.connected = false
    act(() => mocks.handlers.get('disconnect')?.())
    mocks.socket.connected = true
    act(() => mocks.handlers.get('connect')?.())
    const currentResume = mocks.resumeCallbacks.get(roomCode)

    act(() =>
      staleResume?.({
        status: 'success',
        snapshot: { status: 'not_found', roomCode },
      }),
    )
    expect(screen.getByTestId('connection')).toHaveTextContent('connecting')
    expect(screen.getByTestId('status')).toHaveTextContent('lobby')

    act(() =>
      currentResume?.({
        status: 'success',
        snapshot: lobbySnapshot(roomCode),
      }),
    )
    expect(screen.getByTestId('connection')).toHaveTextContent('connected')
    expect(screen.getByTestId('status')).toHaveTextContent('lobby')
  })

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
