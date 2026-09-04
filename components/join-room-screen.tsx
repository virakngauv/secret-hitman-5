'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { BrandEyebrow } from '@/components/brand-eyebrow'
import { JoinRoomForm, type JoinedRoom } from '@/components/join-room-form'
import { Button } from '@/components/ui/button'

export function JoinRoomScreen({
  roomCode,
  joinsAsSpectator = false,
  onJoined,
}: {
  roomCode?: string
  joinsAsSpectator?: boolean
  onJoined?: (room: JoinedRoom) => void
}) {
  const router = useRouter()
  const handleJoined =
    onJoined ?? ((room: JoinedRoom) => router.push(`/${room.roomCode}`))

  return (
    <main className="flex min-h-screen items-center px-5 py-10 sm:px-8">
      <section className="bg-card mx-auto w-full max-w-lg rounded-[2rem] border p-7 shadow-sm sm:p-10">
        <BrandEyebrow />
        <h1 className="text-center text-4xl leading-[1.05] font-bold tracking-[-0.04em] text-balance sm:text-5xl">
          {joinsAsSpectator ? 'join as a spectator' : 'join a room'}
          <span className="text-accent">.</span>
        </h1>
        {joinsAsSpectator ? (
          <p className="mt-3 text-center text-sm text-[var(--muted-foreground)]">
            You can watch the full round, but you won’t give hints, guess, or
            enter the scorecard.
          </p>
        ) : null}
        <JoinRoomForm roomCode={roomCode} onJoined={handleJoined} />
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link href="/home">Back to home</Link>
        </Button>
      </section>
    </main>
  )
}
