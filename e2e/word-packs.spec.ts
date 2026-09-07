import { expect, test } from '@playwright/test'

test('base packs and public account pages work without Clerk configuration', async ({
  browser,
}) => {
  test.skip(
    Boolean(
      process.env.PLAYWRIGHT_BASE_URL || process.env.PW_REUSE_SERVER === '1',
    ),
    'Requires the managed server with explicitly empty Clerk keys; external/reused servers may be configured.',
  )
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    await host.goto('/pricing')
    await expect(
      host.getByText(
        'Subscriptions are not available for purchase here yet. Base play remains free.',
      ),
    ).toBeVisible()
    await host.goto('/account')
    await expect(
      host.getByText('Account features are unavailable. Base play is free.'),
    ).toBeVisible()
    await host.goto('/create')
    await host.getByLabel('Name').fill('Pack Host')
    await host.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(host.getByRole('heading', { name: 'lobby.' })).toBeVisible()
    await expect(host.getByRole('combobox', { name: 'Word pack' })).toHaveValue(
      'base',
    )
    await guest.goto(host.url())
    await guest.getByLabel('Name').fill('Pack Guest')
    await guest.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(
      guest.getByText('Base · Chosen by the host. Guests play free.'),
    ).toBeVisible()
    await expect(
      guest.getByRole('combobox', { name: 'Word pack' }),
    ).toHaveCount(0)
    await host.getByRole('button', { name: 'Start game' }).click()
    await expect(host.locator('button[data-card-id]')).toHaveCount(12)
    await expect(guest.locator('button[data-card-id]')).toHaveCount(12)
    await guest.reload()
    await expect(guest.locator('button[data-card-id]')).toHaveCount(12)
  } finally {
    await hostContext.close()
    await guestContext.close()
  }
})
