// Clerk plan visibility controls offers in UserProfile and UserButton too.
// This read-only deployment check must not cancel subscriptions or disable Billing.
export async function checkBillingOffers(
  client,
  checkoutEnabled,
  requiredFeatures = [],
) {
  const offeredFeatures = new Set()
  let publicOfferCount = 0
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
      throw new Error(
        'Checkout is disabled but Clerk still exposes a user Plan. Turn off Publicly available for every non-default user Plan in the target Clerk instance, then verify /account and the avatar profile flow. Hiding /pricing alone does not stop purchases.',
      )
    }
    for (const plan of data) {
      if (plan.isDefault || !plan.publiclyVisible) continue
      publicOfferCount += 1
      for (const feature of plan.features ?? [])
        offeredFeatures.add(feature.slug)
    }
    offset += data.length
    if (offset >= totalCount) break
    if (data.length === 0) throw new Error('Incomplete Clerk plan listing.')
  }
  if (checkoutEnabled) {
    if (!publicOfferCount)
      throw new Error(
        'No public non-default Clerk user Plans are available for launch.',
      )
    if (!requiredFeatures.length)
      throw new Error(
        'No premium pack Features were supplied for launch verification.',
      )
    const missing = requiredFeatures.filter(
      (feature) => !offeredFeatures.has(feature),
    )
    if (missing.length)
      throw new Error(
        `Public Clerk user Plans are missing required pack Features: ${missing.join(', ')}.`,
      )
  }
}
