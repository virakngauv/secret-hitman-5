import { createClerkClient, verifyToken } from '@clerk/backend'
import type { CommandResult } from '../lib/game-protocol'
import { withClerkCapacity } from './clerk-capacity'

export const accessUnavailable = (): CommandResult => ({
  status: 'server_unavailable',
  message: 'Pack access is unavailable. Try again or choose Base.',
})
const denied = (): CommandResult => ({
  status: 'forbidden',
  message:
    'Sign in with an account whose subscription includes this pack, or choose Base.',
})

type Subscription = {
  subscriptionItems: Array<{
    status: string
    periodStart: number
    periodEnd: number | null
    endedAt: number | null
    isFreeTrial?: boolean
    plan: {
      isDefault: boolean
      forPayerType: string
      features: Array<{ slug: string }>
    } | null
  }>
}

// Item dates are milliseconds. Parent status alone is never an access grant.
// The Billing BAPI is beta; a missing subscription counts as no access.
export function hasPackFeature(
  subscription: Subscription | null | undefined,
  feature: string,
  now: number,
): boolean {
  return (subscription?.subscriptionItems ?? []).some(
    (item) =>
      (item.status === 'active' || item.status === 'canceled') &&
      item.isFreeTrial !== true &&
      item.endedAt === null &&
      Number.isFinite(item.periodStart) &&
      item.periodStart <= now &&
      item.periodEnd !== null &&
      Number.isFinite(item.periodEnd) &&
      now < item.periodEnd &&
      item.plan?.isDefault === false &&
      item.plan.forPayerType === 'user' &&
      item.plan.features.some((entry) => entry.slug === feature),
  )
}

export type AuthorizePack = (
  token: string | undefined,
  feature: string,
  signal?: AbortSignal,
) => Promise<CommandResult>
export function createPackAuthorizer(
  env: Record<string, string | undefined> = process.env,
): AuthorizePack {
  const secretKey = env.CLERK_SECRET_KEY?.trim()
  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  const issuer = env.CLERK_ISSUER?.trim()
  const audience = env.CLERK_AUDIENCE?.trim() || undefined
  const authorizedParties = env.CLERK_AUTHORIZED_PARTIES?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!secretKey || !publishableKey || !issuer || !authorizedParties?.length)
    return async () => accessUnavailable()
  const client = createClerkClient({ secretKey, publishableKey })
  return async (token, feature, signal) => {
    if (signal?.aborted) return accessUnavailable()
    if (!token) return denied()
    let claims
    try {
      claims = await withClerkCapacity(() =>
        verifyToken(token, {
          secretKey,
          authorizedParties,
          audience,
          clockSkewInMs: 5000,
        }),
      )
    } catch (error) {
      const reason =
        error && typeof error === 'object' && 'reason' in error
          ? error.reason
          : undefined
      if (
        typeof reason === 'string' &&
        [
          'token-expired',
          'token-invalid',
          'token-invalid-algorithm',
          'token-invalid-authorized-parties',
          'token-invalid-signature',
          'token-not-active-yet',
          'token-iat-in-the-future',
        ].includes(reason)
      )
        return denied()
      return accessUnavailable()
    }
    if (!claims) return denied()
    const now = Date.now()
    if (signal?.aborted) return accessUnavailable()
    if (
      claims.iss !== issuer ||
      !claims.sub?.startsWith('user_') ||
      !claims.sid?.startsWith('sess_') ||
      !claims.azp ||
      !authorizedParties.includes(claims.azp) ||
      // Default Clerk session tokens omit aud. Custom audiences require an explicit match.
      (audience
        ? !(Array.isArray(claims.aud)
            ? claims.aud.includes(audience)
            : claims.aud === audience)
        : claims.aud !== undefined) ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= now ||
      !Number.isFinite(claims.iat) ||
      claims.iat * 1000 > now + 5000 ||
      !Number.isFinite(claims.nbf) ||
      claims.nbf * 1000 > now + 5000
    )
      return denied()
    try {
      // Only verified subjects may reserve account capacity across rooms.
      return await withClerkCapacity(async () => {
        const session = await client.sessions.getSession(claims.sid)
        if (signal?.aborted) return accessUnavailable()
        if (
          session.status !== 'active' ||
          session.userId !== claims.sub ||
          session.id !== claims.sid
        )
          return denied()
        const subscription = await client.billing.getUserBillingSubscription(
          claims.sub,
        )
        if (signal?.aborted) return accessUnavailable()
        if (claims.exp * 1000 <= Date.now()) return denied()
        return hasPackFeature(subscription, feature, Date.now())
          ? { status: 'success' }
          : denied()
      }, `host:${claims.sub}`)
    } catch {
      return accessUnavailable()
    }
  }
}
