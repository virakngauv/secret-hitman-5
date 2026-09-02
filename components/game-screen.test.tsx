import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import { FinishedScreen, GuessingScreen, HintPhaseScreen } from './game-screen'

const hintingView: Extract<RoomSnapshot, { status: 'hinting' }> = {
  status: 'hinting',
  gameId: '10000000-0000-4000-8000-000000000001',
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
    {
      playerId: 'player-1',
      name: 'Ada',
      submitted: false,
      needsRevision: false,
      hint: null,
      hintNumber: null,
    },
    {
      playerId: 'player-2',
      name: 'Grace',
      submitted: false,
      needsRevision: false,
      hint: null,
      hintNumber: null,
    },
  ],
  allHintsSubmitted: false,
  hint: null,
  hintSubmitted: false,
  hintRejected: false,
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
  it('fits long words individually while allowing phrases to wrap naturally', () => {
    const words = [
      'TELESCOPE',
      'NEW YORK',
      'COUNTERREVOLUTIONARIES',
      'SNOWMAN',
      'GREAT BRITAIN',
      'WASHINGTON',
    ]
    const view = {
      ...hintingView,
      board: hintingView.board!.map((card, index) => ({
        ...card,
        word: words[index] ?? card.word,
      })),
    }

    render(
      <HintPhaseScreen
        view={view}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={vi.fn()}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    expect(screen.getByText('TELESCOPE')).toHaveClass(
      'word-card-word-single',
      'word-card-word-compact',
    )
    expect(screen.getByText('TELESCOPE')).not.toHaveClass(
      'word-card-word-break',
    )
    expect(screen.getByText('NEW YORK')).not.toHaveClass(
      'word-card-word-single',
      'word-card-word-compact',
    )
    expect(screen.getByText('COUNTERREVOLUTIONARIES')).toHaveClass(
      'word-card-word-compact',
      'word-card-word-wide',
      'word-card-word-break',
    )
    expect(screen.getByText('SNOWMAN')).toHaveClass(
      'word-card-word-single',
      'word-card-word-compact',
    )
    expect(screen.getByText('GREAT BRITAIN')).not.toHaveClass(
      'word-card-word-compact',
    )
    expect(screen.getByText('WASHINGTON')).toHaveClass(
      'word-card-word-single',
      'word-card-word-compact',
      'word-card-word-wide',
    )
  })

  it('shows the score beside every clue-board role and state', async () => {
    const user = userEvent.setup()
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={vi.fn()}
        onLeave={vi.fn()}
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
      onRejectHint: vi.fn(),
      onRemovePlayer: vi.fn(),
      onLeave: vi.fn(),
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
        onRejectHint={vi.fn()}
        onRemovePlayer={vi.fn()}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn().mockResolvedValue({ status: 'success' })}
      />,
    )

    expect(screen.getByText(/review clues as they arrive/i)).toBeVisible()
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

  it('derives reversible civilians at five targets and restores them below the cap', async () => {
    const user = userEvent.setup()
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={vi.fn()}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )
    const editableIds = hintingView
      .board!.filter(({ locked }) => !locked)
      .map(({ id }) => id)
    const editableCard = (id: string) =>
      document.querySelector<HTMLButtonElement>(`button[data-card-id="${id}"]`)!
    for (const id of editableIds.slice(0, 4)) {
      await user.click(editableCard(id))
    }
    expect(screen.getAllByRole('button', { name: /available/i })).toHaveLength(
      4,
    )
    await user.click(editableCard(editableIds[4]!))
    expect(
      screen.getByText('5', { selector: '.hint-number-value' }),
    ).toBeVisible()
    const derived = screen.getAllByRole('button', {
      name: /civilian −1.*reversible when a target is deselected/i,
    })
    expect(derived).toHaveLength(3)
    for (const card of derived) {
      expect(card).toBeDisabled()
      expect(card).toHaveAttribute('data-card-derived-civilian', 'true')
      expect(card).toHaveAttribute('data-card-kind', 'civilian')
      expect(card).toHaveClass('word-card-civilian')
      expect(card.querySelector('.word-card-index')).toHaveTextContent(
        'Civilian',
      )
      expect(card.querySelector('.word-card-lock')).not.toBeInTheDocument()
    }
    const lockedCivilians = screen.getAllByRole('button', {
      name: /civilian −1.*locked/i,
    })
    expect(lockedCivilians).toHaveLength(3)
    for (const card of lockedCivilians) {
      expect(card).toHaveClass('word-card-civilian')
      expect(card.querySelector('.word-card-lock')).toBeVisible()
    }

    const selected = editableCard(editableIds[0]!)
    expect(selected).toBeEnabled()
    await user.click(selected)
    expect(
      screen.getByText('4', { selector: '.hint-number-value' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', {
        name: /reversible when a target is deselected/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /available −1/i }),
    ).toHaveLength(4)

    await user.click(editableCard(editableIds[5]!))
    expect(
      screen.getAllByRole('button', {
        name: /civilian −1.*reversible when a target is deselected/i,
      }),
    ).toHaveLength(3)
  })

  it('reconstructs max-target civilians through submit, unlock, and reconnect', async () => {
    const user = userEvent.setup()
    const targetIds = hintingView
      .board!.filter(({ locked }) => !locked)
      .slice(0, 5)
      .map(({ id }) => id)
    const submittedBoard = hintingView.board!.map((card) =>
      card.locked
        ? card
        : {
            ...card,
            kind: targetIds.includes(card.id)
              ? ('target' as const)
              : ('civilian' as const),
          },
    )
    const submittedView = {
      ...hintingView,
      hint: 'Orbit',
      hintSubmitted: true,
      board: submittedBoard,
    }
    const props = {
      onSubmitHint: vi.fn(),
      onUnlockHint: vi.fn().mockResolvedValue({ status: 'success' }),
      onRejectHint: vi.fn(),
      onRemovePlayer: vi.fn(),
      onLeave: vi.fn(),
      onStartGuessing: vi.fn(),
    }
    const view = render(<HintPhaseScreen view={submittedView} {...props} />)

    expect(screen.getAllByRole('button', { name: /target \+3/i })).toHaveLength(
      5,
    )
    expect(
      screen.getAllByRole('button', {
        name: /civilian −1.*reversible when a target is deselected/i,
      }),
    ).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Unlock / Edit hint' }))
    expect(props.onUnlockHint).toHaveBeenCalledOnce()

    const unlockedView = {
      ...submittedView,
      hintSubmitted: false,
      board: submittedBoard.map((card) =>
        !card.locked && card.kind === 'civilian'
          ? { ...card, kind: 'neutral' as const }
          : card,
      ),
    }
    view.rerender(<HintPhaseScreen view={unlockedView} {...props} />)
    const firstTarget = document.querySelector<HTMLButtonElement>(
      `button[data-card-id="${targetIds[0]}"]`,
    )!
    expect(firstTarget).toBeEnabled()
    await user.click(firstTarget)
    expect(
      screen.getAllByRole('button', { name: /available −1/i }),
    ).toHaveLength(4)

    view.unmount()
    render(<HintPhaseScreen view={unlockedView} {...props} />)
    expect(
      screen.getAllByRole('button', {
        name: /civilian −1.*reversible when a target is deselected/i,
      }),
    ).toHaveLength(3)
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
      onRejectHint: vi.fn(),
      onRemovePlayer: vi.fn(),
      onLeave: vi.fn(),
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

  it('reveals submitted clues and lets the host reject one before everyone is ready', async () => {
    const user = userEvent.setup()
    const onRejectHint = vi.fn().mockResolvedValue({ status: 'success' })
    const view = {
      ...hintingView,
      allHintsSubmitted: false,
      hint: 'Orbit',
      hintSubmitted: true,
      members: [
        ...hintingView.members,
        {
          playerId: 'player-3',
          name: 'Linus',
          role: 'player' as const,
          participation: 'player' as const,
        },
      ],
      hintStatuses: [
        {
          ...hintingView.hintStatuses[0],
          submitted: true,
          hint: 'Orbit',
          hintNumber: 2,
        },
        {
          ...hintingView.hintStatuses[1],
          submitted: true,
          hint: 'New York',
          hintNumber: 3,
        },
        {
          playerId: 'player-3',
          name: 'Linus',
          submitted: false,
          needsRevision: false,
          hint: null,
          hintNumber: null,
        },
      ],
    }

    render(
      <HintPhaseScreen
        view={view}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={onRejectHint}
        onRemovePlayer={vi.fn()}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    expect(screen.getByLabelText("Ada's hint: Orbit, 2")).toBeVisible()
    expect(screen.getByLabelText("Grace's hint: New York, 3")).toBeVisible()
    expect(screen.getByText('2/3')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Start guessing' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: "Reject Ada's hint" }),
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: "Reject Grace's hint" }),
    )
    expect(onRejectHint).toHaveBeenCalledWith('player-2')
  })

  it('warns that removing the only other player resets the round', async () => {
    const user = userEvent.setup()
    const onRemovePlayer = vi.fn().mockResolvedValue({ status: 'success' })
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={onRemovePlayer}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    const remove = screen.getByRole('button', {
      name: 'Remove Grace from this game',
    })
    await user.click(remove)
    const dialog = screen.getByRole('alertdialog', {
      name: 'Remove Grace from this game?',
    })
    expect(dialog).toHaveTextContent(
      /fewer than two players.*end the current round.*return everyone else to the lobby.*boards, hints, readiness, scores, and turns.*not be able to rejoin/i,
    )
    expect(onRemovePlayer).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(remove)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemovePlayer).toHaveBeenCalledWith('player-2', true)
  })

  it('keeps focus trapped in a removal dialog while its action is busy', async () => {
    const user = userEvent.setup()
    let finishRemoval!: (result: { status: 'success' }) => void
    const onRemovePlayer = vi.fn(
      () =>
        new Promise<{ status: 'success' }>((resolve) => {
          finishRemoval = resolve
        }),
    )
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={onRemovePlayer}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Remove Grace from this game' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveFocus()

    await user.tab()
    expect(dialog).toHaveFocus()

    finishRemoval({ status: 'success' })
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
  })

  it('uses the ordinary removal warning when the round keeps two players', async () => {
    const user = userEvent.setup()
    const onRemovePlayer = vi.fn().mockResolvedValue({ status: 'success' })
    const thirdPlayerView = {
      ...hintingView,
      members: [
        ...hintingView.members,
        {
          playerId: 'player-3',
          name: 'Linus',
          role: 'player' as const,
          participation: 'player' as const,
        },
      ],
      hintStatuses: [
        ...hintingView.hintStatuses,
        {
          playerId: 'player-3',
          name: 'Linus',
          submitted: false,
          needsRevision: false,
          hint: null,
          hintNumber: null,
        },
      ],
    }

    render(
      <HintPhaseScreen
        view={thirdPlayerView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={onRemovePlayer}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Remove Grace from this game' }),
    )
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      /board, submitted hint, readiness, and remaining turn.*not be able to rejoin/i,
    )
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemovePlayer).toHaveBeenCalledWith('player-2', false)
  })

  it('keeps a failed hinting removal open with its error visible', async () => {
    const user = userEvent.setup()
    const onRemovePlayer = vi.fn().mockResolvedValue({
      status: 'rate_limited',
      message: 'Try removing this player again shortly.',
    })
    render(
      <HintPhaseScreen
        view={hintingView}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={onRemovePlayer}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Remove Grace from this game' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Try removing this player again shortly.',
    )
  })

  it('clears the rejected clue when the server replaces its private board', async () => {
    const user = userEvent.setup()
    const lockedBoard = hintingView.board!.map((card, index) =>
      card.locked
        ? card
        : {
            ...card,
            kind: index < 2 ? ('target' as const) : ('civilian' as const),
          },
    )
    const props = {
      onSubmitHint: vi.fn(),
      onUnlockHint: vi.fn(),
      onRejectHint: vi.fn(),
      onRemovePlayer: vi.fn(),
      onLeave: vi.fn(),
      onStartGuessing: vi.fn(),
    }
    const view = render(
      <HintPhaseScreen
        key="p0-card-0"
        view={{
          ...hintingView,
          hint: 'Orbit',
          hintSubmitted: true,
          board: lockedBoard,
        }}
        {...props}
      />,
    )
    expect(screen.getByLabelText('Your hint')).toHaveValue('Orbit')

    const replacementBoard = hintingView.board!.map((card) => ({
      ...card,
      id: card.id.replace('p0-', 'p2-'),
      word: `NEW ${card.word}`,
    }))
    view.rerender(
      <HintPhaseScreen
        key="p2-card-0"
        view={{
          ...hintingView,
          hint: null,
          hintRejected: true,
          board: replacementBoard,
          hintStatuses: hintingView.hintStatuses.map((status) =>
            status.playerId === hintingView.player.playerId
              ? { ...status, needsRevision: true }
              : status,
          ),
        }}
        {...props}
      />,
    )

    expect(
      screen.getByText(
        'The host rejected this hint. Your board was refreshed; create and lock in a new hint.',
      ),
    ).toBeVisible()
    expect(screen.getByText('Needs revision')).toBeVisible()
    const rejectionDialog = screen.getByRole('alertdialog', {
      name: 'Your hint was rejected',
    })
    expect(rejectionDialog).toHaveTextContent(
      "The host rejected your hint! You've been given a new board. If you're not sure why your hint was rejected, ask the host!",
    )
    expect(
      within(rejectionDialog).getByRole('button', { name: 'Got it' }),
    ).toHaveFocus()
    await user.click(
      within(rejectionDialog).getByRole('button', { name: 'Got it' }),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Your hint')).toHaveValue('')
    expect(screen.getByLabelText('Your hint')).not.toHaveAttribute('readonly')
    expect(screen.getByText('NEW MOON')).toBeVisible()
  })

  it('reopens the rejection dialog for a later rejection cycle', async () => {
    const user = userEvent.setup()
    const props = {
      onSubmitHint: vi.fn(),
      onUnlockHint: vi.fn(),
      onRejectHint: vi.fn(),
      onRemovePlayer: vi.fn(),
      onLeave: vi.fn(),
      onStartGuessing: vi.fn(),
    }
    const view = render(<HintPhaseScreen view={hintingView} {...props} />)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    view.rerender(
      <HintPhaseScreen
        view={{ ...hintingView, hintRejected: true }}
        {...props}
      />,
    )

    expect(
      screen.getByRole('alertdialog', { name: 'Your hint was rejected' }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    view.rerender(<HintPhaseScreen view={hintingView} {...props} />)
    view.rerender(
      <HintPhaseScreen
        view={{ ...hintingView, hintRejected: true }}
        {...props}
      />,
    )

    expect(
      screen.getByRole('alertdialog', { name: 'Your hint was rejected' }),
    ).toBeVisible()
  })
})

describe('GuessingScreen messages', () => {
  it('hides latest activity and explains inherited spectator host controls', () => {
    const spectatorHost = {
      playerId: 'spectator-1',
      name: 'Linus',
      role: 'host' as const,
      participation: 'spectator' as const,
    }
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      gameId: hintingView.gameId,
      turnId: '00000000-0000-4000-8000-000000000001',
      roomCode: 'bcdf2',
      player: spectatorHost,
      members: [spectatorHost, ...hintingView.members],
      turnNumber: 1,
      totalTurns: 2,
      clueGiverId: 'player-1',
      clueGiverName: 'Ada',
      hint: 'Orbit',
      hintNumber: 2,
      boardCompleted: false,
      turnSettled: false,
      board: [],
      turnPlayers: [],
      latestActivity: {
        type: 'civilian',
        playerName: 'Grace',
        word: 'RIVER',
        message:
          'Grace found civilian “RIVER” and is done guessing. Waiting for the other players to finish guessing.',
      },
      unfinishedPickerCount: 1,
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
        onRemovePlayer={vi.fn()}
        onAdvanceTurn={vi.fn()}
      />,
    )

    expect(screen.queryByText('Latest activity')).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('Latest turn activity'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/inherited operational host duties/i),
    ).toHaveTextContent(
      /spectator privacy and player-only actions remain unchanged/i,
    )
    expect(screen.getByRole('button', { name: 'Next hint' })).toBeEnabled()
  })

  it('lets the host remove a guesser while promising to preserve game history', async () => {
    const user = userEvent.setup()
    const onRemovePlayer = vi.fn().mockResolvedValue({ status: 'success' })
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      gameId: '10000000-0000-4000-8000-000000000001',
      turnId: '00000000-0000-4000-8000-000000000001',
      roomCode: 'bcdf2',
      player: hintingView.player,
      members: hintingView.members,
      turnNumber: 1,
      totalTurns: 2,
      clueGiverId: 'player-1',
      clueGiverName: 'Ada',
      hint: 'Orbit',
      hintNumber: 2,
      boardCompleted: false,
      turnSettled: false,
      board: [],
      turnPlayers: [
        { playerId: 'player-1', name: 'Ada', state: 'clue-giver' },
        { playerId: 'player-2', name: 'Grace', state: 'guessing' },
      ],
      scoreboard: [
        { ...hintingView.members[0], position: 0, score: 3 },
        { ...hintingView.members[1], position: 1, score: 1 },
      ],
      canGuess: false,
      canMarkDone: false,
      canAdvanceTurn: false,
    }
    const props = {
      onClaimCard: vi.fn(),
      onFinishGuessing: vi.fn(),
      onRemovePlayer,
      onAdvanceTurn: vi.fn().mockResolvedValue({
        status: 'invalid',
        message: 'Target found. You and the clue-giver each gain 3 points.',
      }),
    }
    const rendered = render(
      <GuessingScreen view={{ ...view, canAdvanceTurn: true }} {...props} />,
    )

    expect(
      screen.queryByRole('button', { name: 'Remove Ada from this game' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next hint' }))
    expect(
      screen.getByText(
        'Target found. You and the clue-giver each gain 3 points.',
      ),
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Remove Grace from this game' }),
    )
    const removalDialog = screen.getByRole('alertdialog')
    expect(removalDialog).toHaveTextContent(
      /no longer be able to guess or rejoin.*score and name will be removed.*points already earned by other players and completed game history will remain.*submitted hint and board will be skipped/i,
    )
    expect(removalDialog).not.toHaveTextContent(/target found/i)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemovePlayer).toHaveBeenCalledWith('player-2')

    rendered.rerender(
      <GuessingScreen
        view={{
          ...view,
          members: [hintingView.members[0]],
          scoreboard: view.scoreboard.filter(({ name }) => name !== 'Grace'),
          canAdvanceTurn: true,
        }}
        {...props}
      />,
    )
    expect(screen.queryByText('No longer active')).not.toBeInTheDocument()
    expect(screen.queryByText('Grace')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove Grace from this game' }),
    ).not.toBeInTheDocument()
  })

  it('keeps a failed guessing removal open with its error visible', async () => {
    const user = userEvent.setup()
    const onRemovePlayer = vi.fn().mockResolvedValue({
      status: 'rate_limited',
      message: 'Try removing this player again shortly.',
    })
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      gameId: '10000000-0000-4000-8000-000000000001',
      turnId: '00000000-0000-4000-8000-000000000001',
      roomCode: 'bcdf2',
      player: hintingView.player,
      members: hintingView.members,
      turnNumber: 1,
      totalTurns: 2,
      clueGiverId: 'player-1',
      clueGiverName: 'Ada',
      hint: 'Orbit',
      hintNumber: 2,
      boardCompleted: false,
      turnSettled: false,
      board: [],
      turnPlayers: [],
      scoreboard: [
        { ...hintingView.members[0], position: 0, score: 0 },
        { ...hintingView.members[1], position: 1, score: 0 },
      ],
      canGuess: false,
      canMarkDone: false,
      canAdvanceTurn: false,
    }
    render(
      <GuessingScreen
        view={view}
        onClaimCard={vi.fn()}
        onFinishGuessing={vi.fn()}
        onRemovePlayer={onRemovePlayer}
        onAdvanceTurn={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Remove Grace from this game' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Try removing this player again shortly.',
    )
  })

  it('shows scores for claimed cards without exposing unclaimed values', () => {
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      gameId: hintingView.gameId,
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
      turnSettled: false,
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
        onRemovePlayer={vi.fn()}
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

    for (const { role, name } of [
      { role: 'target', name: 'Ada' },
      { role: 'civilian', name: 'Grace' },
      { role: 'assassin', name: 'Grace' },
    ]) {
      const card = screen.getByRole('button', {
        name: new RegExp(`${role}.*selected by ${name}`, 'i'),
      })
      const attribution = within(card).getByText(name, {
        selector: '.word-card-picker-attribution',
      })
      expect(attribution).toHaveClass('word-card-picker-attribution')
      expect(attribution).toHaveTextContent(name)
      expect(within(attribution).getByText('Selected by')).toHaveClass(
        'sr-only',
      )
    }
  })

  it('identifies accepted picks without labeling untouched cards', () => {
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      gameId: hintingView.gameId,
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
      boardCompleted: false,
      turnSettled: true,
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
        onRemovePlayer={vi.fn()}
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

  it('does not describe the clue-giver private board as completed while the turn is active', () => {
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      gameId: hintingView.gameId,
      turnId: '00000000-0000-4000-8000-000000000001',
      roomCode: 'bcdf2',
      player: hintingView.members[1],
      members: hintingView.members,
      turnNumber: 1,
      totalTurns: 2,
      clueGiverId: 'player-2',
      clueGiverName: 'Grace',
      hint: 'Orbit',
      hintNumber: 1,
      boardCompleted: false,
      turnSettled: false,
      board: [
        {
          id: 'target',
          word: 'MOON',
          revealedKind: 'target',
          claimedBy: [],
          selectedByYou: false,
          disabled: true,
        },
        {
          id: 'assassin',
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
      canAdvanceTurn: false,
    }

    render(
      <GuessingScreen
        view={view}
        onClaimCard={vi.fn()}
        onFinishGuessing={vi.fn()}
        onRemovePlayer={vi.fn()}
        onAdvanceTurn={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Fully revealed board')).toBeVisible()
    expect(
      screen.queryByLabelText('Completed and fully revealed board'),
    ).not.toBeInTheDocument()
  })

  it.each([1, 2])(
    'warns but lets the host move on with unfinished players on turn %s',
    async (turnNumber) => {
      const user = userEvent.setup()
      const onAdvanceTurn = vi.fn().mockResolvedValue({ status: 'success' })
      const onShowScoreboard = vi.fn().mockResolvedValue({ status: 'success' })
      const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
        status: 'guessing',
        gameId: hintingView.gameId,
        turnId: '00000000-0000-4000-8000-000000000001',
        roomCode: 'bcdf2',
        player: hintingView.player,
        members: hintingView.members,
        turnNumber,
        isFinalTurn: turnNumber === 2,
        totalTurns: 2,
        clueGiverId: 'player-2',
        clueGiverName: 'Grace',
        hint: 'Garden',
        hintNumber: 2,
        boardCompleted: false,
        turnSettled: false,
        board: [],
        turnPlayers: [],
        scoreboard: [],
        canGuess: false,
        canMarkDone: false,
        canAdvanceTurn: turnNumber === 1,
        canViewScoreboard: turnNumber === 2,
        unfinishedPickerCount: 1,
      }
      const props = {
        onClaimCard: vi.fn(),
        onFinishGuessing: vi.fn(),
        onRemovePlayer: vi.fn(),
        onAdvanceTurn,
        onShowScoreboard,
      }
      const { rerender } = render(<GuessingScreen view={view} {...props} />)
      const button = screen.getByRole('button', {
        name: turnNumber === 1 ? 'Next hint' : 'View scoreboard',
      })
      expect(button).toBeEnabled()
      expect(button).toHaveAccessibleDescription(
        '1 player is still guessing. You can move on with confirmation.',
      )
      await user.click(button)
      expect(onAdvanceTurn).not.toHaveBeenCalled()
      const dialog = screen.getByRole('alertdialog', {
        name: 'Move on from this board?',
      })
      expect(dialog).toHaveTextContent(
        '1 player is still guessing. Are you sure you want to move on?',
      )
      expect(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      ).toHaveFocus()
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(onAdvanceTurn).not.toHaveBeenCalled()
      await user.click(button)
      await user.click(screen.getByRole('button', { name: 'Move on' }))
      if (turnNumber === 1) expect(onAdvanceTurn).toHaveBeenCalledOnce()
      else expect(onShowScoreboard).toHaveBeenCalledOnce()
      rerender(
        <GuessingScreen
          view={{ ...view, player: hintingView.members[1] }}
          {...props}
        />,
      )
      expect(
        screen.queryByRole('button', { name: /Next hint|View scoreboard/ }),
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
        gameId: hintingView.gameId,
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
        turnSettled: false,
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
          onRemovePlayer={vi.fn()}
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
  it('shows board-free results and lets only the host return to the lobby', async () => {
    const user = userEvent.setup()
    const onReturnToLobby = vi.fn().mockResolvedValue({ status: 'success' })
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
      gameId: hintingView.gameId,
      roomCode: 'bcdf2',
      player,
      members: [player],
      scoreboard: [player],
      winners: [player],
    }

    const rendered = render(
      <FinishedScreen view={view} onReturnToLobby={onReturnToLobby} />,
    )

    expect(screen.queryByLabelText(/board/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Return to lobby' }))
    expect(onReturnToLobby).toHaveBeenCalledOnce()

    rendered.rerender(
      <FinishedScreen
        view={{
          ...view,
          player: { ...player, role: 'player' },
          members: [{ ...player, role: 'player' }],
        }}
        onReturnToLobby={onReturnToLobby}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Return to lobby' })).toBeNull()
    expect(screen.getByText(/host can return everyone/i)).toBeVisible()
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
        gameId: hintingView.gameId,
        roomCode: 'bcdf2',
        player: scoreboard[0],
        members: [...scoreboard, spectator],
        scoreboard: [spectator, ...scoreboard.toReversed()],
        winners: scoreboard.filter(({ score }) => score === scores[0]),
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
