import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RoomSnapshot } from '@/lib/game-protocol'

import {
  FinishedScreen,
  GuessingScreen,
  HintPhaseScreen,
  pickHintPlaceholder,
} from './game-screen'

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
  it('starts with the playable hint controls instead of room chrome or phase copy', () => {
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

    expect(screen.getByLabelText('Your hint')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveClass(
      'h-10',
      'w-auto',
      'justify-self-end',
      'px-5',
    )
    expect(screen.getByLabelText('Hint submission prompt')).toHaveTextContent(
      'Select 1-5 targets. Type your hint. Submit.',
    )
    expect(
      screen.queryByText('Select one to five words this hint should point to.'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'You can change your hint and targets until you submit.',
      ),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('SECRET HITMAN')).not.toBeInTheDocument()
    expect(screen.queryByText(/Phase 1/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Build one clue/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave room' })).toHaveClass(
      'mt-0',
    )
  })

  it('does not add instructional copy beneath a non-host roster', () => {
    render(
      <HintPhaseScreen
        view={{ ...hintingView, player: hintingView.members[1] }}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn()}
        onRemovePlayer={vi.fn()}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn()}
      />,
    )

    expect(
      screen.queryByText(/Submitted clues appear here/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/host will start guessing/i),
    ).not.toBeInTheDocument()
  })

  it('fits long words individually while allowing phrases to wrap naturally', () => {
    const words = [
      'TELESCOPE',
      'NEW YORK',
      'COUNTERREVOLUTIONARIES',
      'SNOWMAN',
      'GREAT BRITAIN',
      'WASHINGTON',
      'BEAR',
      'MAMMOTH',
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

    expect(screen.getByText('TELESCOPE')).toHaveClass('word-card-word-single')
    expect(screen.getByText('TELESCOPE')).toHaveClass('word-card-word-compact')
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
    expect(screen.getByText('SNOWMAN')).toHaveClass('word-card-word-single')
    expect(screen.getByText('SNOWMAN')).not.toHaveClass(
      'word-card-word-compact',
    )
    expect(screen.getByText('GREAT BRITAIN')).not.toHaveClass(
      'word-card-word-compact',
    )
    expect(screen.getByText('WASHINGTON')).toHaveClass(
      'word-card-word-single',
      'word-card-word-compact',
    )
    expect(screen.getByText('WASHINGTON')).not.toHaveClass(
      'word-card-word-wide',
    )
    expect(screen.getByText('BEAR')).not.toHaveClass('word-card-word-compact')
    expect(screen.getByText('MAMMOTH')).not.toHaveClass(
      'word-card-word-compact',
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
      screen.getByRole('button', { name: /target.*moon/i }),
    ).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /target.*moon/i }))
    expect(
      screen.getByRole('button', { name: /available.*moon/i }),
    ).toHaveAttribute('aria-pressed', 'false')
    first.unmount()
    render(<HintPhaseScreen {...props} />)
    expect(
      screen.getByRole('button', { name: /civilian.*locked.*rocket/i }),
    ).toHaveAttribute('aria-pressed', 'false')
    await user.type(screen.getByLabelText('Your hint'), 'space')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /available.*moon/i }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmitHint).toHaveBeenCalledWith('SPACE', ['p0-card-0'])
  })

  it('submits the hint when pressing enter in the hint field', async () => {
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

    const input = screen.getByLabelText('Your hint')
    await user.type(input, 'orbit')
    await user.type(input, '{Enter}')
    expect(onSubmitHint).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /available.*moon/i }))
    await user.type(input, '{Enter}')
    expect(onSubmitHint).toHaveBeenCalledWith('ORBIT', ['p0-card-0'])
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

    expect(
      screen.queryByText(/review clues as they arrive/i),
    ).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('Hint submission prompt')).toHaveTextContent(
      'Select 1-5 targets. Type your hint. Submit.',
    )
    expect(screen.queryByText('orbit 2')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmitHint).toHaveBeenCalledWith('ORBIT', [
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
    expect(screen.getAllByRole('button', { name: /target \+3/i })).toHaveLength(
      5,
    )
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
    expect(screen.getAllByRole('button', { name: /target \+3/i })).toHaveLength(
      4,
    )
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
    await user.click(screen.getByRole('button', { name: 'Edit' }))
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
    expect(screen.getByLabelText('Your hint')).toBeDisabled()
    expect(screen.getByLabelText('Submitted hint')).toHaveTextContent('Orbit 2')
    expect(
      screen.queryByText(
        'Hint submitted. Your board and targets stay private until your turn.',
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Hint submitted. Select Edit to make changes.'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /target.*moon/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /target.*satellite/i }),
    ).toBeDisabled()
    expect(screen.getByText('1/2')).toBeVisible()

    const editButton = screen.getByRole('button', { name: 'Edit' })
    expect(editButton).toHaveClass('h-10', 'w-auto')
    await user.click(editButton)
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
    expect(hintInput).toBeEnabled()
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
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmitHint).toHaveBeenCalledWith('GALAXY', [
      'p0-card-1',
      'p0-card-6',
    ])
  })

  it('shows submission and edit failures beside the hint controls', async () => {
    const user = userEvent.setup()
    const props = {
      onSubmitHint: vi.fn().mockResolvedValue({
        status: 'stale_state',
        message: 'Your board changed. Review it and submit again.',
      }),
      onUnlockHint: vi.fn().mockResolvedValue({
        status: 'invalid_phase',
        message: 'This hint can no longer be edited.',
      }),
      onRejectHint: vi.fn(),
      onRemovePlayer: vi.fn(),
      onLeave: vi.fn(),
      onStartGuessing: vi.fn(),
    }
    const rendered = render(<HintPhaseScreen view={hintingView} {...props} />)

    await user.type(screen.getByLabelText('Your hint'), 'Orbit')
    await user.click(screen.getByRole('button', { name: /available.*moon/i }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    const hintControls = screen.getByRole('region', { name: 'Hint controls' })
    expect(within(hintControls).getByRole('alert')).toHaveTextContent(
      'Your board changed. Review it and submit again.',
    )
    expect(
      within(screen.getByRole('region', { name: 'Host controls' })).queryByText(
        'Your board changed. Review it and submit again.',
      ),
    ).not.toBeInTheDocument()

    rendered.rerender(
      <HintPhaseScreen
        view={{ ...hintingView, hint: 'Orbit', hintSubmitted: true }}
        {...props}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(within(hintControls).getByRole('alert')).toHaveTextContent(
      'This hint can no longer be edited.',
    )
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

    expect(screen.getByText('2/3')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Start guessing' }),
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: "Reject Ada's hint" }),
    ).not.toBeInTheDocument()
    const roster = screen.getByRole('list', { name: 'Roster' })
    const hostControls = screen.getByRole('region', { name: 'Host controls' })
    expect(within(roster).getByLabelText("Ada's hint: Orbit, 2")).toBeVisible()
    expect(
      within(roster).getByLabelText("Grace's hint: New York, 3"),
    ).toBeVisible()
    expect(
      within(hostControls).getByLabelText("Grace's hint: New York, 3"),
    ).toBeVisible()
    expect(
      within(hostControls).queryByText(
        'Review clues as they arrive, reject any that need revision, or start guessing once everyone is ready.',
      ),
    ).not.toBeInTheDocument()
    expect(roster.closest('.game-panel')).not.toBe(hostControls)
    expect(hostControls).toHaveClass('game-panel')
    expect(within(roster).queryByRole('button')).not.toBeInTheDocument()
    expect(
      within(hostControls).getByRole('button', {
        name: "Reject Grace's hint",
      }),
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: "Reject Grace's hint" }),
    )
    expect(onRejectHint).toHaveBeenCalledWith('player-2')
  })

  it('keeps long names and hints inside a horizontally scrollable roster card', () => {
    const longName = 'Grace Hopper With An Exceptionally Long Display Name'
    const longHint =
      'A surprisingly elaborate hint that must not widen the page'
    const spectator = {
      playerId: 'spectator-1',
      name: 'Spectator With A Very Long Name',
      role: 'player' as const,
      participation: 'spectator' as const,
    }
    const view = {
      ...hintingView,
      members: [
        hintingView.members[0],
        { ...hintingView.members[1], name: longName },
        spectator,
      ],
      hintStatuses: hintingView.hintStatuses.map((status) =>
        status.playerId === 'player-2'
          ? {
              ...status,
              name: longName,
              submitted: true,
              hint: longHint,
              hintNumber: 5,
            }
          : status,
      ),
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

    const roster = screen.getByRole('list', { name: 'Roster' })
    expect(roster).toHaveClass('roster-scroll')
    const primary = within(roster).getByTitle(`${longName} · ${longHint} 5`)
    expect(primary.querySelector('.roster-card-name')).toHaveTextContent(
      longName,
    )
    expect(primary.querySelector('.roster-card-detail')).toHaveTextContent(
      longHint,
    )
    expect(primary.querySelector('.roster-card-suffix')).toHaveTextContent('5')
    const spectatorCard = within(roster)
      .getByText(spectator.name)
      .closest('.roster-card')
    expect(spectatorCard).toHaveTextContent('Spectating')
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

  it('keeps host-action failures in Host control and out of removal dialogs', async () => {
    const user = userEvent.setup()
    const view = {
      ...hintingView,
      allHintsSubmitted: true,
      hintStatuses: hintingView.hintStatuses.map((status) =>
        status.playerId === 'player-2'
          ? {
              ...status,
              submitted: true,
              hint: 'Orbit',
              hintNumber: 2,
            }
          : status,
      ),
    }
    render(
      <HintPhaseScreen
        view={view}
        onSubmitHint={vi.fn()}
        onUnlockHint={vi.fn()}
        onRejectHint={vi.fn().mockResolvedValue({
          status: 'server_unavailable',
          message: 'Could not reject that hint.',
        })}
        onRemovePlayer={vi.fn()}
        onLeave={vi.fn()}
        onStartGuessing={vi.fn().mockResolvedValue({
          status: 'rate_limited',
          message: 'Wait a moment before starting guessing.',
        })}
      />,
    )

    const hostControls = screen.getByRole('region', { name: 'Host controls' })
    await user.click(
      screen.getByRole('button', { name: "Reject Grace's hint" }),
    )
    expect(within(hostControls).getByRole('alert')).toHaveTextContent(
      'Could not reject that hint.',
    )
    await user.click(screen.getByRole('button', { name: 'Start guessing' }))
    expect(within(hostControls).getByRole('alert')).toHaveTextContent(
      'Wait a moment before starting guessing.',
    )
    await user.click(
      screen.getByRole('button', { name: 'Remove Grace from this game' }),
    )

    expect(within(hostControls).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(
      'Wait a moment before starting guessing.',
    )
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
    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByText('Try removing this player again shortly.'),
    ).toBeVisible()
    expect(
      screen.getAllByText('Try removing this player again shortly.'),
    ).toHaveLength(1)
    expect(
      within(screen.getByRole('region', { name: 'Host controls' })).queryByText(
        'Try removing this player again shortly.',
      ),
    ).not.toBeInTheDocument()
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
      screen.queryByText(
        'The host rejected this hint. Your board was refreshed; create and submit a new hint.',
      ),
    ).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('Your hint')).toBeEnabled()
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

describe('GuessingScreen roster order', () => {
  it('orders the roster by score and reorders when scores change', () => {
    const view: Extract<RoomSnapshot, { status: 'guessing' }> = {
      status: 'guessing',
      gameId: hintingView.gameId,
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
        { ...hintingView.members[0], position: 0, score: 3 },
        { ...hintingView.members[1], position: 1, score: 7 },
      ],
      canGuess: false,
      canMarkDone: false,
      canAdvanceTurn: false,
    }
    const props = {
      onClaimCard: vi.fn(),
      onFinishGuessing: vi.fn(),
      onRemovePlayer: vi.fn(),
      onAdvanceTurn: vi.fn(),
    }
    const rosterNames = () =>
      Array.from(
        screen
          .getByRole('list', { name: 'Roster' })
          .querySelectorAll('.roster-card-name'),
      ).map((element) => element.textContent)

    const rendered = render(<GuessingScreen view={view} {...props} />)
    expect(rosterNames()).toEqual(['Grace', 'Ada'])

    rendered.rerender(
      <GuessingScreen
        view={{
          ...view,
          scoreboard: view.scoreboard.map((entry) =>
            entry.playerId === 'player-1' ? { ...entry, score: 10 } : entry,
          ),
        }}
        {...props}
      />,
    )
    expect(rosterNames()).toEqual(['Ada', 'Grace'])
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
        message: 'The turn changed. Refresh and try again.',
      }),
    }
    const rendered = render(
      <GuessingScreen view={{ ...view, canAdvanceTurn: true }} {...props} />,
    )

    expect(
      screen.queryByRole('button', { name: 'Remove Ada from this game' }),
    ).not.toBeInTheDocument()
    const roster = screen.getByRole('list', { name: 'Roster' })
    const hostControls = screen.getByRole('region', { name: 'Host controls' })
    const score = within(roster).getByLabelText("Ada's score: 3")
    expect(score.closest('.roster-card-inline-detail')).toBeVisible()
    expect(score.closest('.roster-card-primary')).toHaveClass(
      'roster-card-primary-single-line',
    )
    expect(score.closest('.roster-card-primary')).toHaveTextContent('Ada·3')
    expect(
      within(roster).getByText('Clue-giver').closest('.status-dot-label'),
    ).toHaveClass('is-ready')
    expect(roster.closest('.game-panel')).not.toBe(hostControls)
    expect(hostControls).toHaveClass('game-panel')
    expect(within(roster).queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'I’m done guessing' }),
    ).not.toBeInTheDocument()
    const nextHint = screen.getByRole('button', { name: 'Next hint' })
    expect(nextHint).toBeVisible()
    // The advance control lives in the board card, not the host sidebar.
    expect(nextHint.closest('.game-sidebar')).toBeNull()
    expect(
      within(hostControls).getByRole('button', {
        name: 'Remove Grace from this game',
      }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next hint' }))
    expect(
      within(hostControls).getByText(
        'The turn changed. Refresh and try again.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByText(
        'Target found. You and the clue-giver each gain 3 points.',
      ),
    ).not.toBeInTheDocument()
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
      const activeAdvance = turnNumber === 1 ? onAdvanceTurn : onShowScoreboard
      activeAdvance.mockResolvedValueOnce({
        status: 'server_unavailable',
        message: 'Could not move on yet.',
      })
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
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'Could not move on yet.',
      )
      await user.click(screen.getByRole('button', { name: 'Move on' }))
      expect(activeAdvance).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
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
      expect(screen.getByRole('heading', { name: 'Roster' })).toBeVisible()
      expect(screen.getByRole('main')).not.toHaveTextContent(
        /\b(?:timers?|rounds?)\b/i,
      )
      if (command === 'advance') {
        expect(
          screen.queryByText(
            'Everyone has finished guessing. Advance when the room is ready.',
          ),
        ).not.toBeInTheDocument()
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
  it('shows an explicit no-winner result when no players remain', () => {
    const spectator = {
      playerId: 'spectator',
      name: 'Spectator',
      role: 'host' as const,
      participation: 'spectator' as const,
      position: null,
      score: null,
    }
    const results = {
      gameId: hintingView.gameId,
      scoreboard: [spectator],
      winners: [],
    }

    render(<FinishedScreen results={results} onReturnToLobby={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'No winner.' })).toBeVisible()
    expect(
      screen.getByText('No players remain in the final standings.'),
    ).toBeVisible()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows board-free results and lets every member return to the lobby', async () => {
    const user = userEvent.setup()
    const onReturnToLobby = vi.fn()
    const player = {
      playerId: 'player-1',
      name: 'Ada',
      role: 'host' as const,
      participation: 'player' as const,
      position: 0,
      score: 3,
    }
    const results = {
      gameId: hintingView.gameId,
      scoreboard: [player],
      winners: [player],
    }

    render(
      <FinishedScreen results={results} onReturnToLobby={onReturnToLobby} />,
    )

    expect(screen.queryByLabelText(/board/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Return to lobby' }))
    expect(onReturnToLobby).toHaveBeenCalledOnce()
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
      const results = {
        gameId: hintingView.gameId,
        scoreboard: [spectator, ...scoreboard.toReversed()],
        winners: scoreboard.filter(({ score }) => score === scores[0]),
      }
      render(<FinishedScreen results={results} onReturnToLobby={vi.fn()} />)

      const winnerHeading = results.winners.map(({ name }) => name).join(' & ')
      expect(
        screen.getByRole('heading', {
          name: `${winnerHeading} ${results.winners.length === 1 ? 'wins' : 'win'}.`,
        }),
      ).toBeVisible()
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

describe('pickHintPlaceholder', () => {
  it('picks the longest placeholder that fits the field width', () => {
    expect(pickHintPlaceholder(305)).toBe('e.g. ROCKY or PROJECT HAIL MARY')
    expect(pickHintPlaceholder(304)).toBe('e.g. PROJECT HAIL MARY')
    expect(pickHintPlaceholder(217)).toBe('e.g. PROJECT HAIL MARY')
    expect(pickHintPlaceholder(216)).toBe('e.g. ANDY WEIR')
    expect(pickHintPlaceholder(139)).toBe('e.g. ANDY WEIR')
    expect(pickHintPlaceholder(138)).toBe('e.g. ROCKY')
    expect(pickHintPlaceholder(103)).toBe('e.g. ROCKY')
    expect(pickHintPlaceholder(0)).toBe('e.g. ROCKY')
  })
})
