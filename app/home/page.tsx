import type { Metadata } from 'next'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Secret Hitman',
  description: 'Create a Secret Hitman room or join your friends.',
}

export default function HomePage() {
  return (
    <main className="home-stage">
      <div className="home-noise" aria-hidden="true" />
      <div className="home-reticle home-reticle-one" aria-hidden="true">
        ⌖
      </div>
      <div className="home-reticle home-reticle-two" aria-hidden="true">
        ⌖
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        <p className="page-eyebrow">A social word game · One decisive round</p>
        <section className="home-card">
          <div>
            <span className="brand-sight home-brand-sight" aria-hidden="true">
              ⌖
            </span>
            <h1 className="home-title" aria-label="Secret Hitman">
              SECRET
              <br />
              HITMAN
            </h1>
            <p className="home-deck">
              Build a clue from twelve words. Avoid the frozen assassin. Then
              take your shot—at the host’s pace, with no timer.
            </p>
          </div>
          <div className="home-actions">
            <p className="home-action-label">Choose your entry</p>
            <div className="grid gap-3">
              <Button asChild className="h-12 w-full text-base">
                <Link href="/create">Create a room</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 w-full text-base"
              >
                <Link href="/join">Join a room</Link>
              </Button>
            </div>
            <div className="home-rules">
              <span>12 WORDS</span>
              <span>1 ASSASSIN</span>
              <span>1 ROUND</span>
              <span>0 TIMERS</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
