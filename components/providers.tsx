'use client'

import { ClerkProvider } from '@clerk/nextjs'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect, type ReactNode } from 'react'

import { GameSocketProvider } from '@/components/game-socket-provider'
import { PlayerSessionProvider } from '@/components/player-session-provider'

export function Providers({ children }: { children: ReactNode }) {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const posthogHost =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

  useEffect(() => {
    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        defaults: '2025-11-30',
        capture_pageview: true,
      })
    }
  }, [posthogHost, posthogKey])

  let content = (
    <PlayerSessionProvider>
      <GameSocketProvider>{children}</GameSocketProvider>
    </PlayerSessionProvider>
  )

  if (posthogKey) {
    content = <PostHogProvider client={posthog}>{content}</PostHogProvider>
  }

  if (clerkKey) {
    content = <ClerkProvider publishableKey={clerkKey}>{content}</ClerkProvider>
  }

  return content
}
