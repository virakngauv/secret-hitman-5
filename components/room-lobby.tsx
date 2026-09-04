'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  FinishedScreen,
  GuessingScreen,
  HintPhaseScreen,
} from '@/components/game-screen'
import { BrandEyebrow } from '@/components/brand-eyebrow'
import { HostControlCard } from '@/components/host-control-card'
import {
  useGameSocket,
  useRoomSnapshot,
} from '@/components/game-socket-provider'
import { JoinRoomScreen } from '@/components/join-room-screen'
import { LeaveRoomControl } from '@/components/leave-room-control'
import {
  RoomInviteActions,
  RoomInviteCard,
} from '@/components/room-invite-card'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import type { CommandResult, RoomSnapshot } from '@/lib/game-protocol'
import {
  dismissGameResults,
  generateClientToken,
  hasDismissedGameResults,
} from '@/lib/player-session'

type LobbyView = Extract<RoomSnapshot, { status: 'lobby' }>

export function RoomLobby({ roomCode }: { roomCode: string }) {
  const channel = useRoomSnapshot(roomCode)
  const game = useGameSocket()
  const router = useRouter()
  const [actionError, setActionError] = useState<{
    action: 'start' | 'leave'
    message: string
  } | null>(null)
  const [isActing, setIsActing] = useState(false)
  const [dismissedResultsGameId, setDismissedResultsGameId] = useState<
    string | null
  >(null)
  const { snapshot, connectionStatus } = channel
  const [roundTransition, setRoundTransition] = useState<{
    snapshot: RoomSnapshot | null
    inferredRoundEndedEarly: boolean
    suppressInference: boolean
  }>({
    snapshot: null,
    inferredRoundEndedEarly: false,
    suppressInference: false,
  })

  if (snapshot !== roundTransition.snapshot) {
    const previousSnapshot = roundTransition.snapshot
    const inferredRoundEndedEarly =
      snapshot?.status === 'lobby' &&
      snapshot.lastGameResults === undefined &&
      (previousSnapshot?.status === 'hinting' ||
        previousSnapshot?.status === 'guessing') &&
      previousSnapshot.members.length > snapshot.members.length &&
      !roundTransition.suppressInference
    setRoundTransition({
      snapshot,
      inferredRoundEndedEarly,
      suppressInference:
        snapshot?.status === 'lobby'
          ? false
          : roundTransition.suppressInference,
    })
  }

  const showRoundEndedEarly =
    snapshot?.status === 'lobby' &&
    snapshot.lastGameResults === undefined &&
    (snapshot.lobbyNotice === 'player_left' ||
      roundTransition.inferredRoundEndedEarly)

  if (!snapshot) return <RoomLoading />

  const retainScreen = (screen: ReactNode) => (
    <RoomConnectionBoundary connectionStatus={connectionStatus}>
      {screen}
    </RoomConnectionBoundary>
  )

  switch (snapshot.status) {
    case 'not_found':
      return (
        <RoomMessage
          title="Room not found"
          body={`There is no active room named ${roomCode.toUpperCase()}.`}
          showRoomRecovery
        />
      )
    case 'expired':
      return (
        <RoomMessage
          title="This room ended"
          body="The room expired after a period without game activity."
          showRoomRecovery
        />
      )
    case 'removed_from_room':
      return (
        <RoomMessage
          title="You were removed"
          body="The host removed this browser from the room."
        />
      )
    case 'joinable':
      return (
        <JoinRoomScreen
          roomCode={snapshot.roomCode}
          joinsAsSpectator={snapshot.joinsAsSpectator}
          onJoined={() => {}}
        />
      )
    case 'lobby': {
      const results = snapshot.lastGameResults
      const showResults =
        results !== undefined &&
        dismissedResultsGameId !== results.gameId &&
        !hasDismissedGameResults(results.gameId)

      if (results && showResults) {
        return retainScreen(
          <FinishedScreen
            results={results}
            onReturnToLobby={() => {
              dismissGameResults(results.gameId)
              setDismissedResultsGameId(results.gameId)
            }}
          />,
        )
      }

      return retainScreen(
        <LobbyScreen
          view={snapshot}
          error={actionError}
          isActing={isActing}
          showRoundEndedEarly={showRoundEndedEarly}
          onStart={async () => {
            setIsActing(true)
            setActionError(null)
            const result = await game.startGame(roomCode)
            if (result.status !== 'success') {
              setActionError({ action: 'start', message: result.message })
            }
            setIsActing(false)
            return result
          }}
          onLeave={async () => {
            setIsActing(true)
            setActionError(null)
            const result = await game.leaveRoom(roomCode)
            if (result.status === 'success') router.push('/home')
            else {
              setActionError({ action: 'leave', message: result.message })
              setIsActing(false)
            }
            return result
          }}
          onRemove={(playerId) => {
            setActionError(null)
            return game.removePlayer(roomCode, playerId)
          }}
        />,
      )
    }
    case 'hinting':
      return retainScreen(
        <HintPhaseScreen
          key={snapshot.board?.[0]?.id ?? 'spectator'}
          view={snapshot}
          onSubmitHint={(hint, targetCardIds) =>
            game.submitHint({
              roomCode,
              gameId: snapshot.gameId,
              hint,
              targetCardIds,
            })
          }
          onUnlockHint={() =>
            game.unlockHint({ roomCode, gameId: snapshot.gameId })
          }
          onStartGuessing={() =>
            game.startGuessing({ roomCode, gameId: snapshot.gameId })
          }
          onRejectHint={(playerId) =>
            game.rejectHint({
              roomCode,
              gameId: snapshot.gameId,
              playerId,
            })
          }
          onRemovePlayer={async (playerId, allowRoundReset) => {
            if (allowRoundReset) {
              setRoundTransition((current) => ({
                ...current,
                suppressInference: true,
              }))
            }
            const result = await game.removePlayer(
              roomCode,
              playerId,
              allowRoundReset,
            )
            if (result.status !== 'success') {
              setRoundTransition((current) => ({
                ...current,
                suppressInference: false,
              }))
            }
            return result
          }}
          onLeave={async () => {
            const result = await game.leaveRoom(roomCode)
            if (result.status === 'success') router.push('/home')
            return result
          }}
        />,
      )
    case 'guessing':
      return retainScreen(
        <GuessingScreen
          key={snapshot.turnId}
          view={snapshot}
          onClaimCard={(cardId, turnId) =>
            game.claimCard({
              roomCode,
              gameId: snapshot.gameId,
              turnId,
              cardId,
              commandId: crypto.randomUUID?.() ?? generateClientToken(),
            })
          }
          onFinishGuessing={() =>
            game.finishGuessing({
              roomCode,
              gameId: snapshot.gameId,
              turnId: snapshot.turnId,
            })
          }
          onAdvanceTurn={() =>
            game.advanceTurn({
              roomCode,
              gameId: snapshot.gameId,
              turnId: snapshot.turnId,
            })
          }
          onShowScoreboard={() =>
            game.showScoreboard({
              roomCode,
              gameId: snapshot.gameId,
              turnId: snapshot.turnId,
            })
          }
          onRemovePlayer={(playerId) => game.removePlayer(roomCode, playerId)}
          onLeave={async () => {
            const result = await game.leaveRoom(roomCode)
            if (result.status === 'success') router.push('/home')
            return result
          }}
        />,
      )
    default:
      return assertNever(snapshot)
  }
}

function LobbyScreen({
  view,
  error,
  isActing,
  showRoundEndedEarly,
  onStart,
  onLeave,
  onRemove,
}: {
  view: LobbyView
  error: { action: 'start' | 'leave'; message: string } | null
  isActing: boolean
  showRoundEndedEarly: boolean
  onStart: () => Promise<CommandResult>
  onLeave: () => Promise<CommandResult>
  onRemove: (playerId: string) => Promise<CommandResult>
}) {
  const isHost = view.player.role === 'host'
  const removableMembers = view.members.filter(
    (member) => member.role !== 'host',
  )
  const canStart = view.members.length >= view.minimumPlayers
  const missingPlayers = view.minimumPlayers - view.members.length
  const [removalTarget, setRemovalTarget] = useState<{
    playerId: string
    name: string
  } | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removalError, setRemovalError] = useState<string | null>(null)
  const [roundResetNotice, setRoundResetNotice] = useState({
    active: showRoundEndedEarly,
    dismissed: false,
  })
  if (roundResetNotice.active !== showRoundEndedEarly) {
    setRoundResetNotice({ active: showRoundEndedEarly, dismissed: false })
  }

  const confirmRemoval = async () => {
    if (!removalTarget) return
    setIsRemoving(true)
    setRemovalError(null)
    const result = await onRemove(removalTarget.playerId)
    setIsRemoving(false)
    if (result.status === 'success') setRemovalTarget(null)
    else setRemovalError(result.message)
  }

  return (
    <main className="game-page flex min-h-screen items-center">
      <div className="game-sidebar-stack mx-auto w-full max-w-xl">
        <section className="game-panel">
          <BrandEyebrow />
          <h1 className="text-center text-4xl leading-[1.05] font-bold tracking-[-0.04em] text-balance sm:text-5xl">
            lobby<span className="text-accent">.</span>
          </h1>
          <RoomInviteCard roomCode={view.roomCode} />
          <RoomInviteActions roomCode={view.roomCode} />
        </section>

        <section className="game-panel">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight">
              In this room
            </h2>
            <span className="text-muted-foreground text-sm">
              {view.members.length}{' '}
              {view.members.length === 1 ? 'player' : 'players'}
            </span>
          </div>
          <ul className="mt-4 grid gap-2" aria-label="Players in this room">
            {view.members.map((member) => (
              <li
                className="bg-background flex items-center justify-between gap-4 rounded-xl border px-4 py-3"
                key={member.playerId}
              >
                <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
                  {member.name}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs font-bold tracking-[0.12em] uppercase">
                  {member.playerId === view.player.playerId
                    ? member.role === 'host'
                      ? 'You · Host'
                      : 'You'
                    : member.role === 'host'
                      ? 'Host'
                      : 'Player'}
                </span>
              </li>
            ))}
          </ul>

          {isHost ? (
            <>
              {!canStart ? (
                <p className="form-message" role="status">
                  Invite at least {missingPlayers} more{' '}
                  {missingPlayers === 1 ? 'player' : 'players'}.
                </p>
              ) : null}
              {error?.action === 'start' ? (
                <p className="action-error host-action-error" role="alert">
                  {error.message}
                </p>
              ) : null}
              <Button
                className="mt-4 h-12 w-full"
                disabled={!canStart || isActing}
                onClick={() => void onStart()}
              >
                {isActing ? 'Starting…' : 'Start game'}
              </Button>
            </>
          ) : null}
        </section>

        {isHost && removableMembers.length > 0 ? (
          <HostControlCard>
            {removableMembers.length > 0 ? (
              <ul className="host-player-controls" aria-label="Player controls">
                {removableMembers.map((member) => (
                  <li className="host-player-control-row" key={member.playerId}>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {member.name}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-3 text-xs"
                      disabled={isRemoving}
                      onClick={() => {
                        setRemovalError(null)
                        setRemovalTarget({
                          playerId: member.playerId,
                          name: member.name,
                        })
                      }}
                      aria-label={`Remove ${member.name}`}
                    >
                      Remove player
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </HostControlCard>
        ) : null}
        <LeaveRoomControl
          busy={isActing}
          className="mt-0"
          confirmationRequired={!isHost || view.members.length > 1}
          error={error?.action === 'leave' ? error.message : null}
          gameInProgress={false}
          isHost={isHost}
          onConfirm={() => void onLeave()}
        />
        <ConfirmationDialog
          open={showRoundEndedEarly && !roundResetNotice.dismissed}
          eyebrow="Round update"
          title="The round ended early"
          description="Another player left, leaving fewer than two players in the game. The current round was ended and everyone remaining was returned to the lobby. Invite another player to start a new game."
          confirmLabel="Return to lobby"
          onCancel={() => {}}
          onConfirm={() =>
            setRoundResetNotice((current) => ({
              ...current,
              dismissed: true,
            }))
          }
        />
        <ConfirmationDialog
          open={removalTarget !== null}
          title={removalTarget ? `Remove ${removalTarget.name}?` : ''}
          description={`${removalTarget?.name ?? 'This player'} will leave the lobby and will not be able to rejoin this room.`}
          cancelLabel="Cancel"
          confirmLabel="Remove"
          busy={isRemoving}
          error={removalError}
          onCancel={() => {
            setRemovalError(null)
            setRemovalTarget(null)
          }}
          onConfirm={() => void confirmRemoval()}
        />
      </div>
    </main>
  )
}

function RoomLoading() {
  return (
    <main
      className="flex min-h-screen items-center justify-center p-6"
      aria-busy="true"
    >
      <div className="waiting-card w-full max-w-lg">
        <span className="waiting-reticle animate-pulse" aria-hidden="true">
          ⌖
        </span>
        <p className="mt-5 font-bold">Checking the room…</p>
      </div>
    </main>
  )
}

function RoomConnectionBoundary({
  children,
  connectionStatus,
}: {
  children: ReactNode
  connectionStatus: 'connecting' | 'connected' | 'disconnected'
}) {
  const reconnecting = connectionStatus !== 'connected'
  const interruptedRef = useRef(false)
  const liveRegionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (connectionStatus === 'disconnected') {
      interruptedRef.current = true
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent =
          'Connection interrupted. Reconnecting; room details may be out of date.'
      }
    } else if (
      connectionStatus === 'connected' &&
      interruptedRef.current &&
      liveRegionRef.current
    ) {
      interruptedRef.current = false
      liveRegionRef.current.textContent =
        'Connection restored. Room details are up to date.'
    }
  }, [connectionStatus])

  return (
    <>
      <fieldset
        className="m-0 min-w-0 border-0 p-0"
        disabled={reconnecting}
        aria-describedby="room-connection-status"
      >
        {children}
      </fieldset>
      <div
        ref={liveRegionRef}
        id="room-connection-status"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      />
      {reconnecting ? (
        <div
          className="pointer-events-none fixed right-4 bottom-4 z-50 max-w-[calc(100vw-2rem)] rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-bold shadow-lg"
          aria-hidden="true"
        >
          Reconnecting · updates may be delayed
        </div>
      ) : null}
    </>
  )
}

function RoomMessage({
  title,
  body,
  showRoomRecovery = false,
}: {
  title: string
  body: string
  showRoomRecovery?: boolean
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="game-panel w-full max-w-lg text-center">
        <span className="waiting-reticle" aria-hidden="true">
          ⌖
        </span>
        <h1 className="mt-5 text-4xl font-black tracking-tight">{title}</h1>
        <p className="mt-3 text-[var(--muted-foreground)]">{body}</p>
        <div
          className={`mt-7 grid gap-3 ${
            showRoomRecovery ? 'sm:grid-cols-2' : 'mx-auto max-w-xs'
          }`}
        >
          <Button asChild>
            <Link href="/home">Back to home</Link>
          </Button>
          {showRoomRecovery ? (
            <Button asChild variant="outline">
              <Link href="/create">Create a room</Link>
            </Button>
          ) : null}
        </div>
        {showRoomRecovery ? (
          <Button asChild variant="outline" className="mt-3 w-full">
            <Link href="/join">Join another room</Link>
          </Button>
        ) : null}
      </section>
    </main>
  )
}

function assertNever(value: never): never {
  throw new Error(`Unexpected room state: ${JSON.stringify(value)}`)
}
