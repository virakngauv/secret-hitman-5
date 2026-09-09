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

it.each(['declared', 'missing', 'misleading'])(
  'rejects oversized Clerk bodies with %s length and releases preview capacity',
  async (length) => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_transport')
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_transport')
    let canceled = false
    let chunks = 0
    const headers = new Headers()
    if (length !== 'missing')
      headers.set(
        'content-length',
        length === 'declared' ? String(2 * 1024 * 1024 + 1) : '1',
      )
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              chunks++
              controller.enqueue(new Uint8Array(64 * 1024))
            },
            cancel() {
              canceled = true
            },
          }),
          { headers },
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    expect((await GET()).status).toBe(503)
    expect(canceled).toBe(true)
    expect(chunks).toBeLessThanOrEqual(length === 'declared' ? 1 : 34)
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ object: 'subscription', subscription_items: [] }),
        ),
    )
    expect((await GET()).status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)

it('accepts a valid response exactly at the byte limit', async () => {
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_transport')
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_transport')
  const body = JSON.stringify({
    object: 'subscription',
    subscription_items: [],
  }).padEnd(2 * 1024 * 1024)
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(body, {
          headers: { 'content-length': String(body.length) },
        }),
    ),
  )
  expect((await GET()).status).toBe(200)
})
