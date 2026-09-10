import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPackAuthorizer, hasPackFeature } from './pack-access'

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  session: vi.fn(),
  subscription: vi.fn(),
}))
vi.mock('@clerk/backend', () => ({
  verifyToken: mocks.verify,
  createClerkClient: () => ({
    sessions: { getSession: mocks.session },
    billing: { getUserBillingSubscription: mocks.subscription },
  }),
}))
afterEach(() => vi.resetAllMocks())
const now = 10000
const item = {
  status: 'active',
  periodStart: 1000,
  periodEnd: 20000,
  endedAt: null,
  isFreeTrial: false,
  plan: {
    isDefault: false,
    forPayerType: 'user',
    features: [{ slug: 'pack_movies_v1' }],
  },
}
const has = (patch = {}) =>
  hasPackFeature(
    { subscriptionItems: [{ ...item, ...patch }] },
    'pack_movies_v1',
    now,
  )
describe('Clerk subscription item access', () => {
  it('allows an effective active or canceled item', () => {
    expect(has()).toBe(true)
    expect(has({ status: 'canceled' })).toBe(true)
  })
  it.each([
    'ended',
    'expired',
    'incomplete',
    'abandoned',
    'upcoming',
    'past_due',
  ])('denies %s', (status) => expect(has({ status })).toBe(false))
  it.each([
    { periodEnd: now },
    { periodEnd: null },
    { periodEnd: NaN },
    { periodStart: now + 1 },
    { endedAt: now - 1 },
    { isFreeTrial: true },
    { plan: null },
    { plan: { ...item.plan, isDefault: true } },
    { plan: { ...item.plan, forPayerType: 'org' } },
    { plan: { ...item.plan, features: [] } },
  ])('denies ineffective item %j', (patch) => expect(has(patch)).toBe(false))
  it('uses fresh renewal periods and does not grant from a default parent', () => {
    expect(has({ periodEnd: now })).toBe(false)
    expect(has({ periodStart: now, periodEnd: now + 1000 })).toBe(true)
    expect(
      hasPackFeature({ subscriptionItems: [] }, 'pack_movies_v1', now),
    ).toBe(false)
  })
})
const env = {
  CLERK_SECRET_KEY: 'test',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'test',
  CLERK_ISSUER: 'https://clerk.example',
  CLERK_AUTHORIZED_PARTIES: 'https://game.example',
}
function setup() {
  const seconds = Date.now() / 1000
  const claims = {
    sub: 'user_host',
    sid: 'sess_host',
    iss: env.CLERK_ISSUER,
    azp: env.CLERK_AUTHORIZED_PARTIES,
    exp: seconds + 100,
    iat: seconds - 1,
    nbf: seconds - 1,
  }
  mocks.verify.mockResolvedValue(claims)
  mocks.session.mockResolvedValue({
    id: 'sess_host',
    userId: 'user_host',
    status: 'active',
  })
  mocks.subscription.mockResolvedValue({
    subscriptionItems: [{ ...item, periodEnd: Date.now() + 100000 }],
  })
  return claims
}
describe('account verification', () => {
  it('fails closed with missing or partial configuration', async () => {
    expect((await createPackAuthorizer({})('token', 'feature')).status).toBe(
      'server_unavailable',
    )
  })
  it('checks the verified account, active session, and current subscription', async () => {
    setup()
    expect(
      (await createPackAuthorizer(env)('token', 'pack_movies_v1')).status,
    ).toBe('success')
    expect(mocks.subscription).toHaveBeenCalledWith('user_host')
    expect(mocks.verify).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        authorizedParties: ['https://game.example'],
        clockSkewInMs: 5000,
      }),
    )
  })
  it.each([
    { iss: 'https://attacker.example' },
    { azp: 'https://attacker.example' },
    { exp: 0 },
    { sid: '' },
    { sub: '' },
    { iat: undefined },
    { nbf: undefined },
  ])('denies invalid claims %j', async (patch) => {
    mocks.verify.mockResolvedValue({ ...setup(), ...patch })
    expect(
      (await createPackAuthorizer(env)('token', 'pack_movies_v1')).status,
    ).toBe('forbidden')
    expect(mocks.subscription).not.toHaveBeenCalled()
  })
  it.each([
    { status: 'revoked' },
    { userId: 'user_other' },
    { id: 'sess_other' },
  ])('denies revoked or mismatched sessions %j', async (patch) => {
    setup()
    mocks.session.mockResolvedValue({
      id: 'sess_host',
      userId: 'user_host',
      status: 'active',
      ...patch,
    })
    expect(
      (await createPackAuthorizer(env)('token', 'pack_movies_v1')).status,
    ).toBe('forbidden')
  })
  it('contains provider errors without leaking tokens', async () => {
    setup()
    mocks.subscription.mockRejectedValue(new Error('secret-token'))
    const result = await createPackAuthorizer(env)(
      'secret-token',
      'pack_movies_v1',
    )
    expect(result.status).toBe('server_unavailable')
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })
  it.each(['jwk-remote-failed-to-load', undefined])(
    'treats verification infrastructure failures as retryable (%s)',
    async (reason) => {
      setup()
      mocks.verify.mockRejectedValue(
        Object.assign(new Error('secret-token'), { reason }),
      )
      const result = await createPackAuthorizer(env)(
        'secret-token',
        'pack_movies_v1',
      )
      expect(result.status).toBe('server_unavailable')
      expect(JSON.stringify(result)).not.toContain('secret-token')
      expect(mocks.session).not.toHaveBeenCalled()
    },
  )
  it.each(['token-invalid-signature', 'token-expired', 'token-invalid'])(
    'denies invalid tokens (%s)',
    async (reason) => {
      setup()
      mocks.verify.mockRejectedValue({ reason })
      expect(
        (await createPackAuthorizer(env)('token', 'pack_movies_v1')).status,
      ).toBe('forbidden')
      expect(mocks.subscription).not.toHaveBeenCalled()
    },
  )
  it.each([
    [1, 'success'],
    [6, 'forbidden'],
  ] as const)(
    'allows bounded clock skew of %s seconds',
    async (seconds, status) => {
      const claims = setup()
      mocks.verify.mockResolvedValue({
        ...claims,
        iat: Date.now() / 1000 + seconds,
        nbf: Date.now() / 1000 + seconds,
      })
      expect(
        (await createPackAuthorizer(env)('token', 'pack_movies_v1')).status,
      ).toBe(status)
    },
  )
  it.each([
    [undefined, undefined, 'success'],
    ['other-app', undefined, 'forbidden'],
    ['other-app', ' game ', 'forbidden'],
    [undefined, 'game', 'forbidden'],
    ['game', ' game ', 'success'],
    [['other-app', 'game'], 'game', 'success'],
  ] as const)(
    'enforces the audience contract (%j, %s)',
    async (aud, audience, status) => {
      mocks.verify.mockResolvedValue({ ...setup(), aud })
      expect(
        (
          await createPackAuthorizer({ ...env, CLERK_AUDIENCE: audience })(
            'token',
            'pack_movies_v1',
          )
        ).status,
      ).toBe(status)
      expect(mocks.verify).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({ audience: audience?.trim() }),
      )
      if (status === 'forbidden')
        expect(mocks.subscription).not.toHaveBeenCalled()
    },
  )
})

it('limits outstanding entitlement work by verified account across authorizer calls', async () => {
  const claims = setup()
  let finish!: (value: unknown) => void
  mocks.subscription.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const authorize = createPackAuthorizer(env)
  const abort = new AbortController()
  const first = authorize('first-token', 'pack_movies_v1', abort.signal)
  await vi.waitFor(() => expect(mocks.subscription).toHaveBeenCalledOnce())
  abort.abort()
  expect((await authorize('second-token', 'pack_movies_v1')).status).toBe(
    'server_unavailable',
  )
  expect(mocks.session).toHaveBeenCalledTimes(1)
  mocks.verify.mockResolvedValueOnce({
    ...claims,
    sub: 'user_other',
    sid: 'sess_other',
  })
  mocks.session.mockResolvedValueOnce({
    id: 'sess_other',
    userId: 'user_other',
    status: 'active',
  })
  expect((await authorize('other-token', 'pack_movies_v1')).status).toBe(
    'success',
  )
  finish({ subscriptionItems: [] })
  expect((await first).status).toBe('server_unavailable')
  expect((await authorize('retry-token', 'pack_movies_v1')).status).toBe(
    'success',
  )
})

it('bounds token verification before trusting any account identifier', async () => {
  const claims = setup()
  let finish!: (value: unknown) => void
  mocks.verify.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const authorize = createPackAuthorizer(env)
  const requests = Array.from({ length: 32 }, () =>
    authorize('token', 'pack_movies_v1'),
  )
  expect((await authorize('extra-token', 'pack_movies_v1')).status).toBe(
    'server_unavailable',
  )
  expect(mocks.verify).toHaveBeenCalledTimes(32)
  expect(mocks.session).not.toHaveBeenCalled()
  finish(claims)
  await Promise.all(requests)
  expect((await authorize('retry-token', 'pack_movies_v1')).status).toBe(
    'success',
  )
})
