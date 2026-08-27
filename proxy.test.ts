import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFetchEvent, NextRequest } from 'next/server'

import proxy from './proxy'

const mocks = vi.hoisted(() => ({
  middleware: vi.fn(),
  handle: vi.fn(),
  next: vi.fn(),
}))
vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: mocks.middleware }))
vi.mock('next/server', () => ({ NextResponse: { next: mocks.next } }))

describe('optional Clerk proxy', () => {
  beforeEach(() => {
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
  ])('does not activate for missing keys (%s, %s)', (publishable, secret) => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', publishable)
    vi.stubEnv('CLERK_SECRET_KEY', secret)
    proxy({} as NextRequest, {} as NextFetchEvent)
    expect(mocks.middleware).not.toHaveBeenCalled()
    expect(mocks.next).toHaveBeenCalledOnce()
  })

  it('passes normalized keys and the request to Clerk', () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', ' key ')
    vi.stubEnv('CLERK_SECRET_KEY', ' secret ')
    const request = {} as NextRequest
    const event = {} as NextFetchEvent
    proxy(request, event)
    expect(mocks.middleware).toHaveBeenCalledWith({
      publishableKey: 'key',
      secretKey: 'secret',
    })
    expect(mocks.handle).toHaveBeenCalledWith(request, event)
    expect(mocks.next).not.toHaveBeenCalled()
  })
})
