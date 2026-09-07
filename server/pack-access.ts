import { createClerkClient, verifyToken } from '@clerk/backend'
import type { CommandResult } from '../lib/game-protocol'

export const accessUnavailable = (): CommandResult => ({
  status: 'server_unavailable',
  message: 'Pack access is unavailable. Try again or choose Base.',
})
const denied = (): CommandResult => ({
  status: 'forbidden',
  message: 'Sign in with an account whose subscription includes this pack.',
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
export function hasPackFeature(
  subscription: Subscription,
  feature: string,
  now: number,
): boolean {
  return subscription.subscriptionItems.some(
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
) => Promise<CommandResult>
export function createPackAuthorizer(
  env: Record<string, string | undefined> = process.env,
): AuthorizePack {
  const secretKey = env.CLERK_SECRET_KEY?.trim()
  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  const issuer = env.CLERK_ISSUER?.trim()
  const authorizedParties = env.CLERK_AUTHORIZED_PARTIES?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!secretKey || !publishableKey || !issuer || !authorizedParties?.length)
    return async () => accessUnavailable()
  const client = createClerkClient({ secretKey, publishableKey })
  return async (token, feature) => {
    if (!token) return denied()
    let claims
    try {
      claims = await verifyToken(token, {
        secretKey,
        authorizedParties,
        audience: env.CLERK_AUDIENCE || undefined,
        clockSkewInMs: 0,
      })
    } catch {
      return denied()
    }
    const now = Date.now()
    if (
      claims.iss !== issuer ||
      !claims.sub?.startsWith('user_') ||
      !claims.sid?.startsWith('sess_') ||
      !claims.azp ||
      !authorizedParties.includes(claims.azp) ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= now ||
      !Number.isFinite(claims.iat) ||
      claims.iat * 1000 > now ||
      !Number.isFinite(claims.nbf) ||
      claims.nbf * 1000 > now
    )
      return denied()
    try {
      const session = await client.sessions.getSession(claims.sid)
      if (
        session.status !== 'active' ||
        session.userId !== claims.sub ||
        session.id !== claims.sid
      )
        return denied()
      const subscription = await client.billing.getUserBillingSubscription(
        claims.sub,
      )
      if (claims.exp * 1000 <= Date.now()) return denied()
      return hasPackFeature(subscription, feature, Date.now())
        ? { status: 'success' }
        : denied()
    } catch {
      return accessUnavailable()
    }
  }
}
