import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import { RoomLobby } from './room-lobby'

type LobbyView = Extract<RoomSnapshot, { status: 'lobby' }>

const mocks = vi.hoisted(() => ({
  view: null as RoomSnapshot | null,
  startGame: vi.fn(),
  claimCard: vi.fn(),
  finishGuessing: vi.fn(),
  removePlayer: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/game-socket-provider', () => ({
  useGameSocket: () => ({
    startGame: mocks.startGame,
    claimCard: mocks.claimCard,
    finishGuessing: mocks.finishGuessing,
    removePlayer: mocks.removePlayer,
  }),
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
    mocks.claimCard
      .mockReset()
      .mockResolvedValue({ status: 'success', kind: 'target' })
    mocks.finishGuessing.mockReset().mockResolvedValue({ status: 'success' })
    mocks.removePlayer.mockReset().mockResolvedValue({ status: 'success' })
    mocks.routerPush.mockReset()
  })

  it('sends the displayed turn identity with claims and passes after a snapshot change', async () => {
    const user = userEvent.setup()
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      ...readyLobby(),
      status: 'guessing',
      turnId: '00000000-0000-4000-8000-000000000001',
      turnNumber: 1,
      totalTurns: 2,
      clueGiverId: 'guest',
      clueGiverName: 'Grace',
      hint: 'Orbit',
      hintNumber: 2,
      board: [
        {
          id: 'p1-card-0',
          word: 'MOON',
          revealedKind: null,
          claimedBy: [],
          selectedByYou: false,
          disabled: false,
        },
      ],
      turnPlayers: [],
      scoreboard: [],
      canGuess: true,
      canMarkDone: true,
      canAdvanceTurn: false,
    }
    mocks.view = view
    const rendered = render(<RoomLobby roomCode="bcdf2" />)
    for (const turnId of [
      view.turnId,
      '00000000-0000-4000-8000-000000000002',
    ]) {
      mocks.view = { ...view, turnId }
      rendered.rerender(<RoomLobby roomCode="bcdf2" />)
      await user.click(screen.getByRole('button', { name: /moon/i }))
      expect(mocks.claimCard).toHaveBeenLastCalledWith({
        roomCode: 'bcdf2',
        turnId,
        cardId: 'p1-card-0',
        commandId: expect.any(String),
      })
      await user.click(
        screen.getByRole('button', { name: 'I’m done guessing' }),
      )
      expect(mocks.finishGuessing).toHaveBeenLastCalledWith({
        roomCode: 'bcdf2',
        turnId,
      })
    }
  })

  it.each([
    [2, 'Invite at least 1 more player.'],
    [3, 'Invite at least 2 more players.'],
  ])('uses the correct noun when the minimum is %i', (minimum, message) => {
    mocks.view = lobbyView(minimum)
    render(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /\b(?:timers?|rounds?)\b/i,
    )
    expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled()
  })

  it('shows the ready message and enables starting when enough players join', () => {
    mocks.view = readyLobby()
    render(<RoomLobby roomCode="bcdf2" />)

    expect(
      screen.getByRole('heading', { name: 'Assemble the room.' }),
    ).toBeVisible()
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /Everyone who is here when the host starts|Late arrivals can still watch as spectators/i,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ready when the host is.',
    )
    expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled()
  })

  it('shows a server error instead of the normal prompt after starting fails', async () => {
    const user = userEvent.setup()
    mocks.view = readyLobby()
    mocks.startGame.mockResolvedValue({
      status: 'rate_limited',
      message: 'Too many commands.',
    })
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Start game' }))

    expect(mocks.startGame).toHaveBeenCalledWith('bcdf2')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many commands.',
    )
    expect(
      screen.queryByText('Ready when the host is.'),
    ).not.toBeInTheDocument()
  })

  it('clears a prior command error when removing a player successfully', async () => {
    const user = userEvent.setup()
    mocks.view = readyLobby()
    mocks.startGame.mockResolvedValue({
      status: 'rate_limited',
      message: 'Too many commands.',
    })
    render(<RoomLobby roomCode="bcdf2" />)
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many commands.',
    )
    await user.click(screen.getByRole('button', { name: 'Remove Grace' }))
    expect(mocks.removePlayer).toHaveBeenCalledWith('bcdf2', 'guest')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
