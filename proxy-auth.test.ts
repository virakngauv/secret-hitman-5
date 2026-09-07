import { generateKeyPairSync, sign } from 'node:crypto'
import { verifyToken } from '@clerk/backend'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ middleware: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: mocks.middleware,
  createRouteMatcher: () => () => true,
}))

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
afterEach(() => vi.unstubAllEnvs())

it.each([
  ['https://game.example.com', true],
  ['https://untrusted.example.com', false],
] as const)(
  'authenticates a signed session only for an allowed token origin: %s',
  async (azp, allowed) => {
    vi.resetModules()
    vi.stubEnv(
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      `pk_test_${Buffer.from('test.clerk.accounts.dev$').toString('base64')}`,
    )
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_local_verification')
    vi.stubEnv(
      'CLERK_JWT_KEY',
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    )
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', 'https://game.example.com')
    const now = Math.floor(Date.now() / 1000)
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({ sub: 'user_test', sid: 'sess_test', iss: 'https://test.clerk.accounts.dev', azp, iat: now, nbf: now - 10, exp: now + 60, v: 2, sts: 'active' })}`
    const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`
    await import('./proxy')
    const { authorizedParties } = mocks.middleware.mock.lastCall![1]
    const verification = verifyToken(jwt, {
      jwtKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      authorizedParties,
    })
    if (allowed)
      await expect(verification).resolves.toMatchObject({ sub: 'user_test' })
    else
      await expect(verification).rejects.toMatchObject({
        reason: 'token-invalid-authorized-parties',
      })
  },
)
