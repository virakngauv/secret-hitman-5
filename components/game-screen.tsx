'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  MAX_TARGET_COUNT,
  MIN_TARGET_COUNT,
  type CardKind,
  type CommandResult,
  type RoomSnapshot,
} from '@/lib/game-protocol'
import { getDenseRanks } from '@/lib/scoreboard'
import { cn } from '@/lib/utils'

type HintingView = Extract<RoomSnapshot, { status: 'hinting' }>
type GuessingView = Extract<RoomSnapshot, { status: 'guessing' }>
type FinishedView = Extract<RoomSnapshot, { status: 'finished' }>

export function HintPhaseScreen({
  view,
  onSubmitHint,
  onStartGuessing,
}: {
  view: HintingView
  onSubmitHint: (
    hint: string,
    targetCardIds: string[],
  ) => Promise<CommandResult>
  onStartGuessing: () => Promise<CommandResult>
}) {
  const [hint, setHint] = useState('')
  const [editableSelected, setSelected] = useState<Set<string>>(() => new Set())
  const selected = new Set(
    view.board
      ?.filter((card) => !card.locked && editableSelected.has(card.id))
      .map(({ id }) => id),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isHost = view.player.role === 'host'
  const readyCount = view.hintStatuses.filter(
    ({ submitted }) => submitted,
  ).length

  const toggleCard = (cardId: string) => {
    if (view.board?.find(({ id }) => id === cardId)?.locked) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else if (next.size < MAX_TARGET_COUNT) next.add(cardId)
      return next
    })
    setError(null)
  }

  const submit = async () => {
    if (!hint.trim()) return setError('Write a one-word or short phrase hint.')
    if (selected.size < MIN_TARGET_COUNT)
      return setError('Select at least one word for your hint.')
    setIsSubmitting(true)
    setError(null)
    const result = await onSubmitHint(hint.trim(), [...selected])
    if (result.status !== 'success') setError(result.message)
    setIsSubmitting(false)
  }

  const startGuessing = async () => {
    setIsStarting(true)
    setError(null)
    const result = await onStartGuessing()
    if (result.status !== 'success') setError(result.message)
    setIsStarting(false)
  }

  return (
    <GamePageShell
      roomCode={view.roomCode}
      eyebrow="Phase 1 · Make your hint"
      title="Build one clue. Pick your targets."
      subtitle="Three civilians and the assassin are locked. Select one to five editable targets."
    >
      <div className="game-layout">
        <section className="game-panel min-w-0">
          {view.board === null ? (
            <WaitingCard
              title="You joined as a spectator"
              body="The round is already underway. You’ll follow every hint and guess, but won’t enter the scorecard."
            />
          ) : view.hintSubmitted ? (
            <WaitingCard
              title="Hint locked in"
              body="Nice. Your targets are private until your turn. We’ll move on when everyone is ready and the host starts guessing."
            />
          ) : (
            <>
              <div className="mb-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-end">
                <div>
                  <label className="field-label" htmlFor="hint">
                    Your hint
                  </label>
                  <Input
                    id="hint"
                    value={hint}
                    onChange={(event) => setHint(event.target.value)}
                    maxLength={40}
                    placeholder="e.g. orbit"
                    autoComplete="off"
                    className="mt-2 h-13 rounded-2xl text-lg"
                  />
                </div>
                <div className="hint-number" aria-live="polite">
                  <span className="hint-number-value">{selected.size}</span>
                  <span className="hint-number-label">clue number</span>
                </div>
              </div>

              <p className="mb-3 text-sm text-[var(--muted-foreground)]">
                Select one to five words this hint should point to.
              </p>
              <div className="word-grid" aria-label="Your twelve word board">
                {view.board.map((card) => {
                  const isAssassin = card.kind === 'assassin'
                  const isSelected = selected.has(card.id)
                  return (
                    <button
                      key={card.id}
                      type="button"
                      data-card-id={card.id}
                      data-card-kind={card.kind}
                      data-card-locked={card.locked}
                      aria-label={`${isAssassin ? 'Assassin' : isSelected ? 'Target' : card.kind === 'civilian' ? 'Civilian' : 'Available'}${card.locked ? ' · Locked' : ''} · ${card.word}`}
                      className={cn(
                        'word-card',
                        isSelected && 'word-card-target',
                        isAssassin && 'word-card-assassin',
                        card.kind === 'civilian' && 'word-card-civilian',
                      )}
                      onClick={() => toggleCard(card.id)}
                      disabled={
                        card.locked ||
                        isSubmitting ||
                        (!isSelected && selected.size >= MAX_TARGET_COUNT)
                      }
                      aria-pressed={isSelected}
                    >
                      <span className="word-card-index">
                        {isAssassin
                          ? 'ASSASSIN'
                          : isSelected
                            ? 'TARGET'
                            : card.kind === 'civilian'
                              ? 'CIVILIAN'
                              : 'AVAILABLE'}
                      </span>
                      {card.locked && (
                        <svg
                          className="word-card-lock"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <rect x="5" y="10" width="14" height="11" rx="2" />
                          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                        </svg>
                      )}
                      <span className="word-card-word">{card.word}</span>
                    </button>
                  )
                })}
              </div>

              <p className="form-message" role={error ? 'alert' : 'status'}>
                {error ?? 'You can change your selection until you lock it in.'}
              </p>
              <Button
                className="mt-2 h-12 w-full sm:w-auto"
                onClick={() => void submit()}
                disabled={
                  isSubmitting ||
                  selected.size < MIN_TARGET_COUNT ||
                  !hint.trim()
                }
              >
                {isSubmitting
                  ? 'Locking in…'
                  : `Lock in hint · ${selected.size}`}
              </Button>
            </>
          )}
        </section>

        <aside className="game-panel game-sidebar">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="sidebar-title">Hint check-in</h2>
            <span className="phase-count">
              {readyCount}/{view.hintStatuses.length}
            </span>
          </div>
          <ul className="mt-4 grid gap-2">
            {view.hintStatuses.map((player) => (
              <li className="status-row" key={player.playerId}>
                <span className="truncate font-semibold">{player.name}</span>
                <span
                  className={cn(
                    'status-dot-label',
                    player.submitted && 'is-ready',
                  )}
                >
                  <span className="status-dot" />
                  {player.submitted ? 'Ready' : 'Choosing'}
                </span>
              </li>
            ))}
          </ul>

          {isHost ? (
            <div className="host-control">
              <p className="host-control-label">Host control</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Start when all hints are locked.
              </p>
              <Button
                className="mt-4 w-full"
                disabled={!view.allHintsSubmitted || isStarting}
                onClick={() => void startGuessing()}
              >
                {isStarting ? 'Starting…' : 'Start guessing'}
              </Button>
            </div>
          ) : (
            <p className="sidebar-note">
              The host will start guessing when everyone is ready.
            </p>
          )}
        </aside>
      </div>
    </GamePageShell>
  )
}

export function GuessingScreen({
  view,
  onClaimCard,
  onFinishGuessing,
  onAdvanceTurn,
}: {
  view: GuessingView
  onClaimCard: (
    cardId: string,
    turnId: string,
  ) => Promise<CommandResult<{ kind: CardKind }>>
  onFinishGuessing: () => Promise<CommandResult>
  onAdvanceTurn: () => Promise<CommandResult>
}) {
  const [busyCard, setBusyCard] = useState<string | null>(null)
  const [isFinishing, setIsFinishing] = useState(false)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const isClueGiver = view.player.playerId === view.clueGiverId
  const players = view.scoreboard.filter(
    ({ participation }) => participation === 'player',
  )
  const spectators = view.members.filter(
    ({ participation }) => participation === 'spectator',
  )

  const claim = async (cardId: string) => {
    setBusyCard(cardId)
    setFeedback(null)
    const result = await onClaimCard(cardId, view.turnId)
    setBusyCard(null)
    if (result.status !== 'success') return setFeedback(result.message)
    setFeedback(
      result.kind === 'target'
        ? 'Target found. You and the clue-giver each gain 2 points.'
        : result.kind === 'civilian'
          ? 'Civilian. You and the clue-giver each lose 1 point; your guessing is done.'
          : 'Assassin. You and the clue-giver each lose 3 points; this board is complete.',
    )
  }

  const finish = async () => {
    setFeedback(null)
    setIsFinishing(true)
    const result = await onFinishGuessing()
    if (result.status !== 'success') setFeedback(result.message)
    setIsFinishing(false)
  }

  const advance = async () => {
    setFeedback(null)
    setIsAdvancing(true)
    const result = await onAdvanceTurn()
    if (result.status !== 'success') setFeedback(result.message)
    setIsAdvancing(false)
  }

  return (
    <GamePageShell
      roomCode={view.roomCode}
      eyebrow={`Turn ${view.turnNumber} of ${view.totalTurns}`}
      title={`${view.clueGiverName} is the clue-giver`}
      subtitle={
        isClueGiver
          ? 'Your board is fully revealed. Watch the room work through your clue.'
          : view.player.participation === 'spectator'
            ? 'Spectator mode · follow the guesses without changing the board.'
            : view.canGuess
              ? 'Choose carefully. A civilian costs 1 point each; the assassin costs 3 points each and ends the board.'
              : 'Guessing is done for this hint. Completed and finished boards are fully revealed.'
      }
    >
      <section className="clue-banner" aria-label="Current hint">
        <div>
          <p className="clue-label">THE HINT</p>
          <p className="clue-word">{view.hint}</p>
        </div>
        <div
          className="clue-count"
          aria-label={`Hint number ${view.hintNumber}`}
        >
          {view.hintNumber}
        </div>
      </section>

      <div className="game-layout mt-5">
        <section className="game-panel min-w-0">
          <div className="word-grid" aria-label="Current guessing board">
            {view.board.map((card) => (
              <button
                key={card.id}
                type="button"
                data-card-id={card.id}
                data-card-kind={card.revealedKind ?? 'hidden'}
                className={cn(
                  'word-card word-card-guess',
                  card.revealedKind === 'target' && 'word-card-target',
                  card.revealedKind === 'civilian' && 'word-card-civilian',
                  card.revealedKind === 'assassin' && 'word-card-assassin',
                )}
                disabled={card.disabled || busyCard !== null}
                onClick={() => void claim(card.id)}
              >
                <span className="word-card-index">
                  {card.revealedKind?.toUpperCase() ??
                    (busyCard === card.id ? 'CHECKING…' : 'CLASSIFIED')}
                </span>
                <span className="word-card-word">{card.word}</span>
                <span className="word-card-claimers">
                  {card.claimedBy.length ? card.claimedBy.join(', ') : ' '}
                </span>
              </button>
            ))}
          </div>

          <div className="board-actions">
            <p className="form-message m-0" role="status" aria-live="polite">
              {feedback ??
                (view.canGuess
                  ? 'Pick a word, or finish guessing safely.'
                  : ' ')}
            </p>
            {view.canMarkDone ? (
              <Button
                variant="outline"
                onClick={() => void finish()}
                disabled={isFinishing}
              >
                {isFinishing ? 'Saving…' : 'I’m done guessing'}
              </Button>
            ) : null}
          </div>
        </section>

        <aside className="game-panel game-sidebar">
          <h2 className="sidebar-title">Scorecard</h2>
          <ol className="mt-4 grid gap-2">
            {players.map((player) => {
              const turnState = view.turnPlayers.find(
                ({ playerId }) => playerId === player.playerId,
              )?.state
              return (
                <li className="score-row" key={player.playerId}>
                  <div className="min-w-0">
                    <span className="block truncate font-semibold">
                      {player.name}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {turnState === 'clue-giver'
                        ? 'Clue-giver'
                        : turnState === 'done'
                          ? 'Done this turn'
                          : 'Guessing'}
                    </span>
                  </div>
                  <span className="score-value">{player.score}</span>
                </li>
              )
            })}
          </ol>

          {spectators.length ? (
            <p className="sidebar-note">
              Spectating: {spectators.map(({ name }) => name).join(', ')}
            </p>
          ) : null}

          {view.player.role === 'host' ? (
            <div className="host-control">
              <p className="host-control-label">Host control</p>
              <p
                id="host-advance-status"
                role="status"
                className="mt-1 text-sm text-[var(--muted-foreground)]"
              >
                {view.canAdvanceTurn
                  ? 'Everyone has finished guessing. Advance when the room is ready.'
                  : 'Waiting for players to finish guessing.'}
              </p>
              <Button
                className="mt-4 w-full"
                onClick={() => void advance()}
                disabled={isAdvancing || !view.canAdvanceTurn}
                aria-describedby="host-advance-status"
              >
                {isAdvancing
                  ? 'Advancing…'
                  : view.turnNumber === view.totalTurns
                    ? 'Finish the game'
                    : 'Next hint'}
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </GamePageShell>
  )
}

export function FinishedScreen({ view }: { view: FinishedView }) {
  const players = [...view.scoreboard]
    .filter(({ participation }) => participation === 'player')
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
  const ranks = getDenseRanks(players.map(({ score }) => score))
  const winnerNames = view.winners.map(({ name }) => name).join(' & ')

  return (
    <GamePageShell
      roomCode={view.roomCode}
      eyebrow="Game complete"
      title={`${winnerNames} ${view.winners.length === 1 ? 'wins' : 'win'}`}
      subtitle="Every player gave one hint. Final scores are locked."
    >
      <div className="game-layout">
        <section className="game-panel min-w-0">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="clue-label">
                FINAL HINT · {view.lastClueGiverName}
              </p>
              <p className="text-3xl font-black tracking-tight uppercase">
                {view.lastHint}{' '}
                <span className="text-[var(--accent)]">
                  {view.lastHintNumber}
                </span>
              </p>
            </div>
            <span className="phase-count">Revealed</span>
          </div>
          <div
            className="word-grid mt-5"
            aria-label="Fully revealed final board"
          >
            {view.board.map((card) => (
              <div
                className={cn(
                  'word-card',
                  card.revealedKind === 'target' && 'word-card-target',
                  card.revealedKind === 'civilian' && 'word-card-civilian',
                  card.revealedKind === 'assassin' && 'word-card-assassin',
                )}
                key={card.id}
                data-card-id={card.id}
                data-card-kind={card.revealedKind ?? 'hidden'}
              >
                <span className="word-card-index">
                  {card.revealedKind?.toUpperCase()}
                </span>
                <span className="word-card-word">{card.word}</span>
                <span className="word-card-claimers">
                  {card.claimedBy.join(', ') || ' '}
                </span>
              </div>
            ))}
          </div>
        </section>

        <aside className="game-panel game-sidebar">
          <h2 className="sidebar-title">Final standings</h2>
          <ol className="mt-4 grid gap-2">
            {players.map((player, index) => {
              const place = ranks[index]
              const medal = ['🥇', '🥈', '🥉'][place - 1]
              const placeName = ['First', 'Second', 'Third'][place - 1]
              const placeLabel = medal ? `${placeName} place` : `Place ${place}`
              return (
                <li
                  className={cn('score-row', place === 1 && 'score-row-winner')}
                  key={player.playerId}
                >
                  <div className="min-w-0">
                    <span className="block truncate font-semibold">
                      {player.name}
                    </span>
                    <span className="score-placement text-xs text-[var(--muted-foreground)]">
                      {medal ? (
                        <>
                          <span aria-hidden="true">{medal}</span> {placeLabel}
                        </>
                      ) : (
                        placeLabel
                      )}
                    </span>
                  </div>
                  <span className="score-value">{player.score}</span>
                </li>
              )
            })}
          </ol>
          <Button asChild className="mt-6 w-full">
            <Link href="/home">Back to home</Link>
          </Button>
        </aside>
      </div>
    </GamePageShell>
  )
}

function GamePageShell({
  roomCode,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  roomCode: string
  eyebrow: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen px-4 py-5 sm:px-7 sm:py-7 lg:px-10">
      <div className="mx-auto max-w-[90rem]">
        <header className="game-topbar">
          <Link
            className="brand-mark"
            href="/home"
            aria-label="Secret Hitman home"
          >
            <span className="brand-sight" aria-hidden="true">
              ⌖
            </span>
            <span>SECRET HITMAN</span>
          </Link>
          <span className="room-chip">ROOM {roomCode.toUpperCase()}</span>
        </header>
        <div className="mt-10 mb-6 max-w-3xl sm:mt-14">
          <p className="page-eyebrow">{eyebrow}</p>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  )
}

function WaitingCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="waiting-card">
      <span className="waiting-reticle" aria-hidden="true">
        ⌖
      </span>
      <h2 className="mt-5 text-2xl font-black tracking-tight">{title}</h2>
      <p className="mt-2 max-w-lg text-[var(--muted-foreground)]">{body}</p>
    </div>
  )
}
