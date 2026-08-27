import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import { RoomLobby } from './room-lobby'

type LobbyView = Extract<RoomSnapshot, { status: 'lobby' }>

const mocks = vi.hoisted(() => ({
  view: null as LobbyView | null,
  startGame: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/game-socket-provider', () => ({
  useGameSocket: () => ({ startGame: mocks.startGame }),
  useRoomSnapshot: () => ({
    snapshot: mocks.view,
    endedReason: null,
    connectionStatus: 'connected',
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))

vi.mock('@/components/room-invite-card', () => ({
  RoomInviteCard: () => null,
  RoomInviteActions: () => null,
}))

function lobbyView(minimumPlayers = 2): LobbyView {
  const player: LobbyView['player'] = {
    playerId: 'host',
    name: 'Ada',
    role: 'host',
    participation: 'player',
  }
  return {
    status: 'lobby',
    roomCode: 'bcdf2',
    revision: 1,
    player,
    members: [player],
    minimumPlayers,
  }
}

function readyLobby(): LobbyView {
  const view = lobbyView()
  view.members.push({
    playerId: 'guest',
    name: 'Grace',
    role: 'player',
    participation: 'player',
  })
  return view
}

describe('RoomLobby invite prompt', () => {
  beforeEach(() => {
    mocks.view = lobbyView()
    mocks.startGame.mockReset().mockResolvedValue({ status: 'success' })
    mocks.routerPush.mockReset()
  })

  it.each([
    [2, 'Invite at least 1 more player.'],
    [3, 'Invite at least 2 more players.'],
  ])('uses the correct noun when the minimum is %i', (minimum, message) => {
    mocks.view = lobbyView(minimum)
    render(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(
      screen.getByRole('button', { name: 'Start the single round' }),
    ).toBeDisabled()
  })

  it('shows the ready message and enables starting when enough players join', () => {
    mocks.view = readyLobby()
    render(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Ready when the host is.',
    )
    expect(
      screen.getByRole('button', { name: 'Start the single round' }),
    ).toBeEnabled()
  })

  it('shows a server error instead of the normal prompt after starting fails', async () => {
    const user = userEvent.setup()
    mocks.view = readyLobby()
    mocks.startGame.mockResolvedValue({
      status: 'rate_limited',
      message: 'Too many commands.',
    })
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(
      screen.getByRole('button', { name: 'Start the single round' }),
    )

    expect(mocks.startGame).toHaveBeenCalledWith('bcdf2')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many commands.',
    )
    expect(
      screen.queryByText('Ready when the host is.'),
    ).not.toBeInTheDocument()
  })
})
