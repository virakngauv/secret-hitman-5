'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CARD_SCORE,
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
  onUnlockHint,
  onRejectHint,
  onRemovePlayer,
  onStartGuessing,
}: {
  view: HintingView
  onSubmitHint: (
    hint: string,
    targetCardIds: string[],
  ) => Promise<CommandResult>
  onUnlockHint: () => Promise<CommandResult>
  onRejectHint: (playerId: string) => Promise<CommandResult>
  onRemovePlayer: (
    playerId: string,
    allowRoundReset: boolean,
  ) => Promise<CommandResult>
  onStartGuessing: () => Promise<CommandResult>
}) {
  const [hint, setHint] = useState(view.hint ?? '')
  const [editableSelected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        view.board
          ?.filter((card) => !card.locked && card.kind === 'target')
          .map(({ id }) => id),
      ),
  )
  const selected = new Set(
    view.board
      ?.filter((card) => !card.locked && editableSelected.has(card.id))
      .map(({ id }) => id),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [busyPlayer, setBusyPlayer] = useState<string | null>(null)
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

  const unlock = async () => {
    setIsUnlocking(true)
    setError(null)
    const result = await onUnlockHint()
    if (result.status !== 'success') setError(result.message)
    setIsUnlocking(false)
  }

  const startGuessing = async () => {
    setIsStarting(true)
    setError(null)
    const result = await onStartGuessing()
    if (result.status !== 'success') setError(result.message)
    setIsStarting(false)
  }

  const rejectHint = async (playerId: string) => {
    setBusyPlayer(playerId)
    setError(null)
    const result = await onRejectHint(playerId)
    if (result.status !== 'success') setError(result.message)
    setBusyPlayer(null)
  }

  const removePlayer = async (playerId: string, name: string) => {
    const resetsRound = view.hintStatuses.length <= 2
    const confirmed = window.confirm(
      resetsRound
        ? `Remove ${name}? This will leave fewer than two players, end the current round, and return everyone else to the lobby. All current boards, hints, readiness, scores, and turns will be discarded. ${name} will not be able to rejoin this room.`
        : `Remove ${name}? Their board, submitted hint, readiness, and remaining turn will be removed from this game. They will not be able to rejoin this room.`,
    )
    if (!confirmed) return
    setBusyPlayer(playerId)
    setError(null)
    const result = await onRemovePlayer(playerId, resetsRound)
    if (result.status !== 'success') setError(result.message)
    setBusyPlayer(null)
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
          ) : (
            <>
              <div className="hint-controls">
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
                    readOnly={view.hintSubmitted}
                    aria-describedby="hint-editing-status"
                    className="mt-2 h-13 rounded-2xl text-lg"
                  />
                </div>
                <div className="hint-number" aria-live="polite">
                  <span className="hint-number-value">{selected.size}</span>
                  <span className="hint-number-label">clue number</span>
                </div>
              </div>

              <p
                id="hint-editing-status"
                className="board-instructions text-sm text-[var(--muted-foreground)]"
              >
                {view.hintSubmitted
                  ? 'Hint locked in. Your board and targets stay private until your turn.'
                  : 'Select one to five words this hint should point to.'}
              </p>
              <div className="word-grid" aria-label="Your twelve word board">
                {view.board.map((card) => {
                  const isAssassin = card.kind === 'assassin'
                  const isSelected = selected.has(card.id)
                  const isDerivedCivilian =
                    selected.size === MAX_TARGET_COUNT &&
                    !card.locked &&
                    !isSelected
                  const roleName = isAssassin
                    ? 'Assassin'
                    : isSelected
                      ? 'Target'
                      : card.kind === 'civilian' || isDerivedCivilian
                        ? 'Civilian'
                        : 'Available'
                  const roleState = isDerivedCivilian
                    ? 'Reversible when a target is deselected'
                    : card.locked
                      ? 'Locked'
                      : null
                  const roleScore = formatScore(
                    CARD_SCORE[
                      isAssassin
                        ? 'assassin'
                        : isSelected
                          ? 'target'
                          : 'civilian'
                    ],
                  )
                  const roleLabel = `${roleName} ${roleScore}`
                  return (
                    <button
                      key={card.id}
                      type="button"
                      data-card-id={card.id}
                      data-card-kind={
                        isDerivedCivilian ? 'civilian' : card.kind
                      }
                      data-card-locked={card.locked}
                      data-card-derived-civilian={isDerivedCivilian}
                      aria-label={`${roleLabel}${roleState ? ` · ${roleState}` : ''} · ${card.word}`}
                      className={cn(
                        'word-card',
                        isSelected && 'word-card-target',
                        isAssassin && 'word-card-assassin',
                        (card.kind === 'civilian' || isDerivedCivilian) &&
                          'word-card-civilian',
                      )}
                      onClick={() => toggleCard(card.id)}
                      disabled={
                        card.locked ||
                        view.hintSubmitted ||
                        isSubmitting ||
                        (!isSelected && selected.size >= MAX_TARGET_COUNT)
                      }
                      aria-pressed={isSelected}
                    >
                      <span className="word-card-index">{roleName}</span>
                      <span className="word-card-score">{roleScore}</span>
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
                      <CardWord word={card.word} />
                    </button>
                  )
                })}
              </div>

              <p className="form-message" role={error ? 'alert' : 'status'}>
                {error ??
                  (view.hintRejected
                    ? 'The host rejected this hint. Your board was refreshed; create and lock in a new hint.'
                    : view.hintSubmitted
                      ? 'Unlock your hint to revise the clue or target selection.'
                      : 'You can change your selection until you lock it in.')}
              </p>
              {view.hintSubmitted ? (
                <Button
                  variant="outline"
                  className="mt-2 h-12 w-full sm:w-auto"
                  onClick={() => void unlock()}
                  disabled={isUnlocking}
                >
                  {isUnlocking ? 'Unlocking…' : 'Unlock / Edit hint'}
                </Button>
              ) : (
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
              )}
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
            {view.hintStatuses.map((player) => {
              const member = view.members.find(
                ({ playerId }) => playerId === player.playerId,
              )
              const isSelf = player.playerId === view.player.playerId
              const canRemove = isHost && member?.role !== 'host'
              return (
                <li
                  className="status-row flex-wrap items-center gap-x-3 gap-y-2"
                  key={player.playerId}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {player.name}
                    </span>
                    {player.hint !== null && player.hintNumber !== null ? (
                      <span
                        className="block truncate text-sm text-[var(--muted-foreground)]"
                        aria-label={`${player.name}'s hint: ${player.hint}, ${player.hintNumber}`}
                      >
                        {player.hint} · {player.hintNumber}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'status-dot-label',
                      player.submitted && 'is-ready',
                    )}
                  >
                    <span className="status-dot" />
                    {player.needsRevision
                      ? 'Needs revision'
                      : player.submitted
                        ? 'Ready'
                        : 'Choosing'}
                  </span>
                  {isHost && player.submitted && !isSelf && member ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-3 text-xs"
                      disabled={busyPlayer !== null}
                      onClick={() => void rejectHint(player.playerId)}
                      aria-label={`Reject ${player.name}'s hint`}
                    >
                      Reject hint
                    </Button>
                  ) : null}
                  {canRemove ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-3 text-xs"
                      disabled={busyPlayer !== null}
                      onClick={() =>
                        void removePlayer(player.playerId, player.name)
                      }
                      aria-label={`Remove ${player.name} from this game`}
                    >
                      Remove player
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {isHost ? (
            <div className="host-control">
              <p className="host-control-label">Host control</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Review clues as they arrive, reject any that need revision, or
                start guessing once everyone is ready.
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
              Submitted clues appear here as players lock them in. The host will
              start guessing when everyone is ready.
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
  onRemovePlayer,
  onAdvanceTurn,
}: {
  view: GuessingView
  onClaimCard: (
    cardId: string,
    turnId: string,
  ) => Promise<CommandResult<{ kind: CardKind }>>
  onFinishGuessing: () => Promise<CommandResult>
  onRemovePlayer: (playerId: string) => Promise<CommandResult>
  onAdvanceTurn: () => Promise<CommandResult>
}) {
  const [busyCard, setBusyCard] = useState<string | null>(null)
  const [isFinishing, setIsFinishing] = useState(false)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [busyPlayer, setBusyPlayer] = useState<string | null>(null)
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
        ? `Target found. You and the clue-giver each gain ${CARD_SCORE.target} points.`
        : result.kind === 'civilian'
          ? `Civilian. You and the clue-giver each lose ${Math.abs(CARD_SCORE.civilian)} point; your guessing is done.`
          : `Assassin. You and the clue-giver each lose ${Math.abs(CARD_SCORE.assassin)} points; this board is complete.`,
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

  const removePlayer = async (playerId: string, name: string) => {
    const confirmed = window.confirm(
      `Remove ${name}? They will no longer be able to guess or rejoin this room. Their board, clue, turn, and score history will remain in the game.`,
    )
    if (!confirmed) return
    setBusyPlayer(playerId)
    setFeedback(null)
    const result = await onRemovePlayer(playerId)
    if (result.status !== 'success') setFeedback(result.message)
    setBusyPlayer(null)
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
              ? `Choose carefully. A civilian costs ${Math.abs(CARD_SCORE.civilian)} point each; the assassin costs ${Math.abs(CARD_SCORE.assassin)} points each and ends the board.`
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

      <div className="game-layout game-board-layout">
        <section className="game-panel min-w-0">
          <div
            className="word-grid"
            aria-label={
              view.boardCompleted
                ? 'Completed and fully revealed board'
                : 'Current guessing board'
            }
          >
            {view.board.map((card) => (
              <button
                key={card.id}
                type="button"
                data-card-id={card.id}
                data-card-kind={card.revealedKind ?? 'hidden'}
                className={cn(
                  'word-card word-card-guess',
                  card.revealedKind &&
                    card.claimedBy.length > 0 &&
                    'word-card-has-score',
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
                {card.revealedKind && card.claimedBy.length > 0 && (
                  <span className="word-card-score">
                    {formatScore(CARD_SCORE[card.revealedKind])}
                  </span>
                )}
                <CardWord word={card.word} />
                <CardAttribution names={card.claimedBy} />
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
              const activeMember = view.members.find(
                ({ playerId }) => playerId === player.playerId,
              )
              const turnState = view.turnPlayers.find(
                ({ playerId }) => playerId === player.playerId,
              )?.state
              const canRemove =
                view.player.role === 'host' &&
                activeMember?.role !== 'host' &&
                activeMember !== undefined
              return (
                <li
                  className="score-row flex-wrap gap-x-3 gap-y-2"
                  key={player.playerId}
                >
                  <div className="min-w-0">
                    <span className="block truncate font-semibold">
                      {player.name}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {!activeMember
                        ? 'No longer active'
                        : turnState === 'clue-giver'
                          ? 'Clue-giver'
                          : turnState === 'done'
                            ? 'Done this turn'
                            : 'Guessing'}
                    </span>
                  </div>
                  <span className="score-value">{player.score}</span>
                  {canRemove ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-3 text-xs"
                      disabled={busyPlayer !== null}
                      onClick={() =>
                        void removePlayer(player.playerId, player.name)
                      }
                      aria-label={`Remove ${player.name} from this game`}
                    >
                      Remove player
                    </Button>
                  ) : null}
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

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `−${Math.abs(score)}`
}

function CardWord({ word }: { word: string }) {
  const segments = word.trim().split(/\s+/u)
  const longestSegment = Math.max(...segments.map((segment) => segment.length))
  const isSingleWord = segments.length === 1

  return (
    <span
      className={cn(
        'word-card-word',
        isSingleWord && 'word-card-word-single',
        isSingleWord && longestSegment >= 7 && 'word-card-word-compact',
        isSingleWord && longestSegment >= 10 && 'word-card-word-wide',
        longestSegment >= 16 && 'word-card-word-break',
      )}
    >
      {word}
    </span>
  )
}

function CardAttribution({ names }: { names: string[] }) {
  const pickerNames = names.join(', ')

  if (pickerNames) {
    return (
      <span className="word-card-claimers word-card-picker-attribution">
        <span className="sr-only">Selected by</span> {pickerNames}
      </span>
    )
  }

  return (
    <span className="word-card-claimers" aria-hidden="true">
      {' '}
    </span>
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
            className="word-grid finished-board-grid"
            aria-label="Fully revealed final board"
          >
            {view.board.map((card) => (
              <div
                className={cn(
                  'word-card',
                  card.revealedKind &&
                    card.claimedBy.length > 0 &&
                    'word-card-has-score',
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
                {card.revealedKind && card.claimedBy.length > 0 && (
                  <span className="word-card-score">
                    {formatScore(CARD_SCORE[card.revealedKind])}
                  </span>
                )}
                <CardWord word={card.word} />
                <CardAttribution names={card.claimedBy} />
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
    <main className="game-page min-h-screen px-4 py-5 sm:px-7 sm:py-7 lg:px-10">
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
        <div className="game-intro mt-10 mb-6 max-w-3xl sm:mt-14">
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
