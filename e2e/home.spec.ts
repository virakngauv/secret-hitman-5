import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`home shares the app backdrop and preserves navigation at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/home')

    const main = page.getByRole('main')
    await expect(
      page.getByRole('heading', { name: 'Secret Hitman' }),
    ).toBeVisible()
    await expect(main).not.toContainText(/\b(?:timers?|rounds?)\b/i)
    await expect(
      page.getByText('A social word game', { exact: true }),
    ).toBeVisible()
    await expect(main).not.toContainText(
      /12 words|1 assassin|build a clue|choose your entry/i,
    )
    await expect(
      page.getByRole('link', { name: 'Rules', exact: true }),
    ).toBeVisible()
    await testInfo.attach(`home-${viewport.width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    // A transparent home stage exposes the same body backdrop as other routes.
    await expect(main).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(main).toHaveCSS('background-image', 'none')
    const backdrop = await page.locator('body').evaluate((body) => {
      const style = getComputedStyle(body)
      return {
        color: style.backgroundColor,
        image: style.backgroundImage,
        foreground: style.color,
      }
    })
    expect(backdrop.image).toContain('radial-gradient')
    await expect(main).toHaveCSS('color', backdrop.foreground)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)

    for (const [label, path, heading] of [
      ['Create a room', '/create', 'create a room.'],
      ['Join a room', '/join', 'join a room.'],
    ]) {
      await page.getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        backdrop.color,
      )
      await expect(page.locator('body')).toHaveCSS(
        'background-image',
        backdrop.image,
      )
      await page.getByRole('link', { name: 'Back to home' }).click()
      await expect(page).toHaveURL(/\/home$/)
      await expect(
        page.getByRole('heading', { name: 'Secret Hitman' }),
      ).toBeVisible()
    }
  })
}
