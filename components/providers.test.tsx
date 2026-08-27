import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from './providers'

const mocks = vi.hoisted(() => ({ init: vi.fn() }))
vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({
    children,
    publishableKey,
  }: {
    children: ReactNode
    publishableKey: string
  }) => (
    <div data-testid="clerk" data-key={publishableKey}>
      {children}
    </div>
  ),
}))
vi.mock('posthog-js', () => ({ default: { init: mocks.init } }))
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="posthog">{children}</div>
  ),
}))
vi.mock('@/components/game-socket-provider', () => ({
  GameSocketProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/player-session-provider', () => ({
  PlayerSessionProvider: ({ children }: { children: ReactNode }) => children,
}))

describe('optional integration providers', () => {
  beforeEach(() => mocks.init.mockReset())
  afterEach(() => vi.unstubAllEnvs())

  it.each([undefined, '', ' \t '])(
    'leaves integrations inactive for blank keys %s',
    (key) => {
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', key)
      vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', key)
      render(
        <Providers>
          <span>Game</span>
        </Providers>,
      )
      expect(screen.getByText('Game')).toBeInTheDocument()
      expect(screen.queryByTestId('clerk')).not.toBeInTheDocument()
      expect(screen.queryByTestId('posthog')).not.toBeInTheDocument()
      expect(mocks.init).not.toHaveBeenCalled()
    },
  )

  it('normalizes configured keys and falls back from a blank analytics host', () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', ' clerk-key ')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', ' analytics-key ')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', ' ')
    render(
      <Providers>
        <span>Game</span>
      </Providers>,
    )
    expect(screen.getByTestId('clerk')).toHaveAttribute('data-key', 'clerk-key')
    expect(screen.getByTestId('posthog')).toBeInTheDocument()
    expect(mocks.init).toHaveBeenCalledWith(
      'analytics-key',
      expect.objectContaining({ api_host: 'https://us.i.posthog.com' }),
    )
  })
})
