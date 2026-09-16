// Clerk plan visibility controls offers in UserProfile and UserButton too.
// This read-only deployment check must not cancel subscriptions or disable Billing.
export class BillingOfferValidationError extends Error {}

export function billingOfferFailureMessage(error) {
  return error instanceof BillingOfferValidationError
    ? error.message
    : 'Cannot verify Clerk user offers. Check provider availability and credentials, and ensure every public non-default user Plan covers every enabled pack Feature with free trials disabled before launching word packs.'
}

export async function checkBillingOffers(
  client,
  checkoutEnabled,
  requiredFeatures = [],
) {
  const publicOffers = []
  let offset = 0
  for (;;) {
    const { data, totalCount } = await client.billing.getPlanList({
      payerType: 'user',
      limit: 100,
      offset,
    })
    if (
      !checkoutEnabled &&
      data.some((plan) => !plan.isDefault && plan.publiclyVisible)
    ) {
      throw new BillingOfferValidationError(
        'Checkout is disabled but Clerk still exposes a user Plan. Turn off Publicly available for every non-default user Plan in the target Clerk instance, then verify /account and the avatar profile flow. Hiding /pricing alone does not stop purchases.',
      )
    }
    for (const plan of data) {
      if (plan.isDefault || !plan.publiclyVisible) continue
      publicOffers.push(plan)
    }
    offset += data.length
    if (offset >= totalCount) break
    if (data.length === 0) throw new Error('Incomplete Clerk plan listing.')
  }
  if (checkoutEnabled) {
    if (!publicOffers.length)
      throw new BillingOfferValidationError(
        'No public non-default Clerk user Plans are available for launch.',
      )
    if (!requiredFeatures.length)
      throw new BillingOfferValidationError(
        'No premium pack Features were supplied for launch verification.',
      )
    if (publicOffers.some((plan) => plan.freeTrialEnabled))
      throw new BillingOfferValidationError(
        'Public non-default Clerk user Plans must have free trials disabled for launch.',
      )
    const missing = new Set()
    for (const plan of publicOffers) {
      const planFeatures = new Set(
        (plan.features ?? []).map((feature) => feature.slug),
      )
      for (const feature of requiredFeatures)
        if (!planFeatures.has(feature)) missing.add(feature)
    }
    if (missing.size)
      throw new BillingOfferValidationError(
        `Every public non-default Clerk user Plan must include every required pack Feature because checkout displays all public Plans. Missing per-Plan coverage includes: ${[...missing].join(', ')}.`,
      )
  }
}
