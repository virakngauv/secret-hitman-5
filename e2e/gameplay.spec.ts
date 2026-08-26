import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

test.describe('Secret Hitman single round', () => {
  test('runs two players through hints and guessing while a late joiner spectates', async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = []
    try {
      const host = await newPlayer(browser, contexts)
      const guest = await newPlayer(browser, contexts)
      const spectator = await newPlayer(browser, contexts)

      await host.goto('/home')
      await host.getByRole('link', { name: 'Create a room' }).click()
      await host.getByLabel('Name').fill('Ada')
      await host.getByRole('button', { name: 'Create' }).click()
      await expect(
        host.getByRole('heading', { name: 'Assemble the room.' }),
      ).toBeVisible()
      const roomCode = new URL(host.url()).pathname.slice(1)
      expect(roomCode).toMatch(/^[bcdfghkpqrstvz]{4}[2-9y]$/)

      await guest.goto(`/${roomCode}`)
      await guest.getByLabel('Name').fill('Grace')
      await guest.getByRole('button', { name: 'Join' }).click()
      await expect(host.getByText('Grace', { exact: true })).toBeVisible()
      await host.getByRole('button', { name: 'Start the single round' }).click()

      await makeHint(host, 'Orbit', 2)
      await makeHint(guest, 'Garden', 3)
      await expect(host.getByText('2/2')).toBeVisible()

      await spectator.goto(`/${roomCode}`)
      await expect(
        spectator.getByRole('heading', { name: 'Join as a spectator' }),
      ).toBeVisible()
      await spectator.getByLabel('Name').fill('Linus')
      await spectator.getByRole('button', { name: 'Join' }).click()
      await expect(
        spectator.getByText('You joined as a spectator'),
      ).toBeVisible()

      await host.getByRole('button', { name: 'Start guessing' }).click()
      await expect(host.getByText('Orbit', { exact: true })).toBeVisible()
      await expect(spectator.getByText(/Spectator mode/)).toBeVisible()

      const targetId = await host
        .locator('button[data-card-kind="target"]')
        .first()
        .getAttribute('data-card-id')
      expect(targetId).toBeTruthy()
      await guest.locator(`button[data-card-id="${targetId}"]`).click()
      await expect(guest.getByText(/Target found/)).toBeVisible()
      await expect(guest.locator('.score-value')).toHaveText(['1', '1'])

      await host.getByRole('button', { name: 'Next hint' }).click()
      await expect(host.getByText('Garden', { exact: true })).toBeVisible()
      await host.getByRole('button', { name: 'Finish the game' }).click()

      await expect(host.getByText('Single round complete')).toBeVisible()
      await expect(guest.getByText('Final standings')).toBeVisible()
      await expect(spectator.getByText('Final standings')).toBeVisible()
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })
})

async function newPlayer(
  browser: Browser,
  contexts: BrowserContext[],
): Promise<Page> {
  const context = await browser.newContext()
  contexts.push(context)
  return context.newPage()
}

async function makeHint(page: Page, hint: string, count: number) {
  await expect(page.getByLabel('Your hint')).toBeVisible()
  await page.getByLabel('Your hint').fill(hint)
  const cards = page.locator('button[data-card-kind="neutral"]')
  for (let index = 0; index < count; index += 1) {
    await cards.nth(index).click()
  }
  await page.getByRole('button', { name: `Lock in hint · ${count}` }).click()
  await expect(page.getByText('Hint locked in')).toBeVisible()
}
