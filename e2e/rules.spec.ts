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
    await expect(page).toHaveTitle('Rules | Secret Hitman')
    await expect(
      page.getByRole('heading', { name: 'Rules', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'How to play',
      'Tile points',
      'Hint writing tips',
      'Host controls',
    ])
    await expect(page.getByText('then share one word or phrase')).toBeVisible()
    await expect(
      page.getByText('then share one word plus that number'),
    ).toHaveCount(0)
    await expect(
      page.getByText('You do not need to type the number.'),
    ).toBeVisible()
    await expect(
      page.getByText(
        "Each claimed word changes both the guesser's score and the hint writer's score by the amount below.",
      ),
    ).toBeVisible()

    const roleTable = page.getByRole('table', { name: 'Tile points' })
    await expect(roleTable).toBeVisible()
    await expect(roleTable.getByRole('columnheader')).toHaveText([
      'Word',
      'Points',
      'What happens',
    ])
    await expect(roleTable.getByRole('rowheader')).toHaveText([
      'Target',
      'Civilian',
      'Assassin',
    ])
    await expect(roleTable.getByRole('cell')).toHaveText([
      '+3 each',
      'Keep guessing while targets remain.',
      '−1 each',
      'You cannot guess again on this board.',
      '−5 each',
      'Guessing ends for everyone on this board.',
    ])
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

    const backHome = page.getByRole('link', { name: 'Back to home' })
    await expect(backHome).toHaveCount(1)
    // The single back link is sticky, so it is reachable without scrolling
    // on every viewport.
    const dockedBox = await backHome.boundingBox()
    expect(dockedBox).not.toBeNull()
    expect(dockedBox!.y + dockedBox!.height).toBeLessThanOrEqual(
      viewport.height,
    )

    await backHome.click()
    await expect(page).toHaveURL((url) => url.pathname === '/')
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
    await backHome.click()
    await expect(page).toHaveURL((url) => url.pathname === '/')
  })
}
