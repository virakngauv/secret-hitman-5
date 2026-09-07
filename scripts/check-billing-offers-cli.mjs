import { createClerkClient } from '@clerk/backend'
import { checkBillingOffers } from './check-billing-offers.mjs'

if (
  process.env.CLERK_SECRET_KEY?.trim() &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
) {
  // This one-shot process owns the SDK request; exit bounds its lifetime too.
  const deadline = setTimeout(() => {
    console.error('Clerk offer verification timed out. Deployment stopped.')
    process.exit(1)
  }, 15_000)
  try {
    await checkBillingOffers(
      createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }),
      process.env.ENABLE_CLERK_CHECKOUT === 'true',
    )
    console.log('- Clerk user offers: consistent with checkout setting')
  } catch {
    console.error(
      'Cannot verify Clerk user offers. When checkout is disabled, make every non-default user Plan non-public in Clerk, then retry. Check provider availability if the configuration is already correct. Do not disable Billing or cancel existing subscriptions.',
    )
    process.exitCode = 1
  } finally {
    clearTimeout(deadline)
  }
}
