import { notFound } from 'next/navigation'
import { wordPacksEnabled } from '@/lib/word-packs'
import { UserProfile } from '@clerk/nextjs'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { hasPackFeature } from '@/server/pack-access'
import { withClerkCapacity } from '@/server/clerk-capacity'
import Link from 'next/link'
import { PACKS } from '@/server/packs'

export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  if (!wordPacksEnabled()) notFound()
  if (
    !process.env.CLERK_SECRET_KEY?.trim() ||
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  )
    return (
      <main className="game-page">
        <p>Account features are unavailable. Base play is free.</p>
        <Link href="/">Back to home</Link>
      </main>
    )
  await auth.protect()
  const { userId } = await auth()
  const preview = userId ? await loadSubscription(userId) : null
  return (
    <main className="game-page">
      <section className="game-panel mx-auto max-w-4xl space-y-5">
        <Link href="/" className="underline">
          Back to home
        </Link>
        <h1 className="text-3xl font-bold">Account & Billing</h1>
        <p>
          Pack access shown here is an account preview. The game server checks
          current access before each premium round.
        </p>
        <ul>
          {PACKS.filter((pack) => pack.enabled).map((pack) => (
            <li key={pack.id}>
              {pack.name}:{' '}
              {!pack.feature
                ? 'Available'
                : !preview
                  ? 'Access unavailable — try again'
                  : hasPackFeature(
                        preview.subscription,
                        pack.feature,
                        preview.checkedAt,
                      )
                    ? 'Available'
                    : 'Plan required'}
            </li>
          ))}
        </ul>
        <UserProfile routing="hash" />
      </section>
    </main>
  )
}

async function loadSubscription(userId: string) {
  return withClerkCapacity(async () => {
    const client = await clerkClient()
    const subscription = await client.billing.getUserBillingSubscription(userId)
    return { subscription, checkedAt: Date.now() }
  }, `preview:${userId}`).catch(() => null)
}
