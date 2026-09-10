import { expect, test } from '@playwright/test'

test('dark deployment hides pack and account surfaces while Base play works', async ({
  browser,
}) => {
  test.skip(
    Boolean(
      process.env.PW_WORD_PACKS === '1' ||
      process.env.PLAYWRIGHT_BASE_URL ||
      process.env.PW_REUSE_SERVER === '1',
    ),
    'Requires the managed server with explicitly empty Clerk keys; external/reused servers may be configured.',
  )
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    for (const route of [
      '/pricing',
      '/account',
      '/sign-in',
      '/sign-up',
      '/api/me/pack-access',
      '/__clerk/test',
    ]) {
      const response = await host.goto(route)
      expect(response?.status()).toBe(404)
    }
    await host.goto('/')
    await expect(
      host.getByRole('button', { name: 'Buy word packs' }),
    ).toHaveCount(0)
    await expect(
      host.getByText(/Account features|Sign in|Sign up/),
    ).toHaveCount(0)
    await host.goto('/create')
    await host.getByLabel('Name').fill('Pack Host')
    await host.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(host.getByRole('heading', { name: 'lobby.' })).toBeVisible()
    await expect(host.getByRole('group', { name: 'Word packs' })).toHaveCount(0)
    await guest.goto(host.url())
    await guest.getByLabel('Name').fill('Pack Guest')
    await guest.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(guest.getByRole('heading', { name: 'lobby.' })).toBeVisible()
    await expect(guest.getByRole('group', { name: 'Word packs' })).toHaveCount(
      0,
    )
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

test('enabled release exposes the complete pack UI and retains optional local Clerk behavior', async ({
  page,
}) => {
  test.skip(
    process.env.PW_WORD_PACKS !== '1' ||
      Boolean(process.env.PLAYWRIGHT_BASE_URL || process.env.PW_REUSE_SERVER),
    'Requires the managed enabled-feature server.',
  )
  await page.goto('/')
  await expect(page.getByText('Account features unavailable')).toBeVisible()
  await page.getByRole('button', { name: 'Buy word packs' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(
    page.getByRole('dialog').getByText('Movies (24)', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Buy word packs' }),
  ).toBeFocused()
  await page.goto('/create')
  await page.getByLabel('Name').fill('Enabled Host')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const controls = page.getByRole('region', { name: 'Host controls' })
  await expect(
    controls.getByRole('checkbox', { name: /Base \(\d+\)/ }),
  ).toBeChecked()
  await expect(
    controls.getByRole('checkbox', { name: 'Movies (24)' }),
  ).toBeDisabled()
  await controls.getByRole('button', { name: 'Buy Movies' }).click()
  await expect(page.getByRole('dialog', { name: 'Buy Movies' })).toBeVisible()
  for (const path of ['/pricing', '/account', '/sign-in', '/sign-up']) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
  }
})
