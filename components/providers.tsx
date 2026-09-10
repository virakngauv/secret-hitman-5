'use client'

import { WordPacksFeatureContext } from './word-packs-feature'
import { WordPackShopProvider } from './word-pack-shop'
import type { PackSummary } from '@/lib/game-protocol'
import { AccountBridge } from './account-bridge'
import { ui } from '@clerk/ui'
import { shadcn } from '@clerk/ui/themes'
import { ClerkProvider } from '@clerk/nextjs'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect, type ReactNode } from 'react'

import { GameSocketProvider } from '@/components/game-socket-provider'
import { PlayerSessionProvider } from '@/components/player-session-provider'

export function Providers({
  children,
  clerkEnabled = false,
  packs = [],
  wordPacksEnabled = false,
}: {
  children: ReactNode
  clerkEnabled?: boolean
  packs?: PackSummary[]
  wordPacksEnabled?: boolean
}) {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
  const posthogHost =
    process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com'

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
      <GameSocketProvider>
        <WordPacksFeatureContext.Provider value={wordPacksEnabled}>
          {wordPacksEnabled ? (
            <WordPackShopProvider packs={packs} checkoutEnabled={true}>
              {children}
            </WordPackShopProvider>
          ) : (
            children
          )}
        </WordPacksFeatureContext.Provider>
      </GameSocketProvider>
    </PlayerSessionProvider>
  )

  if (posthogKey) {
    content = <PostHogProvider client={posthog}>{content}</PostHogProvider>
  }

  if (wordPacksEnabled && clerkKey && clerkEnabled) {
    content = (
      <ClerkProvider
        publishableKey={clerkKey}
        appearance={{ theme: shadcn }}
        ui={ui}
      >
        <AccountBridge>{content}</AccountBridge>
      </ClerkProvider>
    )
  }

  return content
}
