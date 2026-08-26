import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import { HintPhaseScreen } from './game-screen'

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
