import { auth, clerkClient } from '@clerk/nextjs/server'
import { PACKS } from '@/server/packs'
import { hasPackFeature } from '@/server/pack-access'

export const dynamic = 'force-dynamic'

// UI preview only. Socket commands independently verify the host's current access.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  if (
    !process.env.CLERK_SECRET_KEY?.trim() ||
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  )
    return Response.json(
      { message: 'Account features unavailable.' },
      { status: 503, headers },
    )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { userId } = await auth()
    if (!userId)
      return Response.json(
        { message: 'Sign in to check access.' },
        { status: 401, headers },
      )
    const subscription = await Promise.race([
      clerkClient().then((client) =>
        client.billing.getUserBillingSubscription(userId),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 4500)
      }),
    ])
    return Response.json(
      {
        userId,
        packIds: PACKS.filter(
          (pack) =>
            pack.enabled &&
            (!pack.feature ||
              hasPackFeature(subscription, pack.feature, Date.now())),
        ).map((pack) => pack.id),
      },
      { headers },
    )
  } catch {
    return Response.json(
      { message: 'Access preview unavailable. Try again.' },
      { status: 503, headers },
    )
  } finally {
    clearTimeout(timer)
  }
}
