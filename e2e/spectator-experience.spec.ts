import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test'

test.describe('spectator experience audit', () => {
  test('follows a complete multiplayer game without receiving player controls or private roles', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000)
    const contexts: BrowserContext[] = []

    try {
      const host = await newPlayer(browser, contexts)
      const guest = await newPlayer(browser, contexts)
      const third = await newPlayer(browser, contexts)
      const spectator = await newPlayer(browser, contexts)

      await host.goto('/home')
      await host.getByRole('link', { name: 'Create a room' }).click()
      await host.getByLabel('Name').fill('Ada')
      await host.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(
        host.getByRole('heading', { name: 'Assemble the room.' }),
      ).toBeVisible()
      const roomCode = new URL(host.url()).pathname.slice(1)

      await joinRoom(guest, roomCode, 'Grace')
      await joinRoom(third, roomCode, 'Linus')
      await expect(host.getByText('Grace', { exact: true })).toBeVisible()
      await expect(host.getByText('Linus', { exact: true })).toBeVisible()
      await host.getByRole('button', { name: 'Start game' }).click()

      await makeHint(host, 'Orbit', 2)
      await makeHint(guest, 'Garden', 2)
      await makeHint(third, 'Metal', 2)
      await joinRoom(spectator, roomCode, 'Sofia')
      await expect(
        spectator.getByRole('heading', { name: 'You joined as a spectator' }),
      ).toBeVisible()
      await expect(spectator.getByLabel('Your hint')).toHaveCount(0)
      await expect(spectator.locator('[data-card-id]')).toHaveCount(0)
      await capture(spectator, testInfo, '01-hinting-waiting-desktop.png')

      await spectator.reload()
      await expect(
        spectator.getByRole('heading', { name: 'You joined as a spectator' }),
      ).toBeVisible()
      await expect(spectator.getByLabel('Your hint')).toHaveCount(0)

      await host.getByRole('button', { name: 'Start guessing' }).click()
      await expect(spectator.getByText(/Spectator mode/)).toBeVisible()
      await expect(spectator.getByText('Orbit', { exact: true })).toBeVisible()
      await expect(
        spectator.locator('button[data-card-kind="hidden"]'),
      ).toHaveCount(12)
      await expect(
        spectator.locator('button[data-card-id]:enabled'),
      ).toHaveCount(0)
      await expect(host.locator('button[data-card-kind="target"]')).toHaveCount(
        2,
      )
      await capture(spectator, testInfo, '02-first-turn-desktop.png')

      await spectator.setViewportSize({ width: 390, height: 844 })
      await capture(spectator, testInfo, '03-first-turn-mobile.png')
      await spectator.setViewportSize({ width: 1440, height: 900 })

      const firstTargetId = await host
        .locator('button[data-card-kind="target"]')
        .first()
        .getAttribute('data-card-id')
      if (!firstTargetId) throw new Error('Expected a target on Ada’s board.')
      await guest.locator(`button[data-card-id="${firstTargetId}"]`).click()
      await expect(
        spectator.locator(`button[data-card-id="${firstTargetId}"]`),
      ).toHaveAttribute('data-card-kind', 'target')
      await expect(
        spectator.locator(`button[data-card-id="${firstTargetId}"]`),
      ).toContainText('Grace')
      await guest.getByRole('button', { name: 'I’m done guessing' }).click()
      await third.getByRole('button', { name: 'I’m done guessing' }).click()
      await expect(
        host.getByRole('button', { name: 'Next hint' }),
      ).toBeEnabled()
      await capture(spectator, testInfo, '04-target-and-passes.png')

      await host.getByRole('button', { name: 'Next hint' }).click()
      await expect(spectator.getByText('Garden', { exact: true })).toBeVisible()
      const civilianId = await guest
        .locator('button[data-card-kind="civilian"]')
        .first()
        .getAttribute('data-card-id')
      if (!civilianId) throw new Error('Expected a civilian on Grace’s board.')
      await host.locator(`button[data-card-id="${civilianId}"]`).click()
      await third.getByRole('button', { name: 'I’m done guessing' }).click()
      await expect(
        spectator.locator(`button[data-card-id="${civilianId}"]`),
      ).toHaveAttribute('data-card-kind', 'civilian')
      await expect(
        spectator.locator(`button[data-card-id="${civilianId}"]`),
      ).toContainText('Ada')
      await capture(spectator, testInfo, '05-civilian-turn.png')

      await host.getByRole('button', { name: 'Next hint' }).click()
      await expect(spectator.getByText('Metal', { exact: true })).toBeVisible()
      const assassinId = await third
        .locator('button[data-card-kind="assassin"]')
        .getAttribute('data-card-id')
      if (!assassinId) throw new Error('Expected an assassin on Linus’s board.')
      await host.locator(`button[data-card-id="${assassinId}"]`).click()
      await expect(
        spectator.getByLabel('Completed and fully revealed board'),
      ).toBeVisible()
      await expect(
        spectator.locator('button[data-card-kind="hidden"]'),
      ).toHaveCount(0)
      await expect(
        spectator.locator(`button[data-card-id="${assassinId}"]`),
      ).toContainText('Ada')
      await capture(spectator, testInfo, '06-assassin-reveal.png')

      await spectator.context().setOffline(true)
      await expect(
        spectator.getByRole('heading', { name: 'Reconnecting' }),
      ).toBeVisible()
      await capture(spectator, testInfo, '07-reconnecting.png')
      await spectator.context().setOffline(false)
      await expect(spectator.getByText(/Spectator mode/)).toBeVisible()
      await expect(
        spectator.getByLabel('Completed and fully revealed board'),
      ).toBeVisible()
      await expect(
        spectator.getByRole('button', { name: 'Finish the game' }),
      ).toHaveCount(0)

      await expect(
        host.getByRole('button', { name: 'Finish the game' }),
      ).toBeEnabled()
      await host.getByRole('button', { name: 'Finish the game' }).click()
      await expect(spectator.getByText('Final standings')).toBeVisible()
      await expect(spectator.locator('[data-card-kind="hidden"]')).toHaveCount(
        0,
      )
      await capture(spectator, testInfo, '08-final-standings.png')

      await spectator.reload()
      await expect(spectator.getByText('Final standings')).toBeVisible()
      await expect(
        spectator.getByRole('button', {
          name: /^(Start guessing|Next hint|Finish the game)$/,
        }),
      ).toHaveCount(0)
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })
})

async function newPlayer(
  browser: Browser,
  contexts: BrowserContext[],
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  contexts.push(context)
  return context.newPage()
}

async function joinRoom(page: Page, roomCode: string, name: string) {
  await page.goto(`/${roomCode}`)
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.getByLabel('Name')).not.toBeVisible()
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

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const configuredDirectory = process.env.SPECTATOR_AUDIT_DIR?.trim()
  const path = configuredDirectory
    ? resolve(configuredDirectory, name)
    : testInfo.outputPath(name)
  if (configuredDirectory)
    await mkdir(resolve(configuredDirectory), { recursive: true })
  await page.screenshot({ path, fullPage: false })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}
