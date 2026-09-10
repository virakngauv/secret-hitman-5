import { createClerkClient } from '@clerk/backend'
import { checkBillingOffers } from './check-billing-offers.mjs'

// Plan visibility remains a provider-side operational safeguard. It is not a
// second application release flag, nor a prerequisite for a dark deployment.
if (process.env.ENABLE_WORD_PACKS === 'true') {
  // This one-shot process owns the SDK request; exit bounds its lifetime too.
  const deadline = setTimeout(() => {
    console.error('Clerk offer verification timed out. Deployment stopped.')
    process.exit(1)
  }, 15_000)
  try {
    const { PACKS } = await import('../server/packs/index.ts')
    await checkBillingOffers(
      createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }),
      true,
      PACKS.filter((pack) => pack.enabled && pack.feature).map(
        (pack) => pack.feature,
      ),
    )
    console.log('- Clerk user offers: verified for word-pack launch')
  } catch {
    console.error(
      'Cannot verify Clerk user offers. Check provider availability and credentials, and ensure public non-default user Plans cover every enabled pack Feature before launching word packs.',
    )
    process.exitCode = 1
  } finally {
    clearTimeout(deadline)
  }
}
