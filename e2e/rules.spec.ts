import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1280, height: 900 },
]) {
  test(`reads the rules without joining a room at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/rules')
    await expect(page).toHaveTitle('Rules — Secret Hitman')
    await expect(
      page.getByRole('heading', { name: 'Rules', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      '1. Gather your players',
      '2. Build and lock in your clue',
      '3. Pick targets or pass',
      '4. Count the points',
      '5. Finish the game',
    ])
    await expect(page.getByText('Assassin · −1 each')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /sign in|join/i }),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)

    await page.getByRole('link', { name: 'Back to home' }).last().click()
    await expect(page).toHaveURL(/\/home$/)
    const create = page.getByRole('link', {
      name: 'Create a room',
      exact: true,
    })
    const join = page.getByRole('link', { name: 'Join a room', exact: true })
    const rules = page.getByRole('link', { name: 'Rules', exact: true })
    await expect(create).toHaveAttribute('href', '/create')
    await expect(join).toHaveAttribute('href', '/join')
    const joinBox = await join.boundingBox()
    const rulesBox = await rules.boundingBox()
    expect(joinBox).not.toBeNull()
    expect(rulesBox).not.toBeNull()
    expect(rulesBox!.y).toBeGreaterThanOrEqual(joinBox!.y + joinBox!.height)

    await rules.click()
    await expect(page).toHaveURL(/\/rules$/)
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Rules', exact: true }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Back to home' }).first().click()
    await expect(page).toHaveURL(/\/home$/)
  })
}
