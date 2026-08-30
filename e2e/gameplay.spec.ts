import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

test.describe('Secret Hitman single round', () => {
  for (const ending of ['pass', 'civilian', 'targets', 'assassin'] as const) {
    test(`preserves ${ending} completion and visibility across reloads`, async ({
      browser,
    }, testInfo) => {
      test.setTimeout(90_000)
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
        await expect(host.getByText('Linus', { exact: true })).toBeVisible()
        await host.getByRole('button', { name: 'Start game' }).click()
        await makeHint(host, 'Orbit', 2)
        await makeHint(guest, 'Garden', 2)
        await makeHint(third, 'Metal', 2)
        await joinRoom(spectator, roomCode, 'Spectator')
        await host.getByRole('button', { name: 'Start guessing' }).click()
        await expect(
          host.locator('button[data-card-kind="assassin"]'),
        ).toHaveCount(1)
        const assassinId = await host
          .locator('button[data-card-kind="assassin"]')
          .getAttribute('data-card-id')
        const targetIds = await host
          .locator('button[data-card-kind="target"]')
          .evaluateAll((cards) =>
            cards.map((card) => card.getAttribute('data-card-id')),
          )
        const [targetId, finalTargetId] = targetIds
        if (!targetId || !finalTargetId) {
          throw new Error('Expected two target cards.')
        }
        const civilianId = await host
          .locator('button[data-card-kind="civilian"]')
          .first()
          .getAttribute('data-card-id')
        const roles = await host
          .locator('button[data-card-id]')
          .evaluateAll((cards) =>
            cards.map((card) => card.getAttribute('data-card-kind')),
          )
        await expect(
          guest.locator('button[data-card-kind="hidden"]'),
        ).toHaveCount(12)
        await expect(
          third.locator('button[data-card-kind="hidden"]'),
        ).toHaveCount(12)
        if (ending === 'pass') {
          await guest.getByRole('button', { name: 'I’m done guessing' }).click()
        } else if (ending === 'targets') {
          await guest.locator(`button[data-card-id="${targetId}"]`).click()
          await third.locator(`button[data-card-id="${finalTargetId}"]`).click()
        } else {
          await guest
            .locator(
              `button[data-card-id="${ending === 'assassin' ? assassinId : civilianId}"]`,
            )
            .click()
        }
        if (ending === 'assassin') {
          await expect(
            guest.getByText(/Assassin. You and the clue-giver/),
          ).toBeVisible()
        }
        await expect(
          guest.getByText(/Guessing is done for this hint/),
        ).toBeVisible()
        await expect(
          guest.locator('button[data-card-kind="hidden"]'),
        ).toHaveCount(0)
        expect(
          await guest
            .locator('button[data-card-id]')
            .evaluateAll((cards) =>
              cards.map((card) => card.getAttribute('data-card-kind')),
            ),
        ).toEqual(roles)
        await expect(guest.locator('button[data-card-id]:enabled')).toHaveCount(
          0,
        )
        for (const viewer of [third, spectator]) {
          await expect(
            viewer.locator('button[data-card-kind="hidden"]'),
          ).toHaveCount(
            ending === 'assassin' || ending === 'targets'
              ? 0
              : ending === 'civilian'
                ? 11
                : 12,
          )
          await expect(
            viewer.locator(`button[data-card-id="${assassinId}"]`),
          ).toHaveAttribute(
            'data-card-kind',
            ending === 'assassin' || ending === 'targets'
              ? 'assassin'
              : 'hidden',
          )
          if (ending === 'assassin') {
            await expect(
              viewer.locator(`button[data-card-id="${assassinId}"]`),
            ).toContainText('Grace')
          } else {
            await expect(
              viewer.locator(`button[data-card-id="${assassinId}"]`),
            ).not.toContainText('Grace')
          }
        }
        if (ending === 'assassin' || ending === 'targets') {
          await expect(
            third.locator(`button[data-card-id="${assassinId}"]`),
          ).toBeDisabled()
        } else {
          await expect(
            third.locator(`button[data-card-id="${assassinId}"]`),
          ).toBeEnabled()
        }
        await guest.reload()
        await third.reload()
        await expect(guest.locator('button[data-card-id]')).toHaveCount(12)
        await expect(
          guest.locator('button[data-card-kind="hidden"]'),
        ).toHaveCount(0)
        await expect(guest.locator('button[data-card-id]:enabled')).toHaveCount(
          0,
        )
        await expect(
          third.locator(`button[data-card-id="${assassinId}"]`),
        ).toHaveAttribute(
          'data-card-kind',
          ending === 'assassin' || ending === 'targets' ? 'assassin' : 'hidden',
        )
        if (ending === 'assassin' || ending === 'targets') {
          await expect(
            third.locator(`button[data-card-id="${assassinId}"]`),
          ).toBeDisabled()
        } else {
          await expect(
            third.locator(`button[data-card-id="${assassinId}"]`),
          ).toBeEnabled()
        }
        await guest.screenshot({
          path: testInfo.outputPath('finished-picker.png'),
          fullPage: true,
        })
        await third.screenshot({
          path: testInfo.outputPath('active-picker.png'),
          fullPage: true,
        })
        if (ending === 'assassin') {
          for (const [name, score] of [
            ['Ada', '-5'],
            ['Grace', '-5'],
            ['Linus', '0'],
          ]) {
            await expect(
              third
                .locator('.score-row')
                .filter({ has: third.getByText(name, { exact: true }) })
                .locator('.score-value'),
            ).toHaveText(score)
          }
          for (const viewer of [guest, third, spectator]) {
            await expect(
              viewer.locator('button[data-card-kind="hidden"]'),
            ).toHaveCount(0)
            await expect(
              viewer.locator('button[data-card-id]:enabled'),
            ).toHaveCount(0)
            await expect(
              viewer.locator(`button[data-card-id="${assassinId}"]`),
            ).toContainText('Grace')
          }
          await expect(
            host.getByRole('button', { name: 'Next hint' }),
          ).toBeEnabled()
        } else if (ending === 'targets') {
          for (const viewer of [guest, third, spectator]) {
            await expect(
              viewer.getByLabel('Completed and fully revealed board'),
            ).toBeVisible()
            await expect(
              viewer.locator('button[data-card-kind="hidden"]'),
            ).toHaveCount(0)
            await expect(
              viewer.locator('button[data-card-id]:enabled'),
            ).toHaveCount(0)
            await expect(
              viewer.locator(`button[data-card-id="${targetId}"]`),
            ).toContainText('Grace')
            await expect(
              viewer.locator(`button[data-card-id="${finalTargetId}"]`),
            ).toContainText('Linus')
            await expect(viewer.getByText('Unselected')).toHaveCount(0)
          }
          await expect(
            host.getByRole('button', { name: 'Next hint' }),
          ).toBeEnabled()
        } else {
          await third.locator(`button[data-card-id="${targetId}"]`).click()
          await expect(third.getByText(/Target found/)).toBeVisible()
          for (const viewer of [guest, third, spectator]) {
            await expect(
              viewer.locator(`button[data-card-id="${targetId}"]`),
            ).toContainText('Linus')
            await expect(
              viewer.locator(`button[data-card-id="${targetId}"]`),
            ).toBeDisabled()
          }
        }
      } finally {
        await Promise.all(contexts.map((context) => context.close()))
      }
    })
  }

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
      await host.getByRole('button', { name: 'Start game' }).click()

      await makeHint(host, 'Orbit', 2)
      await host.reload()
      await expect(host.getByLabel('Your hint')).toHaveValue('Orbit')
      await expect(host.getByLabel('Your hint')).toHaveAttribute('readonly')
      await expect(host.locator('button[data-card-kind="target"]')).toHaveCount(
        2,
      )
      await expect(
        host.locator('button[data-card-kind="civilian"]'),
      ).toHaveCount(9)
      await host.getByRole('button', { name: 'Unlock / Edit hint' }).click()
      await expect(host.getByLabel('Your hint')).toBeEditable()
      await expect(host.getByLabel('Your hint')).toHaveValue('Orbit')
      await expect(
        host.locator('button[data-card-kind="neutral"]'),
      ).toHaveCount(6)
      await expect(guest.getByText('Choosing')).toHaveCount(2)
      await host.getByLabel('Your hint').fill('Galaxy')
      await host.locator('button[data-card-kind="target"]').first().click()
      await host.locator('button[data-card-kind="neutral"]').first().click()
      await host.getByRole('button', { name: 'Lock in hint · 2' }).click()
      await expect(host.getByText('Hint locked in')).toBeVisible()
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
      await expect(host.getByText('Galaxy', { exact: true })).toBeVisible()
      await expect(spectator.getByText(/Spectator mode/)).toBeVisible()

      const targetId = await host
        .locator('button[data-card-kind="target"]')
        .first()
        .getAttribute('data-card-id')
      expect(targetId).toBeTruthy()
      await guest.locator(`button[data-card-id="${targetId}"]`).click()
      await expect(guest.getByText(/Target found/)).toBeVisible()
      await expect(guest.locator('.score-value')).toHaveText(['3', '3'])

      const nextHint = host.getByRole('button', { name: 'Next hint' })
      await expect(nextHint).toBeDisabled()
      await expect(
        host.getByText('Waiting for players to finish guessing.'),
      ).toBeVisible()
      await host.reload()
      await guest.reload()
      await expect(nextHint).toBeDisabled()
      await guest.getByRole('button', { name: 'I’m done guessing' }).click()
      await expect(nextHint).toBeEnabled()
      await expect(host.getByText('Galaxy', { exact: true })).toBeVisible()
      await host.getByRole('button', { name: 'Next hint' }).click()
      await expect(host.getByText('Garden', { exact: true })).toBeVisible()
      await expect(
        host.getByRole('button', { name: 'Finish the game' }),
      ).toBeDisabled()
      await host.getByRole('button', { name: 'I’m done guessing' }).click()
      await expect(
        host.getByRole('button', { name: 'Finish the game' }),
      ).toBeEnabled()
      await host.getByRole('button', { name: 'Finish the game' }).click()

      await expect(host.getByText('Game complete')).toBeVisible()
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

async function joinRoom(page: Page, roomCode: string, name: string) {
  await page.goto(`/${roomCode}`)
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.getByLabel('Name')).not.toBeVisible()
}
