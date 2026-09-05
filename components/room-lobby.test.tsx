import { render, screen, within } from '@testing-library/react'
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
  removePlayer: vi.fn(),
  leaveRoom: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/game-socket-provider', () => ({
  useGameSocket: () => ({
    startGame: mocks.startGame,
    claimCard: mocks.claimCard,
    finishGuessing: mocks.finishGuessing,
    advanceTurn: mocks.advanceTurn,
    showScoreboard: mocks.showScoreboard,
    removePlayer: mocks.removePlayer,
    leaveRoom: mocks.leaveRoom,
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

function completedLobby(gameId = '10000000-0000-4000-8000-000000000001') {
  const view = readyLobby()
  return {
    ...view,
    lastGameResults: {
      gameId,
      scoreboard: view.members.map((member, index) => ({
        ...member,
        score: index === 0 ? 6 : 3,
        position: index + 1,
      })),
    },
  } satisfies LobbyView
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
    turnSettled: false,
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

function hintingView(): Extract<RoomSnapshot, { status: 'hinting' }> {
  const lobby = readyLobby()
  return {
    ...lobby,
    status: 'hinting',
    gameId: '10000000-0000-4000-8000-000000000001',
    hintStatuses: lobby.members.map(({ playerId, name }) => ({
      playerId,
      name,
      submitted: false,
      needsRevision: false,
      hint: null,
      hintNumber: null,
    })),
    allHintsSubmitted: false,
    hint: null,
    hintSubmitted: false,
    hintRejected: false,
    board: [{ id: 'p0-card-0', word: 'MOON', kind: 'neutral', locked: false }],
  }
}

describe('RoomLobby invite prompt', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mocks.view = lobbyView()
    mocks.connectionStatus = 'connected'
    mocks.startGame.mockReset().mockResolvedValue({ status: 'success' })
    mocks.claimCard
      .mockReset()
      .mockResolvedValue({ status: 'success', kind: 'target' })
    mocks.finishGuessing.mockReset().mockResolvedValue({ status: 'success' })
    mocks.removePlayer.mockReset().mockResolvedValue({ status: 'success' })
    mocks.leaveRoom.mockReset().mockResolvedValue({ status: 'success' })
    mocks.routerPush.mockReset()
  })

  it('lets a host leave immediately when they are alone in the room', async () => {
    const user = userEvent.setup()
    mocks.view = lobbyView()
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Leave room' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.leaveRoom).toHaveBeenCalledWith('bcdf2')
    expect(mocks.routerPush).toHaveBeenCalledWith('/')
  })

  it('shows a failed immediate leave without opening a confirmation dialog', async () => {
    const user = userEvent.setup()
    mocks.leaveRoom.mockResolvedValue({
      status: 'server_unavailable',
      message: 'Could not leave this room.',
    })
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Leave room' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not leave this room.',
    )
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  it('lets an active hinting participant leave the round and returns home', async () => {
    const user = userEvent.setup()
    mocks.view = hintingView()
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Leave room' }))

    expect(mocks.leaveRoom).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', {
      name: 'Leave as host?',
    })
    expect(dialog).toHaveTextContent(
      /another room member will become host.*current participation will end.*completed scores and game history will remain/i,
    )
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Leave room' }))

    expect(mocks.leaveRoom).toHaveBeenCalledWith('bcdf2')
    expect(mocks.routerPush).toHaveBeenCalledWith('/')
  })

  it('keeps a hinting participant in place when leaving fails', async () => {
    const user = userEvent.setup()
    mocks.view = hintingView()
    mocks.leaveRoom.mockResolvedValue({
      status: 'server_unavailable',
      message: 'Could not leave this room.',
    })
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Leave room' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Leave as host?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Leave room' }))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Could not leave this room.',
    )
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  it('keeps a participant in the room when they cancel leaving', async () => {
    const user = userEvent.setup()
    mocks.view = hintingView()
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Leave room' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(
      screen.queryByRole('alertdialog', { name: 'Leave as host?' }),
    ).not.toBeInTheDocument()
    expect(mocks.leaveRoom).not.toHaveBeenCalled()
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  it('explains the non-host consequences without describing host transfer', async () => {
    const user = userEvent.setup()
    const view = hintingView()
    mocks.view = { ...view, player: view.members[1] }
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Leave room' }))

    const dialog = screen.getByRole('alertdialog', {
      name: 'Leave this room?',
    })
    expect(dialog).toHaveTextContent(
      /leave the current game.*completed scores and game history will remain/i,
    )
    expect(dialog).not.toHaveTextContent(/become host/i)
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

  it('puts host actions in a separate Host control card', () => {
    mocks.view = readyLobby()
    render(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('heading', { name: 'lobby.' })).toBeVisible()
    expect(screen.getByRole('main')).not.toHaveTextContent(
      /Everyone who is here when the host starts|Late arrivals can still watch as spectators/i,
    )
    const roster = screen.getByRole('list', { name: 'Players in this room' })
    const roomCard = roster.closest('.game-panel') as HTMLElement
    const hostControls = screen.getByRole('region', { name: 'Host controls' })
    expect(within(roster).queryByRole('button')).not.toBeInTheDocument()
    expect(
      within(hostControls).getByRole('button', { name: 'Remove Grace' }),
    ).toBeVisible()
    // Start game lives at the bottom of the room card, not the host card.
    expect(roomCard).not.toBe(hostControls)
    expect(
      within(roomCard).getByRole('button', { name: 'Start game' }),
    ).toBeEnabled()
    expect(
      within(hostControls).queryByRole('button', { name: 'Start game' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Ready when the host is.'),
    ).not.toBeInTheDocument()
  })

  it('shows the same action-free lobby list to a non-host', () => {
    const view = readyLobby()
    mocks.view = { ...view, player: view.members[1] }
    render(<RoomLobby roomCode="bcdf2" />)

    const roster = screen.getByRole('list', { name: 'Players in this room' })
    expect(within(roster).getAllByRole('listitem')).toHaveLength(2)
    expect(within(roster).queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Start game' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Host controls' }),
    ).not.toBeInTheDocument()
  })

  it('lets each participant dismiss retained results without a server command', async () => {
    const user = userEvent.setup()
    mocks.view = completedLobby()
    render(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('heading', { name: 'scoreboard.' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Return to lobby' }))

    expect(screen.getByRole('heading', { name: 'lobby.' })).toBeVisible()
    expect(
      window.localStorage.getItem('secret-hitman-5:dismissed-game-results'),
    ).toContain('10000000-0000-4000-8000-000000000001')
  })

  it('keeps dismissed results hidden when the client returns to the room', () => {
    window.localStorage.setItem(
      'secret-hitman-5:dismissed-game-results',
      JSON.stringify(['10000000-0000-4000-8000-000000000001']),
    )
    mocks.view = completedLobby()

    render(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('heading', { name: 'lobby.' })).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'scoreboard.' }),
    ).not.toBeInTheDocument()
  })

  it('replaces open results when the host starts the next game', () => {
    mocks.view = completedLobby()
    const rendered = render(<RoomLobby roomCode="bcdf2" />)
    expect(screen.getByRole('heading', { name: 'scoreboard.' })).toBeVisible()

    mocks.view = hintingView()
    rendered.rerender(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByLabelText('Hint submission prompt')).toHaveTextContent(
      'Select 1-5 targets. Type your hint. Submit.',
    )
    expect(
      screen.queryByRole('heading', { name: 'scoreboard.' }),
    ).not.toBeInTheDocument()
  })

  it('shows the lobby directly when the server omits prior results', () => {
    mocks.view = readyLobby()
    render(<RoomLobby roomCode="bcdf2" />)

    expect(screen.getByRole('heading', { name: 'lobby.' })).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'scoreboard.' }),
    ).not.toBeInTheDocument()
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
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Grace will leave the lobby and will not be able to rejoin this room.',
    )
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.removePlayer).toHaveBeenCalledWith('bcdf2', 'guest')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a removal failure inside its confirmation dialog', async () => {
    const user = userEvent.setup()
    mocks.view = readyLobby()
    mocks.removePlayer.mockResolvedValue({
      status: 'server_unavailable',
      message: 'Could not remove this player.',
    })
    render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Remove Grace' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Grace?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not remove this player.',
    )
    expect(
      within(screen.getByRole('region', { name: 'Host controls' })).queryByRole(
        'alert',
      ),
    ).not.toBeInTheDocument()
    expect(dialog).toBeVisible()
  })

  it.each(['connecting', 'disconnected'] as const)(
    'keeps the lobby visible and disables mutations while %s',
    (connectionStatus) => {
      mocks.view = readyLobby()
      mocks.connectionStatus = connectionStatus
      render(<RoomLobby roomCode="bcdf2" />)

      expect(screen.getByRole('heading', { name: 'lobby.' })).toBeVisible()
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

    expect(screen.getByLabelText('Current hint')).toBeVisible()
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
      '/',
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
    expect(
      screen.getByRole('link', { name: 'Back to home' }).parentElement,
    ).toHaveClass('mx-auto', 'max-w-xs')
  })

  it('explains an early round ending before revealing the returned lobby', async () => {
    const user = userEvent.setup()
    mocks.view = { ...lobbyView(), lobbyNotice: 'player_left' }
    render(<RoomLobby roomCode="bcdf2" />)

    const dialog = screen.getByRole('alertdialog', {
      name: 'The round ended early',
    })
    expect(dialog).toHaveTextContent(
      /another player left.*fewer than two players.*round was ended.*returned to the lobby/i,
    )
    expect(
      screen.getByRole('button', { name: 'Return to lobby' }),
    ).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Return to lobby' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'lobby.' })).toBeVisible()
  })

  it('shows the explanation again after a later round ends early', async () => {
    const user = userEvent.setup()
    mocks.view = { ...lobbyView(), lobbyNotice: 'player_left' }
    const rendered = render(<RoomLobby roomCode="bcdf2" />)

    await user.click(screen.getByRole('button', { name: 'Return to lobby' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    mocks.view = lobbyView()
    rendered.rerender(<RoomLobby roomCode="bcdf2" />)
    mocks.view = { ...lobbyView(), lobbyNotice: 'player_left' }
    rendered.rerender(<RoomLobby roomCode="bcdf2" />)

    expect(
      await screen.findByRole('alertdialog', {
        name: 'The round ended early',
      }),
    ).toBeVisible()
  })

  it('infers an early round ending when the live lobby snapshot omits its notice', () => {
    mocks.view = hintingView()
    const rendered = render(<RoomLobby roomCode="bcdf2" />)

    mocks.view = lobbyView()
    rendered.rerender(<RoomLobby roomCode="bcdf2" />)

    expect(
      screen.getByRole('alertdialog', { name: 'The round ended early' }),
    ).toBeVisible()
  })
})
