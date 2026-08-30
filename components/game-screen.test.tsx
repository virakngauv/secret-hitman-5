import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import { FinishedScreen, GuessingScreen, HintPhaseScreen } from './game-screen'

const hintingView: Extract<RoomSnapshot, { status: 'hinting' }> = {
  status: 'hinting',
  roomCode: 'bcdf2',
  player: {
    playerId: 'player-1',
    name: 'Ada',
    role: 'host',
    participation: 'player',
  },
  members: [
    {
      playerId: 'player-1',
      name: 'Ada',
      role: 'host',
      participation: 'player',
    },
    {
      playerId: 'player-2',
      name: 'Grace',
      role: 'player',
      participation: 'player',
    },
  ],
  hintStatuses: [
    { playerId: 'player-1', name: 'Ada', submitted: false },
    { playerId: 'player-2', name: 'Grace', submitted: false },
  ],
  allHintsSubmitted: false,
  hint: null,
  hintSubmitted: false,
  board: [
    { id: 'p0-card-0', word: 'MOON', kind: 'neutral', locked: false },
    { id: 'p0-card-1', word: 'SATELLITE', kind: 'neutral', locked: false },
    { id: 'p0-card-2', word: 'POISON', kind: 'assassin', locked: true },
    { id: 'p0-card-3', word: 'ROCKET', kind: 'civilian', locked: true },
    { id: 'p0-card-4', word: 'RIVER', kind: 'civilian', locked: true },
    { id: 'p0-card-5', word: 'FOREST', kind: 'civilian', locked: true },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `p0-card-${index + 6}`,
      word: `WORD ${index + 1}`,
      kind: 'neutral' as const,
      locked: false,
    })),
  ],
}

describe('HintPhaseScreen', () => {
  it('shows the score beside every clue-board role and state', async () => {
    const user = userEvent.setup()
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    const available = screen.getByRole('button', {
      name: /available −1.*moon/i,
    })
    expect(available).toBeVisible()
    expect(
      within(available).getByText('−1', { selector: 'span.word-card-score' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: /civilian −1.*locked.*rocket/i,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: /assassin −5.*locked.*poison/i,
      }),
    ).toBeVisible()

    await user.click(available)
    expect(
      screen.getByRole('button', { name: /target \+3.*moon/i }),
    ).toBeVisible()
  })

  it('keeps fixed roles disabled and requires at least one editable target', async () => {
    const user = userEvent.setup()
    const onSubmitHint = vi.fn().mockResolvedValue({ status: 'success' })
    const props = {
      view: hintingView,
      onSubmitHint,
      onUnlockHint: vi.fn(),
      onStartGuessing: vi.fn(),
    }
    const first = render(<HintPhaseScreen {...props} />)
    for (const name of [
      /civilian.*locked.*rocket/i,
      /civilian.*locked.*river/i,
      /civilian.*locked.*forest/i,
      /assassin.*locked.*poison/i,
    ]) {
      const card = screen.getByRole('button', { name })
      expect(card).toBeDisabled()
      expect(card.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      await user.click(card)
    }
    await user.click(screen.getByRole('button', { name: /available.*moon/i }))
    expect(
      screen.getByText('1', { selector: '.hint-number-value' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /target.*moon/i }))
    expect(
      screen.getByText('0', { selector: '.hint-number-value' }),
    ).toBeInTheDocument()
    first.unmount()
    render(<HintPhaseScreen {...props} />)
    expect(
      screen.getByRole('button', { name: /civilian.*locked.*rocket/i }),
    ).toHaveAttribute('aria-pressed', 'false')
    await user.type(screen.getByLabelText('Your hint'), 'space')
    expect(
      screen.getByRole('button', { name: 'Lock in hint · 0' }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /available.*moon/i }))
    await user.click(screen.getByRole('button', { name: 'Lock in hint · 1' }))
    expect(onSubmitHint).toHaveBeenCalledWith('space', ['p0-card-0'])
  })

  it('auto-counts selected cards, freezes the assassin, and submits the derived targets', async () => {
    const user = userEvent.setup()
    const onSubmitHint = vi.fn().mockResolvedValue({ status: 'success' })
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={onSubmitHint}
        onUnlockHint={vi.fn()}
        onStartGuessing={vi.fn().mockResolvedValue({ status: 'success' })}
      />,
    )

    expect(screen.getByText('Start when all hints are locked.')).toBeVisible()
    expect(screen.getByRole('main')).not.toHaveTextContent(/\btimers?\b/i)
    expect(
      screen.getByRole('button', { name: 'Start guessing' }),
    ).toBeDisabled()
    const assassin = screen.getByRole('button', { name: /assassin.*poison/i })
    expect(assassin).toBeDisabled()
    await user.type(screen.getByLabelText('Your hint'), 'orbit')
    await user.click(screen.getByRole('button', { name: /available.*moon/i }))
    await user.click(
      screen.getByRole('button', { name: /available.*satellite/i }),
    )
    expect(
      screen.getByText('2', { selector: '.hint-number-value' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lock in hint · 2' }))

    expect(onSubmitHint).toHaveBeenCalledWith('orbit', [
      'p0-card-0',
      'p0-card-1',
    ])
  })

  it('caps target selection at five while keeping selected cards editable', async () => {
    const user = userEvent.setup()
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )
    const editable = screen
      .getAllByRole('button', { name: /available/i })
      .slice(0, 6)
    for (const card of editable.slice(0, 5)) await user.click(card)
    expect(
      screen.getByText('5', { selector: '.hint-number-value' }),
    ).toBeVisible()
    expect(editable[5]).toBeDisabled()
    expect(editable[0]).toBeEnabled()
    await user.click(editable[0])
    expect(editable[5]).toBeEnabled()
  })

  it('keeps a locked hint and board visible, then preserves edits through unlock and relock', async () => {
    const user = userEvent.setup()
    const onUnlockHint = vi.fn().mockResolvedValue({ status: 'success' })
    const onSubmitHint = vi.fn().mockResolvedValue({ status: 'success' })
    const lockedBoard = hintingView.board!.map((card, index) =>
      card.locked
        ? card
        : {
            ...card,
            kind: index < 2 ? ('target' as const) : ('civilian' as const),
          },
    )
    const lockedView = {
      ...hintingView,
      hint: 'Orbit',
      hintSubmitted: true,
      hintStatuses: hintingView.hintStatuses.map((status) =>
        status.playerId === hintingView.player.playerId
          ? { ...status, submitted: true }
          : status,
      ),
      board: lockedBoard,
    }
    const props = {
      onSubmitHint,
      onUnlockHint,
      onStartGuessing: vi.fn(),
    }
    const view = render(<HintPhaseScreen view={lockedView} {...props} />)

    expect(screen.getByLabelText('Your hint')).toHaveValue('Orbit')
    expect(screen.getByLabelText('Your hint')).toHaveAttribute('readonly')
    expect(screen.getByText('Hint locked in.', { exact: false })).toBeVisible()
    expect(screen.getByRole('button', { name: /target.*moon/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /target.*satellite/i }),
    ).toBeDisabled()
    expect(screen.getByText('1/2')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Unlock / Edit hint' }))
    expect(onUnlockHint).toHaveBeenCalledOnce()

    const unlockedView = {
      ...lockedView,
      hintSubmitted: false,
      hintStatuses: hintingView.hintStatuses,
      board: lockedBoard.map((card) =>
        !card.locked && card.kind === 'civilian'
          ? { ...card, kind: 'neutral' as const }
          : card,
      ),
    }
    view.rerender(<HintPhaseScreen view={unlockedView} {...props} />)

    const hintInput = screen.getByLabelText('Your hint')
    expect(hintInput).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /target.*moon/i })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /target.*satellite/i }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /assassin.*poison/i }),
    ).toBeDisabled()
    expect(screen.getByText('0/2')).toBeVisible()

    await user.clear(hintInput)
    await user.type(hintInput, 'Galaxy')
    await user.click(screen.getByRole('button', { name: /target.*moon/i }))
    await user.click(screen.getByRole('button', { name: /available.*word 1/i }))
    await user.click(screen.getByRole('button', { name: 'Lock in hint · 2' }))
    expect(onSubmitHint).toHaveBeenCalledWith('Galaxy', [
      'p0-card-1',
      'p0-card-6',
    ])
  })
})

describe('GuessingScreen messages', () => {
  it('shows scores for claimed cards without exposing unclaimed values', () => {
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      turnId: '00000000-0000-4000-8000-000000000001',
      roomCode: 'bcdf2',
      player: hintingView.player,
      members: hintingView.members,
      turnNumber: 1,
      totalTurns: 2,
      clueGiverId: 'player-2',
      clueGiverName: 'Grace',
      hint: 'Orbit',
      hintNumber: 2,
      boardCompleted: false,
      board: [
        {
          id: 'target',
          word: 'MOON',
          revealedKind: 'target',
          claimedBy: ['Ada'],
          selectedByYou: false,
          disabled: true,
        },
        {
          id: 'civilian',
          word: 'RIVER',
          revealedKind: 'civilian',
          claimedBy: ['Grace'],
          selectedByYou: false,
          disabled: true,
        },
        {
          id: 'assassin',
          word: 'POISON',
          revealedKind: 'assassin',
          claimedBy: ['Grace'],
          selectedByYou: false,
          disabled: true,
        },
        {
          id: 'unclaimed-target',
          word: 'ROCKET',
          revealedKind: 'target',
          claimedBy: [],
          selectedByYou: false,
          disabled: false,
        },
        {
          id: 'hidden',
          word: 'STAR',
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

    render(
      <GuessingScreen
        view={view}
        onClaimCard={vi.fn()}
        onFinishGuessing={vi.fn()}
        onAdvanceTurn={vi.fn()}
      />,
    )

    expect(
      within(screen.getByRole('button', { name: /target.*moon/i })).getByText(
        '+3',
        { selector: '.word-card-score' },
      ),
    ).toBeVisible()
    expect(
      within(
        screen.getByRole('button', { name: /civilian.*river/i }),
      ).getByText('−1', { selector: '.word-card-score' }),
    ).toBeVisible()
    expect(
      within(
        screen.getByRole('button', { name: /assassin.*poison/i }),
      ).getByText('−5', { selector: '.word-card-score' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: /target.*rocket/i }),
    ).not.toHaveTextContent(/[+−]\d/)
    expect(
      screen.getByRole('button', { name: /classified.*star/i }),
    ).not.toHaveTextContent(/[+−]\d/)
  })

  it('identifies accepted picks without labeling untouched cards', () => {
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      turnId: '00000000-0000-4000-8000-000000000001',
      roomCode: 'bcdf2',
      player: hintingView.player,
      members: hintingView.members,
      turnNumber: 1,
      totalTurns: 2,
      clueGiverId: 'player-2',
      clueGiverName: 'Grace',
      hint: 'Orbit',
      hintNumber: 1,
      boardCompleted: true,
      board: [
        {
          id: 'claimed-target',
          word: 'MOON',
          revealedKind: 'target',
          claimedBy: ['Ada'],
          selectedByYou: true,
          disabled: true,
        },
        {
          id: 'unselected-assassin',
          word: 'POISON',
          revealedKind: 'assassin',
          claimedBy: [],
          selectedByYou: false,
          disabled: true,
        },
      ],
      turnPlayers: [],
      scoreboard: [],
      canGuess: false,
      canMarkDone: false,
      canAdvanceTurn: true,
    }

    render(
      <GuessingScreen
        view={view}
        onClaimCard={vi.fn()}
        onFinishGuessing={vi.fn()}
        onAdvanceTurn={vi.fn()}
      />,
    )

    const board = screen.getByLabelText('Completed and fully revealed board')
    expect(within(board).getByText('Ada')).toBeVisible()
    expect(within(board).queryByText('Unselected')).not.toBeInTheDocument()
    expect(
      within(board)
        .getByRole('button', { name: /assassin.*poison/i })
        .querySelector('.word-card-claimers'),
    ).not.toHaveTextContent(/\S/)
  })

  it.each([1, 2])(
    'keeps the host action disabled until the server permits advancement on turn %s',
    async (turnNumber) => {
      const user = userEvent.setup()
      const onAdvanceTurn = vi.fn().mockResolvedValue({ status: 'success' })
      const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
        status: 'guessing',
        turnId: '00000000-0000-4000-8000-000000000001',
        roomCode: 'bcdf2',
        player: hintingView.player,
        members: hintingView.members,
        turnNumber,
        totalTurns: 2,
        clueGiverId: 'player-2',
        clueGiverName: 'Grace',
        hint: 'Garden',
        hintNumber: 2,
        boardCompleted: false,
        board: [],
        turnPlayers: [],
        scoreboard: [],
        canGuess: false,
        canMarkDone: false,
        canAdvanceTurn: false,
      }
      const props = {
        onClaimCard: vi.fn(),
        onFinishGuessing: vi.fn(),
        onAdvanceTurn,
      }
      const { rerender } = render(<GuessingScreen view={view} {...props} />)
      const button = screen.getByRole('button', {
        name: turnNumber === 1 ? 'Next hint' : 'Finish the game',
      })
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(
        'Waiting for players to finish guessing.',
      )
      await user.click(button)
      expect(onAdvanceTurn).not.toHaveBeenCalled()
      rerender(
        <GuessingScreen view={{ ...view, canAdvanceTurn: true }} {...props} />,
      )
      expect(button).toBeEnabled()
      expect(button).toHaveAccessibleDescription(
        'Everyone has finished guessing. Advance when the room is ready.',
      )
      expect(onAdvanceTurn).not.toHaveBeenCalled()
      await user.click(button)
      expect(onAdvanceTurn).toHaveBeenCalledOnce()
      rerender(
        <GuessingScreen
          view={{ ...view, player: hintingView.members[1] }}
          {...props}
        />,
      )
      expect(
        screen.queryByRole('button', { name: /Next hint|Finish the game/ }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Host control')).not.toBeInTheDocument()
    },
  )

  it.each(['finish', 'advance'] as const)(
    'clears a stale error before a successful %s retry',
    async (command) => {
      const user = userEvent.setup()
      const action = vi
        .fn()
        .mockResolvedValueOnce({
          status: 'rate_limited',
          message: 'Try again shortly.',
        })
        .mockResolvedValueOnce({ status: 'success' })
      const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
        status: 'guessing',
        turnId: '00000000-0000-4000-8000-000000000001',
        roomCode: 'bcdf2',
        player: hintingView.player,
        members: hintingView.members,
        turnNumber: 1,
        totalTurns: 2,
        clueGiverId: 'player-2',
        clueGiverName: 'Grace',
        hint: 'Orbit',
        hintNumber: 2,
        boardCompleted: false,
        board: [],
        turnPlayers: [],
        scoreboard: [],
        canGuess: true,
        canMarkDone: command === 'finish',
        canAdvanceTurn: command === 'advance',
      }
      render(
        <GuessingScreen
          view={view}
          onClaimCard={vi.fn()}
          onFinishGuessing={action}
          onAdvanceTurn={action}
        />,
      )
      expect(screen.getByRole('heading', { name: 'Scorecard' })).toBeVisible()
      expect(screen.getByRole('main')).not.toHaveTextContent(
        /\b(?:timers?|rounds?)\b/i,
      )
      if (command === 'advance') {
        expect(
          screen.getByText(
            'Everyone has finished guessing. Advance when the room is ready.',
          ),
        ).toBeVisible()
      }
      const button = screen.getByRole('button', {
        name: command === 'finish' ? 'I’m done guessing' : 'Next hint',
      })
      await user.click(button)
      expect(await screen.findByText('Try again shortly.')).toBeInTheDocument()
      await user.click(button)
      expect(action).toHaveBeenCalledTimes(2)
      expect(screen.queryByText('Try again shortly.')).not.toBeInTheDocument()
    },
  )
})

describe('FinishedScreen', () => {
  it('shows point values only on claimed final-board cards', () => {
    const player = {
      playerId: 'player-1',
      name: 'Ada',
      role: 'host' as const,
      participation: 'player' as const,
      position: 0,
      score: 3,
    }
    const view: Extract<RoomSnapshot, { status: 'finished' }> = {
      status: 'finished',
      roomCode: 'bcdf2',
      player,
      members: [player],
      scoreboard: [player],
      winners: [player],
      lastClueGiverName: 'Ada',
      lastHint: 'orbit',
      lastHintNumber: 1,
      board: [
        {
          id: 'claimed-target',
          word: 'MOON',
          revealedKind: 'target',
          claimedBy: ['Ada'],
          selectedByYou: false,
          disabled: true,
        },
        {
          id: 'unclaimed-assassin',
          word: 'POISON',
          revealedKind: 'assassin',
          claimedBy: [],
          selectedByYou: false,
          disabled: true,
        },
      ],
    }

    render(<FinishedScreen view={view} />)

    const board = screen.getByLabelText('Fully revealed final board')
    expect(
      within(board).getByText('+3', { selector: '.word-card-score' }),
    ).toBeVisible()
    expect(within(board).queryByText('−5')).not.toBeInTheDocument()
    expect(within(board).getByText('ASSASSIN')).toBeVisible()
    expect(within(board).queryByText('Unselected')).not.toBeInTheDocument()
  })

  it.each([
    { scores: [100, 90, 80, 70, 60], places: [1, 2, 3, 4, 5] },
    { scores: [100, 100, 90], places: [1, 1, 2] },
    { scores: [100, 90, 90, 80], places: [1, 2, 2, 3] },
    { scores: [100, 100, 100], places: [1, 1, 1] },
  ])(
    'ranks final scores $scores consistently, including ties',
    ({ scores, places }) => {
      const scoreboard = scores.map((score, index) => ({
        playerId: `player-${index}`,
        name: `Player ${index}`,
        role: 'player' as const,
        participation: 'player' as const,
        position: index,
        score,
      }))
      const spectator = {
        playerId: 'spectator',
        name: 'Spectator',
        role: 'player' as const,
        participation: 'spectator' as const,
        position: null,
        score: null,
      }
      const view: Extract<RoomSnapshot, { status: 'finished' }> = {
        status: 'finished',
        roomCode: 'bcdf2',
        player: scoreboard[0],
        members: [...scoreboard, spectator],
        scoreboard: [spectator, ...scoreboard.toReversed()],
        winners: scoreboard.filter(({ score }) => score === scores[0]),
        lastClueGiverName: 'Player 0',
        lastHint: 'orbit',
        lastHintNumber: 2,
        board: [],
      }
      render(<FinishedScreen view={view} />)

      expect(screen.getByText('Game complete')).toBeVisible()
      expect(screen.getByRole('main')).not.toHaveTextContent(
        /\b(?:timers?|rounds?)\b/i,
      )
      const rows = within(screen.getByRole('list')).getAllByRole('listitem')
      expect(rows).toHaveLength(scores.length)
      rows.forEach((row, index) => {
        expect(
          within(row).getByText(String(scores[index]), {
            selector: '.score-value',
          }),
        ).toBeInTheDocument()
        const placeLabel =
          places[index] < 4
            ? `${['First', 'Second', 'Third'][places[index] - 1]} place`
            : `Place ${places[index]}`
        const placement = within(row).getByText(placeLabel, {
          exact: false,
          selector: '.score-placement',
        })
        expect(placement).toHaveTextContent(
          places[index] < 4
            ? `${['🥇', '🥈', '🥉'][places[index] - 1]} ${placeLabel}`
            : placeLabel,
        )
        expect(placement).toBeVisible()
        if (places[index] < 4) {
          expect(
            within(placement).getByText(['🥇', '🥈', '🥉'][places[index] - 1]),
          ).toHaveAttribute('aria-hidden', 'true')
        }
        if (places[index] === 1) expect(row).toHaveClass('score-row-winner')
        else expect(row).not.toHaveClass('score-row-winner')
      })
      expect(
        within(screen.getByRole('list')).queryByText('Spectator'),
      ).not.toBeInTheDocument()
    },
  )
})
