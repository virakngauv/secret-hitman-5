'use client'

import { useState, useSyncExternalStore } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { Button } from '@/components/ui/button'

type CopyState = 'idle' | 'copied' | 'error'

const subscribeToNothing = () => () => {}

/** Resolves the page origin client-side without touching window during render. */
function usePageOrigin() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => null,
  )
}

/** Resolves the canonical invite URL once the client origin is available. */
function useInviteUrl(roomCode: string) {
  const origin = usePageOrigin()

  return origin === null ? null : `${origin}/${encodeURIComponent(roomCode)}`
}

/** Presents the room code beside a scannable QR code of the invite URL. */
export function RoomInviteCard({ roomCode }: { roomCode: string }) {
  const inviteUrl = useInviteUrl(roomCode)

  return (
    <div className="mt-8 flex flex-col items-center gap-5 sm:flex-row sm:items-stretch sm:justify-center">
      <output
        aria-label={`Room code ${roomCode}`}
        className="bg-foreground text-background flex min-h-24 items-center justify-center rounded-2xl px-8 py-6 font-mono text-3xl font-bold tracking-[0.22em] uppercase sm:text-4xl"
      >
        {roomCode}
      </output>
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center justify-center rounded-2xl border bg-white p-2 shadow-sm">
          {inviteUrl ? (
            <QRCodeSVG
              value={inviteUrl}
              role="img"
              aria-label={`Scan to join room ${roomCode}`}
              data-testid="invite-qr"
              data-invite-url={inviteUrl}
              className="size-48"
            />
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs font-bold tracking-[0.12em] uppercase">
          Scan to join
        </p>
      </div>
    </div>
  )
}

/** Copies the invite URL to the clipboard with announced success/failure. */
export function RoomInviteActions({ roomCode }: { roomCode: string }) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const inviteUrl = useInviteUrl(roomCode)

  const copyInviteLink = async () => {
    if (!inviteUrl) {
      return
    }

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={!inviteUrl}
          onClick={copyInviteLink}
        >
          {copyState === 'copied' ? 'Copied ✓' : 'Copy invite link'}
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className="text-muted-foreground mt-2 min-h-5 text-center text-sm"
      >
        {copyState === 'copied'
          ? `Invite link copied: ${inviteUrl}`
          : copyState === 'error'
            ? `Copy failed. Share this link instead: ${inviteUrl}`
            : ''}
      </p>
    </div>
  )
}
