import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextFetchEvent, NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  middleware: vi.fn(),
  handle: vi.fn(),
  next: vi.fn(),
  json: vi.fn(),
}))
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: mocks.middleware,
  createRouteMatcher: () => () => false,
}))
vi.mock('next/server', () => ({
  NextResponse: { next: mocks.next, json: mocks.json },
}))

describe('optional Clerk proxy', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_WORD_PACKS', 'true')
    vi.resetModules()
    mocks.middleware.mockReset().mockReturnValue(mocks.handle)
    mocks.handle.mockReset()
    mocks.next.mockReset()
    mocks.json.mockReset()
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', undefined)
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
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', 'https://game.example.com')
    const { default: proxy } = await import('./proxy')
    const request = {} as NextRequest
    const event = {} as NextFetchEvent
    proxy(request, event)
    expect(mocks.middleware).toHaveBeenCalledWith(expect.any(Function), {
      authorizedParties: ['https://game.example.com'],
    })
    expect(mocks.handle).toHaveBeenCalledWith(request, event)
    expect(mocks.next).not.toHaveBeenCalled()
    proxy(request, event)
    expect(mocks.middleware).toHaveBeenCalledOnce()
    expect(mocks.handle).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, '', '  ', ' , , '])(
    'fails closed with Clerk keys but no allowed origins (%s)',
    async (origins) => {
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'key')
      vi.stubEnv('CLERK_SECRET_KEY', 'secret')
      vi.stubEnv('CLERK_AUTHORIZED_PARTIES', origins)
      const { default: proxy } = await import('./proxy')
      proxy({} as NextRequest, {} as NextFetchEvent)
      expect(mocks.middleware).not.toHaveBeenCalled()
      expect(mocks.next).not.toHaveBeenCalled()
      expect(mocks.json).toHaveBeenCalledWith(
        { error: 'Account configuration unavailable.' },
        { status: 503 },
      )
    },
  )
})

it('supplies the explicit origin allowlist to Clerk authentication', async () => {
  vi.stubEnv('ENABLE_WORD_PACKS', 'true')
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'key')
  vi.stubEnv('CLERK_SECRET_KEY', 'secret')
  vi.stubEnv(
    'CLERK_AUTHORIZED_PARTIES',
    ' https://game.example.com, ,http://localhost:3140 ',
  )
  await import('./proxy')
  expect(mocks.middleware).toHaveBeenLastCalledWith(expect.any(Function), {
    authorizedParties: ['https://game.example.com', 'http://localhost:3140'],
  })
  vi.unstubAllEnvs()
})

it('ignores configured Clerk keys and origins when the release flag is off', async () => {
  vi.resetModules()
  vi.stubEnv('ENABLE_WORD_PACKS', 'false')
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'key')
  vi.stubEnv('CLERK_SECRET_KEY', 'secret')
  vi.stubEnv('CLERK_AUTHORIZED_PARTIES', '')
  mocks.middleware.mockClear()
  mocks.next.mockClear()
  const { default: proxy } = await import('./proxy')
  proxy({} as NextRequest, {} as NextFetchEvent)
  expect(mocks.middleware).not.toHaveBeenCalled()
  expect(mocks.next).toHaveBeenCalledOnce()
  vi.unstubAllEnvs()
})
