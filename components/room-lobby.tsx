'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

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
import {
  isMemberSnapshot,
  MAX_STARTING_PLAYERS,
  type RoomSnapshot,
} from '@/lib/game-protocol'
import { generateClientToken } from '@/lib/player-session'

type LobbyView = Extract<RoomSnapshot, { status: 'lobby' }>

export function RoomLobby({ roomCode }: { roomCode: string }) {
  const channel = useRoomSnapshot(roomCode)
  const game = useGameSocket()
  const router = useRouter()
  const [actionError, setActionError] = useState<string | null>(null)
  const [isActing, setIsActing] = useState(false)
  const { snapshot, endedReason, connectionStatus } = channel

  if (endedReason) {
    return <RoomMessage title="This room ended" body={endedCopy(endedReason)} />
  }
  if (!snapshot) return <RoomLoading />
  if (connectionStatus !== 'connected' && isMemberSnapshot(snapshot)) {
    return (
      <RoomMessage
        title="Reconnecting"
        body="Restoring your seat and the latest board…"
      />
    )
  }

  switch (snapshot.status) {
    case 'not_found':
      return (
        <RoomMessage
          title="Room not found"
          body={`There is no active room named ${roomCode.toUpperCase()}.`}
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
      return (
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
        />
      )
    case 'hinting':
      return (
        <HintPhaseScreen
          view={snapshot}
          onSubmitHint={(hint, targetCardIds) =>
            game.submitHint({ roomCode, hint, targetCardIds })
          }
          onStartGuessing={() => game.startGuessing(roomCode)}
        />
      )
    case 'guessing':
      return (
        <GuessingScreen
          view={snapshot}
          onClaimCard={(cardId, revision) =>
            game.claimCard({
              roomCode,
              revision,
              cardId,
              commandId: crypto.randomUUID?.() ?? generateClientToken(),
            })
          }
          onFinishGuessing={() => game.finishGuessing(roomCode)}
          onAdvanceTurn={() => game.advanceTurn(roomCode)}
        />
      )
    case 'finished':
      return <FinishedScreen view={snapshot} />
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
          <section>
            <p className="page-eyebrow">One round · No timers</p>
            <h1 className="page-title">Assemble the room.</h1>
            <p className="page-subtitle max-w-xl">
              Everyone who is here when the host starts will make one hint. Late
              arrivals can still watch as spectators.
            </p>
            <div className="mt-8 max-w-lg">
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
                      onClick={() => void onRemove(member.playerId)}
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
                {isActing ? 'Starting…' : 'Start the single round'}
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

function RoomMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="game-panel w-full max-w-lg text-center">
        <span className="waiting-reticle" aria-hidden="true">
          ⌖
        </span>
        <h1 className="mt-5 text-4xl font-black tracking-tight">{title}</h1>
        <p className="mt-3 text-[var(--muted-foreground)]">{body}</p>
        <Button asChild className="mt-7">
          <Link href="/home">Back to home</Link>
        </Button>
      </section>
    </main>
  )
}

function endedCopy(reason: 'expired' | 'removed' | 'server_restart') {
  if (reason === 'expired')
    return 'The room expired after a period without game activity.'
  if (reason === 'removed')
    return 'The host removed this browser from the room.'
  return 'The game server restarted, so this in-memory room is no longer available.'
}

function assertNever(value: never): never {
  throw new Error(`Unexpected room state: ${JSON.stringify(value)}`)
}
