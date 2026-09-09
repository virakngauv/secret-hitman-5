import { afterEach, expect, it, vi } from 'vitest'
import { createClerkClient } from '@clerk/backend'
import { GET } from './route'

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_transport' }),
  clerkClient: async () =>
    createClerkClient({ secretKey: 'sk_test_transport' }),
}))
vi.mock('@/server/packs', () => ({ PACKS: [{ id: 'base', enabled: true }] }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

it.each(['headers', 'body'])(
  'aborts stalled Clerk %s and permits a fresh preview',
  async (stage) => {
    vi.useFakeTimers()
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_transport')
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_transport')
    let aborted = false
    const fetcher = vi.fn((_input: unknown, init: RequestInit) => {
      const signal = init.signal!
      if (stage === 'headers')
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(signal.reason)
            },
            { once: true },
          )
        })
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true
                  controller.error(signal.reason)
                },
                { once: true },
              )
            },
          }),
        ),
      )
    })
    vi.stubGlobal('fetch', fetcher)
    const pending = GET()
    await vi.advanceTimersByTimeAsync(4500)
    expect((await pending).status).toBe(503)
    expect(aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(aborted).toBe(true)
    // A new SDK request proves both the shared map and per-user capacity were released.
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ object: 'subscription', subscription_items: [] }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    )
    expect((await GET()).status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)
