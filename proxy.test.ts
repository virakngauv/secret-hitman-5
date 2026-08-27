import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFetchEvent, NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  middleware: vi.fn(),
  handle: vi.fn(),
  next: vi.fn(),
}))
vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: mocks.middleware }))
vi.mock('next/server', () => ({ NextResponse: { next: mocks.next } }))

describe('optional Clerk proxy', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.middleware.mockReset().mockReturnValue(mocks.handle)
    mocks.handle.mockReset()
    mocks.next.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    [undefined, undefined],
    ['', ''],
    ['  ', '\t'],
    [' key ', '  '],
    [' ', ' secret '],
  ])(
    'does not activate for missing keys (%s, %s)',
    async (publishable, secret) => {
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', publishable)
      vi.stubEnv('CLERK_SECRET_KEY', secret)
      const { default: proxy } = await import('./proxy')
      proxy({} as NextRequest, {} as NextFetchEvent)
      expect(mocks.middleware).not.toHaveBeenCalled()
      expect(mocks.next).toHaveBeenCalledOnce()
    },
  )

  it('passes normalized keys and the request to Clerk', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', ' key ')
    vi.stubEnv('CLERK_SECRET_KEY', ' secret ')
    const { default: proxy } = await import('./proxy')
    const request = {} as NextRequest
    const event = {} as NextFetchEvent
    proxy(request, event)
    expect(mocks.middleware).toHaveBeenCalledWith({
      publishableKey: 'key',
      secretKey: 'secret',
    })
    expect(mocks.handle).toHaveBeenCalledWith(request, event)
    expect(mocks.next).not.toHaveBeenCalled()
    proxy(request, event)
    expect(mocks.middleware).toHaveBeenCalledOnce()
    expect(mocks.handle).toHaveBeenCalledTimes(2)
  })
})
