// Clerk plan visibility controls offers in UserProfile and UserButton too.
// This read-only deployment check must not cancel subscriptions or disable Billing.
export async function checkBillingOffers(client, checkoutEnabled) {
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
    offset += data.length
    if (offset >= totalCount) return
    if (data.length === 0) throw new Error('Incomplete Clerk plan listing.')
  }
}
