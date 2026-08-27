import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import { FinishedScreen, HintPhaseScreen } from './game-screen'

const hintingView: Extract<RoomSnapshot, { status: 'hinting' }> = {
  status: 'hinting',
  roomCode: 'bcdf2',
  revision: 3,
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
    { id: 'p0-card-0', word: 'MOON', kind: 'neutral' },
    { id: 'p0-card-1', word: 'SATELLITE', kind: 'neutral' },
    { id: 'p0-card-2', word: 'POISON', kind: 'assassin' },
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `p0-card-${index + 3}`,
      word: `WORD ${index + 1}`,
      kind: 'neutral' as const,
    })),
  ],
}

describe('HintPhaseScreen', () => {
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
      screen.getByText('2', { selector: '.hint-number-value' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lock in hint · 2' }))

    expect(onSubmitHint).toHaveBeenCalledWith('orbit', [
      'p0-card-0',
      'p0-card-1',
    ])
  })
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
        revision: 20,
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
