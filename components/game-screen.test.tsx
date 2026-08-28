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
  hintSubmitted: false,
  board: [
    { id: 'p0-card-0', word: 'MOON', kind: 'neutral', locked: false },
    { id: 'p0-card-1', word: 'SATELLITE', kind: 'neutral', locked: false },
    { id: 'p0-card-2', word: 'POISON', kind: 'assassin', locked: true },
    { id: 'p0-card-3', word: 'ROCKET', kind: 'target', locked: true },
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
  it('keeps all fixed roles disabled, counts the fixed target after remount, and leaves neutral cards editable', async () => {
    const user = userEvent.setup()
    const onSubmitHint = vi.fn().mockResolvedValue({ status: 'success' })
    const props = { view: hintingView, onSubmitHint, onStartGuessing: vi.fn() }
    const first = render(<HintPhaseScreen {...props} />)
    for (const name of [
      /target.*locked.*rocket/i,
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
      screen.getByText('2', { selector: '.hint-number-value' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /target.*moon/i }))
    expect(
      screen.getByText('1', { selector: '.hint-number-value' }),
    ).toBeInTheDocument()
    first.unmount()
    render(<HintPhaseScreen {...props} />)
    expect(
      screen.getByRole('button', { name: /target.*locked.*rocket/i }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.type(screen.getByLabelText('Your hint'), 'space')
    await user.click(screen.getByRole('button', { name: 'Lock in hint · 1' }))
    expect(onSubmitHint).toHaveBeenCalledWith('space', ['p0-card-3'])
  })

  it('auto-counts selected cards, freezes the assassin, and submits the derived targets', async () => {
    const user = userEvent.setup()
    const onSubmitHint = vi.fn().mockResolvedValue({ status: 'success' })
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={onSubmitHint}
        onStartGuessing={vi.fn().mockResolvedValue({ status: 'success' })}
      />,
    )

    const assassin = screen.getByRole('button', { name: /assassin.*poison/i })
    expect(assassin).toBeDisabled()
    await user.type(screen.getByLabelText('Your hint'), 'orbit')
    await user.click(screen.getByRole('button', { name: /available.*moon/i }))
    await user.click(
      screen.getByRole('button', { name: /available.*satellite/i }),
    )
    expect(
      screen.getByText('3', { selector: '.hint-number-value' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lock in hint · 3' }))

    expect(onSubmitHint).toHaveBeenCalledWith('orbit', [
      'p0-card-0',
      'p0-card-1',
      'p0-card-3',
    ])
  })
})

describe('GuessingScreen messages', () => {
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
  it.each([
    { scores: [8, 8, 5, 5, 1], places: [1, 1, 3, 3, 5] },
    { scores: [8, 5, 1], places: [1, 2, 3] },
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

      const rows = within(screen.getByRole('list')).getAllByRole('listitem')
      expect(rows).toHaveLength(scores.length)
      rows.forEach((row, index) => {
        expect(
          within(row).getByText(String(scores[index]), {
            selector: '.score-value',
          }),
        ).toBeInTheDocument()
        expect(
          within(row).getByText(
            places[index] === 1 ? 'Top score' : `Place ${places[index]}`,
          ),
        ).toBeInTheDocument()
        if (places[index] === 1) expect(row).toHaveClass('score-row-winner')
        else expect(row).not.toHaveClass('score-row-winner')
      })
      expect(
        within(screen.getByRole('list')).queryByText('Spectator'),
      ).not.toBeInTheDocument()
    },
  )
})
