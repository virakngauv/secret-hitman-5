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
      '2. Build and submit your clue',
      '3. Pick targets or pass',
      '4. Count the points',
      '5. Finish the game',
    ])
    await expect(
      page.getByText(
        'Each means the picker and clue master receive the same score change.',
      ),
    ).toBeVisible()

    const roleTable = page.getByRole('table', {
      name: 'Role scoring and effects',
    })
    await expect(roleTable).toBeVisible()
    await expect(roleTable.getByRole('columnheader')).toHaveText([
      'Role',
      'Points',
      'Effect',
      'Locked tiles',
    ])
    await expect(roleTable.getByRole('rowheader')).toHaveText([
      'Target',
      'Civilian',
      'Assassin',
    ])
    await expect(roleTable.getByRole('row').nth(1)).toContainText(
      'Target+3 eachKeep going.No target tiles start locked; the clue master can select at most 5 targets total.',
    )
    await expect(roleTable.getByRole('row').nth(2)).toContainText(
      'Civilian−1 eachThe player who selected it stops guessing.3 randomly selected civilian tiles start locked.',
    )
    await expect(roleTable.getByRole('row').nth(3)).toContainText(
      'Assassin−5 eachThe board ends globally for everyone.1 randomly selected assassin tile starts locked.',
    )
    await expect(
      page.getByRole('button', { name: /sign in|join/i }),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    expect(
      await roleTable.evaluate(
        (table) => table.getBoundingClientRect().right <= window.innerWidth,
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
