'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  FinishedScreen,
  GuessingScreen,
  HintPhaseScreen,
} from '@/components/game-screen'
import {
  useGameSocket,
  useRoomSnapshot,
} from '@/components/game-socket-provider'
import { JoinRoomScreen } from '@/components/join-room-screen'
import {
  RoomInviteActions,
  RoomInviteCard,
} from '@/components/room-invite-card'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { MAX_STARTING_PLAYERS, type RoomSnapshot } from '@/lib/game-protocol'
import { generateClientToken } from '@/lib/player-session'

type LobbyView = Extract<RoomSnapshot, { status: 'lobby' }>

export function RoomLobby({ roomCode }: { roomCode: string }) {
  const channel = useRoomSnapshot(roomCode)
  const game = useGameSocket()
  const router = useRouter()
  const [actionError, setActionError] = useState<string | null>(null)
  const [isActing, setIsActing] = useState(false)
  const { snapshot, connectionStatus } = channel
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
    case 'lobby':
      return retainScreen(
        <LobbyScreen
          view={snapshot}
          error={actionError}
          isActing={isActing}
          onStart={async () => {
            setIsActing(true)
            setActionError(null)
            const result = await game.startGame(roomCode)
            if (result.status !== 'success') setActionError(result.message)
            setIsActing(false)
          }}
          onLeave={async () => {
            setIsActing(true)
            setActionError(null)
            const result = await game.leaveRoom(roomCode)
            if (result.status === 'success') router.push('/home')
            else {
              setActionError(result.message)
              setIsActing(false)
            }
          }}
          onRemove={async (playerId) => {
            setActionError(null)
            const result = await game.removePlayer(roomCode, playerId)
            if (result.status !== 'success') setActionError(result.message)
          }}
        />,
      )
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
          onRemovePlayer={(playerId, allowRoundReset) =>
            game.removePlayer(roomCode, playerId, allowRoundReset)
          }
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
    case 'finished':
      return retainScreen(
        <FinishedScreen
          view={snapshot}
          onReturnToLobby={() =>
            game.returnToLobby({ roomCode, gameId: snapshot.gameId })
          }
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
  onStart,
  onLeave,
  onRemove,
}: {
  view: LobbyView
  error: string | null
  isActing: boolean
  onStart: () => Promise<void>
  onLeave: () => Promise<void>
  onRemove: (playerId: string) => Promise<void>
}) {
  const isHost = view.player.role === 'host'
  const canStart = view.members.length >= view.minimumPlayers
  const missingPlayers = view.minimumPlayers - view.members.length
  const [removalTarget, setRemovalTarget] = useState<{
    playerId: string
    name: string
  } | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [roundResetNoticeDismissed, setRoundResetNoticeDismissed] =
    useState(false)

  const confirmRemoval = async () => {
    if (!removalTarget) return
    setIsRemoving(true)
    await onRemove(removalTarget.playerId)
    setIsRemoving(false)
    setRemovalTarget(null)
  }

  return (
    <main className="min-h-screen px-4 py-7 sm:px-7 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="game-topbar">
          <Link className="brand-mark" href="/home">
            <span className="brand-sight" aria-hidden="true">
              ⌖
            </span>
            <span>SECRET HITMAN</span>
          </Link>
          <span className="phase-count">LOBBY</span>
        </header>

        <div className="lobby-grid">
          <section className="min-w-0">
            <h1 className="page-title text-center">Assemble the room.</h1>
            <div className="mx-auto w-full max-w-lg">
              <RoomInviteCard roomCode={view.roomCode} />
              <RoomInviteActions roomCode={view.roomCode} />
            </div>
          </section>

          <section className="game-panel">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="sidebar-title">Players</h2>
              <span className="phase-count">
                {view.members.length}/{MAX_STARTING_PLAYERS}
              </span>
            </div>
            <ul className="mt-5 grid gap-2">
              {view.members.map((member, index) => (
                <li className="lobby-player" key={member.playerId}>
                  <span className="player-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold">
                    {member.name}
                  </span>
                  <span className="player-role">
                    {member.playerId === view.player.playerId
                      ? member.role === 'host'
                        ? 'YOU · HOST'
                        : 'YOU'
                      : member.role === 'host'
                        ? 'HOST'
                        : 'PLAYER'}
                  </span>
                  {isHost && member.role !== 'host' ? (
                    <button
                      type="button"
                      className="remove-player"
                      onClick={() =>
                        setRemovalTarget({
                          playerId: member.playerId,
                          name: member.name,
                        })
                      }
                      aria-label={`Remove ${member.name}`}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            <p className="form-message" role={error ? 'alert' : 'status'}>
              {error ??
                (canStart
                  ? 'Ready when the host is.'
                  : `Invite at least ${missingPlayers} more ${missingPlayers === 1 ? 'player' : 'players'}.`)}
            </p>

            {isHost ? (
              <Button
                className="mt-2 h-12 w-full"
                disabled={!canStart || isActing}
                onClick={() => void onStart()}
              >
                {isActing ? 'Starting…' : 'Start game'}
              </Button>
            ) : (
              <div className="waiting-host">Waiting for the host to start</div>
            )}
            <Button
              variant="outline"
              className="mt-3 w-full"
              disabled={isActing}
              onClick={() => void onLeave()}
            >
              Leave room
            </Button>
          </section>
        </div>
        <ConfirmationDialog
          open={
            view.lobbyNotice === 'player_left' && !roundResetNoticeDismissed
          }
          eyebrow="Round update"
          title="The round ended early"
          description="Another player left, leaving fewer than two players in the game. The current round was ended and everyone remaining was returned to the lobby. Invite another player to start a new game."
          confirmLabel="Return to lobby"
          onCancel={() => {}}
          onConfirm={() => setRoundResetNoticeDismissed(true)}
        />
        <ConfirmationDialog
          open={removalTarget !== null}
          title={removalTarget ? `Remove ${removalTarget.name}?` : ''}
          description={`${removalTarget?.name ?? 'This player'} will leave the lobby and will not be able to rejoin this room.`}
          cancelLabel="Cancel"
          confirmLabel="Remove"
          busy={isRemoving}
          onCancel={() => setRemovalTarget(null)}
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
