import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import { RoomLobby } from './room-lobby'

type LobbyView = Extract<RoomSnapshot, { status: 'lobby' }>

const mocks = vi.hoisted(() => ({
  view: null as RoomSnapshot | null,
  connectionStatus: 'connected' as 'connecting' | 'connected' | 'disconnected',
  startGame: vi.fn(),
  claimCard: vi.fn(),
  finishGuessing: vi.fn(),
  advanceTurn: vi.fn(),
  showScoreboard: vi.fn(),
  returnToLobby: vi.fn(),
  removePlayer: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/game-socket-provider', () => ({
  useGameSocket: () => ({
    startGame: mocks.startGame,
    claimCard: mocks.claimCard,
    finishGuessing: mocks.finishGuessing,
    advanceTurn: mocks.advanceTurn,
    showScoreboard: mocks.showScoreboard,
    returnToLobby: mocks.returnToLobby,
    removePlayer: mocks.removePlayer,
  }),
  useRoomSnapshot: () => ({
    snapshot: mocks.view,
    connectionStatus: mocks.connectionStatus,
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

function guessingView(): Extract<RoomSnapshot, { status: 'guessing' }> {
  return {
    ...readyLobby(),
    status: 'guessing',
    gameId: '10000000-0000-4000-8000-000000000001',
    turnId: '00000000-0000-4000-8000-000000000001',
    turnNumber: 1,
    totalTurns: 2,
    clueGiverId: 'guest',
    clueGiverName: 'Grace',
    hint: 'Orbit',
    hintNumber: 2,
    boardCompleted: false,
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
}

describe('RoomLobby invite prompt', () => {
  beforeEach(() => {
    mocks.view = lobbyView()
    mocks.connectionStatus = 'connected'
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
    const view = guessingView()
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
        gameId: view.gameId,
        turnId,
        cardId: 'p1-card-0',
        commandId: expect.any(String),
      })
      await user.click(
        screen.getByRole('button', { name: 'I’m done guessing' }),
      )
      expect(mocks.finishGuessing).toHaveBeenLastCalledWith({
        roomCode: 'bcdf2',
        gameId: view.gameId,
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

  it.each(['connecting', 'disconnected'] as const)(
    'keeps the lobby visible and disables mutations while %s',
    (connectionStatus) => {
      mocks.view = readyLobby()
      mocks.connectionStatus = connectionStatus
      render(<RoomLobby roomCode="bcdf2" />)

      expect(
        screen.getByRole('heading', { name: 'Assemble the room.' }),
      ).toBeVisible()
      expect(
        screen.getByText('Reconnecting · updates may be delayed'),
      ).toBeVisible()
      expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Leave room' })).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Remove Grace' }),
      ).toBeDisabled()
      if (connectionStatus === 'disconnected') {
        expect(
          screen.getByText(
            'Connection interrupted. Reconnecting; room details may be out of date.',
          ),
        ).toHaveAttribute('aria-live', 'polite')
      } else {
        expect(
          screen.queryByText(/Connection (?:interrupted|restored)/),
        ).not.toBeInTheDocument()
      }
    },
  )

  it('restores lobby controls after the connection is synchronized', () => {
    mocks.view = readyLobby()
    mocks.connectionStatus = 'disconnected'
    const view = render(<RoomLobby roomCode="bcdf2" />)
    expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled()

    mocks.connectionStatus = 'connected'
    view.rerender(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled()
    expect(
      screen.getByText('Connection restored. Room details are up to date.'),
    ).toHaveAttribute('aria-live', 'polite')
    expect(
      screen.queryByText('Reconnecting · updates may be delayed'),
    ).not.toBeInTheDocument()
  })

  it('keeps the gameplay screen visible with its mutations disabled', () => {
    mocks.view = guessingView()
    mocks.connectionStatus = 'disconnected'
    render(<RoomLobby roomCode="bcdf2" />)

    expect(
      screen.getByRole('heading', { name: 'Grace is the clue-giver' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /moon/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'I’m done guessing' }),
    ).toBeDisabled()
    expect(
      screen.getByText('Reconnecting · updates may be delayed'),
    ).toBeVisible()
  })

  it('uses canonical not-found copy with recovery actions', () => {
    mocks.view = { status: 'not_found', roomCode: 'bcdf2' }
    render(<RoomLobby roomCode="bcdf2" />)

    expect(
      screen.getByRole('heading', {
        name: 'Room not found',
      }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute(
      'href',
      '/home',
    )
    expect(screen.getByRole('link', { name: 'Create a room' })).toHaveAttribute(
      'href',
      '/create',
    )
    expect(
      screen.getByRole('link', { name: 'Join another room' }),
    ).toHaveAttribute('href', '/join')
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /server|restart|in-memory|persistence|deployment/i,
    )
  })

  it('renders an expired snapshot as the ended-room page', () => {
    mocks.view = { status: 'expired', roomCode: 'bcdf2' }
    render(<RoomLobby roomCode="bcdf2" />)

    expect(
      screen.getByRole('heading', { name: 'This room ended' }),
    ).toBeVisible()
    expect(screen.getByText(/expired after a period/i)).toBeVisible()
  })

  it('renders a removed snapshot as the removed-player page', () => {
    mocks.view = { status: 'removed_from_room', roomCode: 'bcdf2' }
    render(<RoomLobby roomCode="bcdf2" />)

    expect(
      screen.getByRole('heading', { name: 'You were removed' }),
    ).toBeVisible()
  })
})
