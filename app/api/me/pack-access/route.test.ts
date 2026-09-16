import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), subscription: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
  clerkClient: async () => ({
    billing: { getUserBillingSubscription: mocks.subscription },
  }),
}))
vi.mock('@/server/packs', () => ({
  PACKS: [
    { id: 'base', enabled: true },
    { id: 'movies-v1', enabled: true, feature: 'pack_movies_v1' },
    { id: 'disabled', enabled: false, feature: 'pack_movies_v1' },
  ],
}))
beforeEach(() => {
  vi.stubEnv('ENABLE_WORD_PACKS', 'true')
  vi.stubEnv('CLERK_SECRET_KEY', 'test-key')
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'test-key')
  mocks.auth.mockResolvedValue({ userId: 'user_test' })
})
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
it('keeps account previews optional and requires a signed-in account', async () => {
  vi.stubEnv('CLERK_SECRET_KEY', '')
  expect((await GET()).status).toBe(503)
  expect(mocks.auth).not.toHaveBeenCalled()
  vi.stubEnv('CLERK_SECRET_KEY', 'test-key')
  mocks.auth.mockResolvedValue({ userId: null })
  expect((await GET()).status).toBe(401)
  expect(mocks.subscription).not.toHaveBeenCalled()
})
it('returns only enabled eligible IDs without caching or full provider data', async () => {
  mocks.subscription.mockResolvedValue({
    subscriptionItems: [
      {
        status: 'canceled',
        periodStart: Date.now() - 1000,
        periodEnd: Date.now() + 10000,
        endedAt: null,
        plan: {
          isDefault: false,
          forPayerType: 'user',
          features: [{ slug: 'pack_movies_v1' }],
        },
      },
    ],
  })
  const response = await GET()
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    userId: 'user_test',
    packIds: ['base', 'movies-v1'],
  })
})
it('bounds provider latency and redacts errors', async () => {
  vi.useFakeTimers()
  let complete!: (value: unknown) => void
  mocks.subscription.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const pending = GET()
  await vi.advanceTimersByTimeAsync(4500)
  const response = await pending
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    message: 'Access preview unavailable. Try again.',
  })
  complete({ subscriptionItems: [] })
  await Promise.resolve()
})

it('shares outstanding previews across retries, then refreshes after settlement', async () => {
  vi.useFakeTimers()
  mocks.auth.mockResolvedValue({ userId: 'user_shared' })
  let complete!: (value: unknown) => void
  mocks.subscription.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const first = GET()
  await vi.advanceTimersByTimeAsync(4500)
  expect((await first).status).toBe(503)
  const retry = GET()
  const otherTab = GET()
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.subscription).toHaveBeenCalledOnce()
  complete({ subscriptionItems: [] })
  expect((await retry).status).toBe(200)
  expect((await otherTab).status).toBe(200)
  mocks.subscription.mockResolvedValue({ subscriptionItems: [] })
  expect((await GET()).status).toBe(200)
  expect(mocks.subscription).toHaveBeenCalledTimes(2)
})
it('returns 404 without touching Clerk when word packs are disabled', async () => {
  vi.stubEnv('ENABLE_WORD_PACKS', 'false')
  expect((await GET()).status).toBe(404)
  expect(mocks.auth).not.toHaveBeenCalled()
  expect(mocks.subscription).not.toHaveBeenCalled()
})
