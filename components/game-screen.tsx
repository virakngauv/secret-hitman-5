'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react'

import { HostControlCard } from '@/components/host-control-card'
import { LeaveRoomControl } from '@/components/leave-room-control'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Input } from '@/components/ui/input'
import {
  CARD_SCORE,
  MAX_TARGET_COUNT,
  MIN_TARGET_COUNT,
  type CardKind,
  type CommandResult,
  type CompletedGameResults,
  type RoomSnapshot,
} from '@/lib/game-protocol'
import { getDenseRanks } from '@/lib/scoreboard'
import { cn } from '@/lib/utils'

type HintingView = Extract<RoomSnapshot, { status: 'hinting' }>
type GuessingView = Extract<RoomSnapshot, { status: 'guessing' }>

export function HintPhaseScreen({
  view,
  onSubmitHint,
  onUnlockHint,
  onRejectHint,
  onRemovePlayer,
  onLeave,
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
  onLeave: () => Promise<CommandResult>
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
  const [isLeaving, setIsLeaving] = useState(false)
  const [busyPlayer, setBusyPlayer] = useState<string | null>(null)
  const [removalTarget, setRemovalTarget] = useState<{
    playerId: string
    name: string
    resetsRound: boolean
  } | null>(null)
  const [hintActionError, setHintActionError] = useState<string | null>(null)
  const [hostActionError, setHostActionError] = useState<string | null>(null)
  const [removalError, setRemovalError] = useState<string | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)
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
    setHintActionError(null)
  }

  const submit = async () => {
    if (!hint.trim())
      return setHintActionError('Write a one-word or short phrase hint.')
    if (selected.size < MIN_TARGET_COUNT)
      return setHintActionError('Select at least one word for your hint.')
    setIsSubmitting(true)
    setHintActionError(null)
    const result = await onSubmitHint(hint.trim(), [...selected])
    if (result.status !== 'success') setHintActionError(result.message)
    setIsSubmitting(false)
  }

  const unlock = async () => {
    setIsUnlocking(true)
    setHintActionError(null)
    const result = await onUnlockHint()
    if (result.status !== 'success') setHintActionError(result.message)
    setIsUnlocking(false)
  }

  const startGuessing = async () => {
    setIsStarting(true)
    setHostActionError(null)
    const result = await onStartGuessing()
    if (result.status !== 'success') setHostActionError(result.message)
    setIsStarting(false)
  }

  const rejectHint = async (playerId: string) => {
    setBusyPlayer(playerId)
    setHostActionError(null)
    const result = await onRejectHint(playerId)
    if (result.status !== 'success') setHostActionError(result.message)
    setBusyPlayer(null)
  }

  const removePlayer = async (playerId: string, name: string) => {
    const resetsRound = view.hintStatuses.length <= 2
    setHostActionError(null)
    setRemovalError(null)
    setRemovalTarget({ playerId, name, resetsRound })
  }

  const confirmRemoval = async () => {
    if (!removalTarget) return
    const { playerId, resetsRound } = removalTarget
    setBusyPlayer(playerId)
    setRemovalError(null)
    const result = await onRemovePlayer(playerId, resetsRound)
    if (result.status !== 'success') setRemovalError(result.message)
    else setRemovalTarget(null)
    setBusyPlayer(null)
  }

  const leave = async () => {
    setIsLeaving(true)
    setLeaveError(null)
    const result = await onLeave()
    if (result.status !== 'success') setLeaveError(result.message)
    setIsLeaving(false)
  }

  return (
    <GamePageShell>
      <div className="game-layout">
        <section className="game-panel min-w-0">
          {view.board === null ? (
            <WaitingCard
              title="You joined as a spectator"
              body="The round is already underway. You’ll follow every hint and guess, but won’t enter the scorecard."
            />
          ) : (
            <>
              {view.hintSubmitted ? (
                <HintDisplay
                  hint={hint}
                  count={selected.size}
                  label="Submitted hint"
                  live
                />
              ) : (
                <section
                  className="hint-display"
                  aria-label="Hint submission prompt"
                >
                  <p className="hint-display-text hint-display-prompt">
                    <span className="hint-prompt-line">
                      Select 1-5 targets.
                    </span>{' '}
                    <span className="hint-prompt-line">
                      Type your hint. Submit.
                    </span>
                  </p>
                </section>
              )}

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

              <section aria-label="Hint controls">
                <div className="hint-controls">
                  <div>
                    <label className="sr-only" htmlFor="hint">
                      Your hint
                    </label>
                    <Input
                      id="hint"
                      value={hint}
                      onChange={(event) => {
                        setHint(event.target.value.toUpperCase())
                        setHintActionError(null)
                      }}
                      maxLength={40}
                      placeholder="Type your hint"
                      autoComplete="off"
                      autoCapitalize="characters"
                      disabled={view.hintSubmitted}
                      readOnly={isSubmitting || isUnlocking}
                      className={cn(
                        'h-13 rounded-2xl text-lg',
                        view.hintSubmitted && 'uppercase',
                      )}
                    />
                  </div>
                  {view.hintSubmitted ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-auto justify-self-end px-5"
                      onClick={() => void unlock()}
                      disabled={isUnlocking}
                    >
                      {isUnlocking ? 'Editing…' : 'Edit'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-auto justify-self-end px-5"
                      onClick={() => void submit()}
                      disabled={
                        isSubmitting ||
                        selected.size < MIN_TARGET_COUNT ||
                        !hint.trim()
                      }
                    >
                      {isSubmitting ? 'Submitting…' : 'Submit'}
                    </Button>
                  )}
                </div>

                {hintActionError ? (
                  <p className="action-error hint-control-error" role="alert">
                    {hintActionError}
                  </p>
                ) : null}
              </section>

              {isHost ? (
                <div className="board-actions">
                  <div className="board-action-group">
                    <Button
                      onClick={() => void startGuessing()}
                      disabled={!view.allHintsSubmitted || isStarting}
                    >
                      {isStarting ? 'Starting…' : 'Start guessing'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        <aside className="game-sidebar game-sidebar-stack">
          <section className="game-panel">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="sidebar-title">Roster</h2>
              <span className="phase-count">
                {readyCount}/{view.hintStatuses.length}
              </span>
            </div>
            <ul className="roster-scroll" aria-label="Roster">
              {view.members.map((member) => {
                const hintStatus = view.hintStatuses.find(
                  ({ playerId }) => playerId === member.playerId,
                )
                const hintDetail =
                  hintStatus?.hint !== null &&
                  hintStatus?.hint !== undefined &&
                  hintStatus.hintNumber !== null &&
                  hintStatus.hintNumber !== undefined
                    ? hintStatus.hint
                    : null
                const status =
                  member.participation === 'spectator'
                    ? 'Spectating'
                    : hintStatus?.needsRevision
                      ? 'Needs revision'
                      : hintStatus?.submitted
                        ? 'Ready'
                        : hintStatus
                          ? 'Choosing'
                          : 'Waiting'

                return (
                  <RosterCard
                    key={member.playerId}
                    name={member.name}
                    detail={hintDetail}
                    detailClassName={hintDetail ? 'hint-detail' : undefined}
                    detailSuffix={
                      hintDetail && hintStatus
                        ? String(hintStatus.hintNumber)
                        : undefined
                    }
                    detailLabel={
                      hintDetail && hintStatus
                        ? `${member.name}'s hint: ${hintStatus.hint}, ${hintStatus.hintNumber}`
                        : undefined
                    }
                    status={status}
                    tone={
                      member.participation === 'spectator'
                        ? 'spectating'
                        : hintStatus?.submitted
                          ? 'ready'
                          : 'default'
                    }
                  />
                )
              })}
            </ul>
          </section>

          {isHost ? (
            <HostControlCard>
              <OperationalHostNotice view={view} />
              <ul className="host-player-controls" aria-label="Player controls">
                {view.hintStatuses.map((player) => {
                  const member = view.members.find(
                    ({ playerId }) => playerId === player.playerId,
                  )
                  if (!member || member.role === 'host') return null
                  const hintDetail =
                    player.hint !== null && player.hintNumber !== null
                      ? player.hint
                      : null

                  return (
                    <li
                      className="host-player-control-row"
                      key={player.playerId}
                    >
                      <PlayerSummary
                        name={player.name}
                        detail={hintDetail ?? 'No hint submitted'}
                        detailClassName={
                          hintDetail ? 'hint-detail' : 'host-no-hint-detail'
                        }
                        detailSuffix={
                          hintDetail ? String(player.hintNumber) : undefined
                        }
                        detailLabel={
                          hintDetail
                            ? `${player.name}'s hint: ${player.hint}, ${player.hintNumber}`
                            : undefined
                        }
                        className="host-player-summary"
                      />
                      <span className="host-player-actions">
                        {player.submitted ? (
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
                      </span>
                    </li>
                  )
                })}
              </ul>
              {hostActionError ? (
                <p className="action-error host-action-error" role="alert">
                  {hostActionError}
                </p>
              ) : null}
            </HostControlCard>
          ) : null}
          <LeaveRoomControl
            busy={isLeaving}
            className="mt-0"
            confirmationRequired={!isHost || view.members.length > 1}
            error={leaveError}
            gameInProgress
            isHost={isHost}
            onConfirm={() => void leave()}
          />
        </aside>
      </div>
      {view.hintRejected ? <HintRejectionNotice /> : null}
      <ConfirmationDialog
        open={removalTarget !== null}
        title={
          removalTarget ? `Remove ${removalTarget.name} from this game?` : ''
        }
        description={
          removalTarget?.resetsRound
            ? `This will leave fewer than two players, end the current round, and return everyone else to the lobby. All current boards, hints, readiness, scores, and turns will be discarded. ${removalTarget.name} will not be able to rejoin this room.`
            : `${removalTarget?.name ?? 'This player'}'s board, submitted hint, readiness, and remaining turn will be removed from this game. They will not be able to rejoin this room.`
        }
        cancelLabel="Cancel"
        confirmLabel="Remove"
        busy={busyPlayer !== null}
        error={removalTarget ? removalError : null}
        onCancel={() => {
          setRemovalError(null)
          setRemovalTarget(null)
        }}
        onConfirm={() => void confirmRemoval()}
      />
    </GamePageShell>
  )
}

function HintRejectionNotice() {
  const [open, setOpen] = useState(true)

  return (
    <ConfirmationDialog
      open={open}
      eyebrow="Hint update"
      title="Your hint was rejected"
      description="The host rejected your hint! You've been given a new board. If you're not sure why your hint was rejected, ask the host!"
      confirmLabel="Got it"
      onConfirm={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  )
}

const ROSTER_REORDER_MS = 260
const ROSTER_MOVE_TOLERANCE_PX = 0.5

type RosterEntryPosition = { left: number; top: number }

/* FLIP reorder: after React writes the new roster order, animate each
   card from its previous slot so score changes glide into place. The
   strip scrolls horizontally on desktop and vertically on mobile, so
   both axes are measured and animated. */
function useRosterReorder(orderKey: string) {
  const rosterRef = useRef<HTMLUListElement | null>(null)
  const scrollLeftRef = useRef(0)
  const entryRefs = useRef(new Map<string, HTMLLIElement>())
  const previousPositions = useRef(new Map<string, RosterEntryPosition>())
  const animations = useRef(new Map<string, Animation>())
  const refCache = useRef(
    new Map<string, (element: HTMLLIElement | null) => void>(),
  )

  useEffect(() => {
    const roster = rosterRef.current
    if (!roster) return
    const onScroll = () => {
      scrollLeftRef.current = roster.scrollLeft
    }
    roster.addEventListener('scroll', onScroll, { passive: true })
    return () => roster.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const roster = rosterRef.current
    if (!roster) return

    // Reorders can still drag the strip's scroll position along (scroll
    // anchoring, snap re-adjustment); pin it back to the last position
    // the player scrolled to before measuring.
    if (roster.scrollLeft !== scrollLeftRef.current) {
      roster.scrollLeft = scrollLeftRef.current
    }

    const rosterBounds = roster.getBoundingClientRect()
    const nextPositions = new Map<string, RosterEntryPosition>()
    for (const [playerId, element] of entryRefs.current) {
      const bounds = element.getBoundingClientRect()
      nextPositions.set(playerId, {
        left: bounds.left - rosterBounds.left + roster.scrollLeft,
        top: bounds.top - rosterBounds.top + roster.scrollTop,
      })
    }

    const reduceMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    for (const [playerId, element] of entryRefs.current) {
      const previous = previousPositions.current.get(playerId)
      const next = nextPositions.get(playerId)
      if (previous === undefined || next === undefined) continue
      const deltaX = previous.left - next.left
      const deltaY = previous.top - next.top
      if (
        reduceMotion ||
        typeof element.animate !== 'function' ||
        (Math.abs(deltaX) <= ROSTER_MOVE_TOLERANCE_PX &&
          Math.abs(deltaY) <= ROSTER_MOVE_TOLERANCE_PX)
      ) {
        continue
      }
      animations.current.get(playerId)?.cancel()
      const animation = element.animate(
        [{ translate: `${deltaX}px ${deltaY}px` }, { translate: '0 0' }],
        {
          duration: ROSTER_REORDER_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both',
        },
      )
      const clear = () => {
        if (animations.current.get(playerId) === animation) {
          animations.current.delete(playerId)
        }
      }
      animation.onfinish = clear
      animation.oncancel = clear
      animations.current.set(playerId, animation)
    }
    previousPositions.current = nextPositions
  }, [orderKey])

  useEffect(
    () => () => {
      for (const animation of animations.current.values()) animation.cancel()
      animations.current.clear()
    },
    [],
  )

  const cardRef = useCallback((playerId: string) => {
    let callback = refCache.current.get(playerId)
    if (!callback) {
      callback = (element) => {
        if (element) entryRefs.current.set(playerId, element)
        else entryRefs.current.delete(playerId)
      }
      refCache.current.set(playerId, callback)
    }
    return callback
  }, [])

  return { rosterRef, cardRef }
}

export function GuessingScreen({
  view,
  onClaimCard,
  onFinishGuessing,
  onRemovePlayer,
  onLeave,
  onAdvanceTurn,
  onShowScoreboard,
}: {
  view: GuessingView
  onClaimCard: (
    cardId: string,
    turnId: string,
  ) => Promise<CommandResult<{ kind: CardKind }>>
  onFinishGuessing: () => Promise<CommandResult>
  onRemovePlayer: (playerId: string) => Promise<CommandResult>
  onLeave?: () => Promise<CommandResult>
  onAdvanceTurn: () => Promise<CommandResult>
  onShowScoreboard?: () => Promise<CommandResult>
}) {
  const [busyCard, setBusyCard] = useState<string | null>(null)
  const [isFinishing, setIsFinishing] = useState(false)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [busyPlayer, setBusyPlayer] = useState<string | null>(null)
  const [removalTarget, setRemovalTarget] = useState<{
    playerId: string
    name: string
  } | null>(null)
  const [confirmAdvance, setConfirmAdvance] = useState(false)
  const [advanceError, setAdvanceError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [removalError, setRemovalError] = useState<string | null>(null)
  const fullyRevealed = view.board.every(
    ({ revealedKind }) => revealedKind !== null,
  )
  const players = view.scoreboard
    .filter(({ participation }) => participation === 'player')
    .sort(
      (left, right) =>
        (right.score ?? 0) - (left.score ?? 0) ||
        (left.position ?? Infinity) - (right.position ?? Infinity),
    )
  const { rosterRef, cardRef } = useRosterReorder(
    players.map(({ playerId }) => playerId).join('|'),
  )
  const spectators = view.members.filter(
    ({ participation }) => participation === 'spectator',
  )
  const canHostAct = view.isFinalTurn
    ? view.canViewScoreboard
    : view.canAdvanceTurn
  const unfinishedPickerCount = view.unfinishedPickerCount ?? 0

  const claim = async (cardId: string) => {
    setBusyCard(cardId)
    setFeedback(null)
    const result = await onClaimCard(cardId, view.turnId)
    setBusyCard(null)
    if (result.status !== 'success') return setFeedback(result.message)
    setFeedback(null)
  }

  const finish = async () => {
    setFeedback(null)
    setIsFinishing(true)
    const result = await onFinishGuessing()
    if (result.status !== 'success') setFeedback(result.message)
    setIsFinishing(false)
  }

  const performAdvance = async () => {
    setFeedback(null)
    setAdvanceError(null)
    setIsAdvancing(true)
    const result = await (view.isFinalTurn && onShowScoreboard
      ? onShowScoreboard()
      : onAdvanceTurn())
    if (result.status !== 'success') {
      setAdvanceError(result.message)
    } else setConfirmAdvance(false)
    setIsAdvancing(false)
  }

  const advance = () => {
    if (unfinishedPickerCount > 0) {
      setAdvanceError(null)
      setConfirmAdvance(true)
      return
    }
    void performAdvance()
  }

  const removePlayer = async (playerId: string, name: string) => {
    setRemovalError(null)
    setRemovalTarget({ playerId, name })
  }

  const confirmRemoval = async () => {
    if (!removalTarget) return
    const { playerId } = removalTarget
    setBusyPlayer(playerId)
    setRemovalError(null)
    const result = await onRemovePlayer(playerId)
    if (result.status !== 'success') setRemovalError(result.message)
    else setRemovalTarget(null)
    setBusyPlayer(null)
  }

  const leave = async () => {
    if (!onLeave) return
    setLeaveError(null)
    setIsLeaving(true)
    const result = await onLeave()
    if (result.status !== 'success') setLeaveError(result.message)
    setIsLeaving(false)
  }

  return (
    <GamePageShell>
      <HintDisplay
        hint={view.hint}
        count={view.hintNumber}
        label="Current hint"
      />

      <div className="game-layout game-board-layout">
        <section className="game-panel min-w-0">
          <div
            className="word-grid"
            aria-label={
              view.turnSettled
                ? 'Completed and fully revealed board'
                : fullyRevealed
                  ? 'Fully revealed board'
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

          {feedback || view.canMarkDone || view.player.role === 'host' ? (
            <div className="board-actions">
              {feedback ? (
                <p className="form-message m-0" role="alert">
                  {feedback}
                </p>
              ) : null}
              <div className="board-action-group">
                {view.canMarkDone ? (
                  <Button
                    variant="outline"
                    onClick={() => void finish()}
                    disabled={isFinishing}
                  >
                    {isFinishing ? 'Saving…' : 'I’m done guessing'}
                  </Button>
                ) : null}
                {view.player.role === 'host' ? (
                  <Button
                    onClick={advance}
                    disabled={isAdvancing || !canHostAct}
                    aria-describedby={
                      unfinishedPickerCount > 0
                        ? 'host-advance-warning'
                        : undefined
                    }
                  >
                    {isAdvancing
                      ? 'Advancing…'
                      : view.isFinalTurn
                        ? 'View scoreboard'
                        : 'Next hint'}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="game-sidebar game-sidebar-stack">
          <section className="game-panel">
            <h2 className="sidebar-title">Roster</h2>
            <ul className="roster-scroll" ref={rosterRef} aria-label="Roster">
              {players.map((player) => {
                const activeMember = view.members.find(
                  ({ playerId }) => playerId === player.playerId,
                )
                const turnState = view.turnPlayers.find(
                  ({ playerId }) => playerId === player.playerId,
                )?.state
                const status = !activeMember
                  ? 'No longer active'
                  : turnState === 'clue-giver'
                    ? 'Clue-giver'
                    : turnState === 'done'
                      ? 'Done this turn'
                      : 'Guessing'

                return (
                  <RosterCard
                    className="score-row"
                    ref={cardRef(player.playerId)}
                    key={player.playerId}
                    name={player.name}
                    detail={String(player.score)}
                    detailClassName="score-value"
                    detailLabel={`${player.name}'s score: ${player.score}`}
                    singleLine
                    status={status}
                    tone={
                      turnState === 'done' || turnState === 'clue-giver'
                        ? 'ready'
                        : 'default'
                    }
                  />
                )
              })}
              {spectators.map((spectator) => (
                <RosterCard
                  ref={cardRef(spectator.playerId)}
                  key={spectator.playerId}
                  name={spectator.name}
                  status="Spectating"
                  tone="spectating"
                />
              ))}
            </ul>
          </section>

          {view.player.role === 'host' ? (
            <HostControlCard>
              <OperationalHostNotice view={view} />
              {unfinishedPickerCount > 0 ? (
                <p
                  id="host-advance-warning"
                  role="status"
                  className="mt-1 text-sm text-[var(--muted-foreground)]"
                >
                  {unfinishedPickerCount}{' '}
                  {unfinishedPickerCount === 1 ? 'player is' : 'players are'}{' '}
                  still guessing. You can move on with confirmation.
                </p>
              ) : null}
              <ul className="host-player-controls" aria-label="Player controls">
                {players.map((player) => {
                  const activeMember = view.members.find(
                    ({ playerId }) => playerId === player.playerId,
                  )
                  if (!activeMember || activeMember.role === 'host') return null

                  return (
                    <li
                      className="host-player-control-row"
                      key={player.playerId}
                    >
                      <span className="truncate font-semibold">
                        {player.name}
                      </span>
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
                    </li>
                  )
                })}
              </ul>
              {!confirmAdvance && advanceError ? (
                <p className="action-error host-action-error" role="alert">
                  {advanceError}
                </p>
              ) : null}
            </HostControlCard>
          ) : null}
          {onLeave ? (
            <LeaveRoomControl
              busy={isLeaving}
              className="mt-0"
              confirmationRequired={
                view.player.role !== 'host' || view.members.length > 1
              }
              error={leaveError}
              gameInProgress
              isHost={view.player.role === 'host'}
              onConfirm={() => void leave()}
            />
          ) : null}
        </aside>
      </div>
      <ConfirmationDialog
        open={confirmAdvance}
        title="Move on from this board?"
        description={`${unfinishedPickerCount} ${unfinishedPickerCount === 1 ? 'player is' : 'players are'} still guessing. Are you sure you want to move on?`}
        cancelLabel="Cancel"
        confirmLabel="Move on"
        busy={isAdvancing}
        error={confirmAdvance ? advanceError : null}
        onCancel={() => {
          setAdvanceError(null)
          setConfirmAdvance(false)
        }}
        onConfirm={() => void performAdvance()}
      />
      <ConfirmationDialog
        open={removalTarget !== null}
        title={
          removalTarget ? `Remove ${removalTarget.name} from this game?` : ''
        }
        description={`${removalTarget?.name ?? 'This player'} will no longer be able to guess or rejoin this room. Their score and name will be removed from the game. Points already earned by other players and completed game history will remain. If their clue-giver turn has not happened yet, their submitted hint and board will be skipped.`}
        cancelLabel="Cancel"
        confirmLabel="Remove"
        busy={busyPlayer !== null}
        error={removalTarget ? removalError : null}
        onCancel={() => setRemovalTarget(null)}
        onConfirm={() => void confirmRemoval()}
      />
    </GamePageShell>
  )
}

function OperationalHostNotice({ view }: { view: HintingView | GuessingView }) {
  if (
    view.player.role !== 'host' ||
    view.player.participation !== 'spectator'
  ) {
    return null
  }

  return (
    <p className="operational-host-notice">
      You inherited operational host duties because no starting player remains
      available. You can move the game between phases, but spectator privacy and
      player-only actions remain unchanged.
    </p>
  )
}

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `−${Math.abs(score)}`
}

function RosterCard({
  name,
  detail = null,
  detailLabel,
  detailClassName,
  detailSuffix,
  singleLine = false,
  status,
  tone,
  className,
  ref,
}: {
  name: string
  detail?: string | null
  detailLabel?: string
  detailClassName?: string
  detailSuffix?: string
  singleLine?: boolean
  status: string
  tone: 'default' | 'ready' | 'spectating'
  className?: string
  ref?: Ref<HTMLLIElement>
}) {
  return (
    <li ref={ref} className={cn('roster-card', className)}>
      <PlayerSummary
        name={name}
        detail={detail}
        detailLabel={detailLabel}
        detailClassName={detailClassName}
        detailSuffix={detailSuffix}
        singleLine={singleLine}
      />
      <span
        className={cn(
          'status-dot-label',
          tone === 'ready' && 'is-ready',
          tone === 'spectating' && 'is-spectating',
        )}
      >
        <span className="status-dot" />
        {status}
      </span>
    </li>
  )
}

function PlayerSummary({
  name,
  detail = null,
  detailLabel,
  detailClassName,
  detailSuffix,
  singleLine = false,
  className,
}: {
  name: string
  detail?: string | null
  detailLabel?: string
  detailClassName?: string
  detailSuffix?: string
  singleLine?: boolean
  className?: string
}) {
  const primaryText = detail
    ? `${name} · ${detail}${detailSuffix ? ` ${detailSuffix}` : ''}`
    : name

  return (
    <p
      className={cn(
        'roster-card-primary',
        !detail && 'roster-card-primary-alone',
        singleLine && 'roster-card-primary-single-line',
        className,
      )}
      title={primaryText}
    >
      {singleLine && detail ? (
        <>
          <span className="roster-card-name roster-card-name-single-line">
            {name}
          </span>
          <span className="roster-card-inline-detail">
            <span className="roster-card-separator" aria-hidden="true">
              ·
            </span>
            <span
              className={cn('roster-card-detail', detailClassName)}
              aria-label={detailLabel}
            >
              {detail}
            </span>
          </span>
        </>
      ) : (
        <span className="roster-card-copy">
          <span className="roster-card-name">{name}</span>
          {detail ? (
            <>
              <span className="roster-card-separator" aria-hidden="true">
                ·
              </span>
              <span
                className={cn('roster-card-detail', detailClassName)}
                aria-label={detailLabel}
              >
                {detail}
              </span>
            </>
          ) : null}
          {/* Inline so the count trails the hint text when it wraps. */}
          {detailSuffix ? (
            <span className="roster-card-suffix">{detailSuffix}</span>
          ) : null}
        </span>
      )}
    </p>
  )
}

function HintDisplay({
  hint,
  count,
  label,
  live = false,
}: {
  hint: string
  count: number
  label: string
  live?: boolean
}) {
  const displayHint = hint.trim()

  return (
    <section
      className="hint-display"
      aria-label={label}
      aria-live={live ? 'polite' : undefined}
    >
      <p
        className={cn(
          'hint-display-text',
          !displayHint && 'hint-preview-placeholder',
        )}
      >
        <span>{displayHint || 'your hint'}</span>{' '}
        <span className="hint-number-value">{count}</span>
      </p>
    </section>
  )
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
        isSingleWord && longestSegment >= 9 && 'word-card-word-compact',
        isSingleWord && longestSegment >= 12 && 'word-card-word-wide',
        longestSegment >= 18 && 'word-card-word-break',
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

export function FinishedScreen({
  results,
  onReturnToLobby,
}: {
  results: CompletedGameResults
  onReturnToLobby: () => void
}) {
  const players = [...results.scoreboard]
    .filter(({ participation }) => participation === 'player')
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
  const ranks = getDenseRanks(players.map(({ score }) => score))
  const winnerNames = results.winners.map(({ name }) => name).join(' & ')
  const hasWinner = results.winners.length > 0

  return (
    <GamePageShell>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-center text-4xl leading-[1.05] font-bold tracking-[-0.04em] text-balance sm:text-5xl">
          {hasWinner
            ? `${winnerNames} ${results.winners.length === 1 ? 'wins' : 'win'}`
            : 'No winner'}
          <span className="text-accent">.</span>
        </h1>
        <section className="game-panel">
          <h2 className="sidebar-title">Final standings</h2>
          {players.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">
              No players remain in the final standings.
            </p>
          ) : (
            <ol className="mt-4 grid gap-2">
              {players.map((player, index) => {
                const place = ranks[index]
                const medal = ['🥇', '🥈', '🥉'][place - 1]
                const placeName = ['First', 'Second', 'Third'][place - 1]
                const placeLabel = medal
                  ? `${placeName} place`
                  : `Place ${place}`
                return (
                  <li
                    className={cn(
                      'score-row',
                      place === 1 && 'score-row-winner',
                    )}
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
          )}
          <Button className="mt-4 w-full" onClick={onReturnToLobby}>
            Return to lobby
          </Button>
        </section>
      </div>
    </GamePageShell>
  )
}

function GamePageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="game-page min-h-screen px-4 py-5 sm:px-7 sm:py-7 lg:px-10">
      <div className="mx-auto max-w-[90rem]">{children}</div>
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
