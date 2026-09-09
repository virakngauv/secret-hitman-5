import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AccountPage from './page'
const mocks = vi.hoisted(() => ({ subscription: vi.fn() }))
vi.mock('@clerk/nextjs', () => ({ UserProfile: () => null }))
vi.mock('@clerk/nextjs/server', () => ({
  auth: Object.assign(
    async () => ({ userId: 'user_account', has: () => false }),
    { protect: async () => {} },
  ),
  clerkClient: async () => ({
    billing: { getUserBillingSubscription: mocks.subscription },
  }),
}))
vi.mock('@/server/packs', () => ({
  PACKS: [
    { id: 'base', name: 'Base', enabled: true },
    { id: 'movies', name: 'Movies', enabled: true, feature: 'movies' },
  ],
}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})
it.each(['canceled', 'past_due', 'unavailable'])(
  'shows live %s access instead of session claims',
  async (status) => {
    vi.stubEnv('CLERK_SECRET_KEY', 'secret')
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'key')
    if (status === 'unavailable')
      mocks.subscription.mockRejectedValue(new Error('provider secret'))
    else
      mocks.subscription.mockResolvedValue({
        subscriptionItems: [
          {
            status,
            periodStart: Date.now() - 1000,
            periodEnd: Date.now() + 10000,
            endedAt: null,
            plan: {
              isDefault: false,
              forPayerType: 'user',
              features: [{ slug: 'movies' }],
            },
          },
        ],
      })
    render(await AccountPage())
    expect(
      screen.getByText(
        `Movies: ${status === 'canceled' ? 'Available' : status === 'past_due' ? 'Plan required' : 'Access unavailable — try again'}`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Base: Available')).toBeInTheDocument()
  },
)
