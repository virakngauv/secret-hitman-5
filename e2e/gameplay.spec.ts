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
        await host.getByRole('button', { name: 'Start guessing' }).click()
        await joinRoom(spectator, roomCode, 'Spectator')
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
        if (targetIds.length !== 2 || !targetId || !finalTargetId) {
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

  test('runs consecutive games after a late spectator returns to the lobby as a player', async ({
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

      await host.getByRole('button', { name: 'Start guessing' }).click()
      await expect(host.getByText('Galaxy', { exact: true })).toBeVisible()
      await spectator.goto(`/${roomCode}`)
      await expect(
        spectator.getByRole('heading', { name: 'Join as a spectator' }),
      ).toBeVisible()
      await spectator.getByLabel('Name').fill('Linus')
      await spectator.getByRole('button', { name: 'Join' }).click()
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
      await expect(nextHint).toBeEnabled()
      await expect(
        host.getByText(
          '1 player is still guessing. You can move on with confirmation.',
        ),
      ).toBeVisible()
      await host.reload()
      await guest.reload()
      await expect(nextHint).toBeEnabled()
      await nextHint.click()
      await expect(
        host.getByRole('alertdialog', { name: 'Move on from this board?' }),
      ).toContainText(
        '1 player is still guessing. Are you sure you want to move on?',
      )
      await host.getByRole('button', { name: 'Cancel' }).click()
      await expect(host.getByText('Galaxy', { exact: true })).toBeVisible()
      await guest.getByRole('button', { name: 'I’m done guessing' }).click()
      await expect(nextHint).toBeEnabled()
      await expect(host.getByText('Galaxy', { exact: true })).toBeVisible()
      await host.getByRole('button', { name: 'Next hint' }).click()
      await expect(host.getByText('Garden', { exact: true })).toBeVisible()
      await expect(
        host.getByRole('button', { name: 'View scoreboard' }),
      ).toBeEnabled()
      await host.getByRole('button', { name: 'I’m done guessing' }).click()
      await expect(
        host.getByRole('button', { name: 'View scoreboard' }),
      ).toBeEnabled()
      await host.getByRole('button', { name: 'View scoreboard' }).click()

      await expect(host.getByText('Game complete')).toBeVisible()
      await expect(guest.getByText('Final standings')).toBeVisible()
      await expect(spectator.getByText('Final standings')).toBeVisible()
      await expect(host.locator('button[data-card-id]')).toHaveCount(0)
      await expect(
        spectator.getByRole('button', { name: 'Return to lobby' }),
      ).toHaveCount(0)
      await spectator.reload()
      await expect(spectator.getByText('Final standings')).toBeVisible()

      await host.getByRole('button', { name: 'Return to lobby' }).click()
      for (const player of [host, guest, spectator]) {
        await expect(
          player.getByRole('heading', { name: 'Assemble the room.' }),
        ).toBeVisible()
        await expect(player.getByText('Linus', { exact: true })).toBeVisible()
        expect(new URL(player.url()).pathname).toBe(`/${roomCode}`)
      }

      await host.getByRole('button', { name: 'Start game' }).click()
      await makeHint(host, 'Second orbit', 1)
      await makeHint(guest, 'Second garden', 1)
      await makeHint(spectator, 'Second metal', 1)
      await host.getByRole('button', { name: 'Start guessing' }).click()

      await guest.getByRole('button', { name: 'I’m done guessing' }).click()
      await spectator.getByRole('button', { name: 'I’m done guessing' }).click()
      await host.getByRole('button', { name: 'Next hint' }).click()
      await host.getByRole('button', { name: 'I’m done guessing' }).click()
      await spectator.getByRole('button', { name: 'I’m done guessing' }).click()
      await host.getByRole('button', { name: 'Next hint' }).click()
      await expect(
        host.getByRole('heading', { name: 'Linus is the clue-giver' }),
      ).toBeVisible()
      await host.getByRole('button', { name: 'I’m done guessing' }).click()
      await guest.getByRole('button', { name: 'I’m done guessing' }).click()
      await host.getByRole('button', { name: 'View scoreboard' }).click()
      await expect(spectator.getByText('Final standings')).toBeVisible()
      await host.getByRole('button', { name: 'Return to lobby' }).click()
      await expect(
        spectator.getByRole('heading', { name: 'Assemble the room.' }),
      ).toBeVisible()
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })

  test('reviews and rejects clues while admitting and removing hinting participants', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const contexts: BrowserContext[] = []
    try {
      const host = await newPlayer(browser, contexts)
      const guest = await newPlayer(browser, contexts)
      const late = await newPlayer(browser, contexts)

      await host.goto('/home')
      await host.getByRole('link', { name: 'Create a room' }).click()
      await host.getByLabel('Name').fill('Ada')
      await host.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(
        host.getByRole('heading', { name: 'Assemble the room.' }),
      ).toBeVisible()
      const roomCode = new URL(host.url()).pathname.slice(1)
      await joinRoom(guest, roomCode, 'Grace')
      await host.getByRole('button', { name: 'Start game' }).click()
      await makeHint(host, 'Orbit', 2)

      await late.goto(`/${roomCode}`)
      await expect(
        late.getByRole('heading', { name: 'Join the operation' }),
      ).toBeVisible()
      await late.getByLabel('Name').fill('Linus')
      await late.getByRole('button', { name: 'Join', exact: true }).click()
      await expect(late.getByLabel('Your twelve word board')).toBeVisible()
      await expect(host.getByText('1/3')).toBeVisible()
      await expect(late.getByLabel("Ada's hint: Orbit, 2")).toBeVisible()

      await makeHint(late, 'New York', 3)
      await expect(host.getByLabel("Ada's hint: Orbit, 2")).toBeVisible()
      await expect(host.getByLabel("Linus's hint: New York, 3")).toBeVisible()

      await host.getByRole('button', { name: "Reject Linus's hint" }).click()
      await expect(
        late.getByRole('alertdialog', { name: 'Your hint was rejected' }),
      ).toContainText(
        "The host rejected your hint! You've been given a new board.",
      )
      await late.getByRole('button', { name: 'Got it' }).click()
      await expect(
        late.getByText(
          'The host rejected this hint. Your board was refreshed; create and lock in a new hint.',
        ),
      ).toBeVisible()
      await expect(late.getByLabel('Your hint')).toHaveValue('')
      await expect(late.locator('button[data-card-kind="target"]')).toHaveCount(
        0,
      )
      await expect(host.getByText('Needs revision')).toBeVisible()
      await makeHint(late, 'City', 3)
      await expect(host.getByLabel("Linus's hint: City, 3")).toBeVisible()
      await makeHint(guest, 'Garden', 2)
      await expect(late.getByLabel("Grace's hint: Garden, 2")).toBeVisible()

      await host
        .getByRole('button', { name: 'Remove Grace from this game' })
        .click()
      await expect(
        host.getByRole('alertdialog', {
          name: 'Remove Grace from this game?',
        }),
      ).toContainText(/board, submitted hint, readiness, and remaining turn/i)
      await host
        .getByRole('alertdialog', { name: 'Remove Grace from this game?' })
        .getByRole('button', { name: 'Remove', exact: true })
        .click()
      await expect(host.getByText('2/2')).toBeVisible()
      await expect(guest.getByText(/host removed this browser/i)).toBeVisible()
      const removedHomeLink = guest.getByRole('link', {
        name: 'Back to home',
      })
      const removedHomeBox = await removedHomeLink.boundingBox()
      const removedViewport = guest.viewportSize()
      expect(removedHomeBox).not.toBeNull()
      expect(removedViewport).not.toBeNull()
      expect(
        Math.abs(
          removedHomeBox!.x +
            removedHomeBox!.width / 2 -
            removedViewport!.width / 2,
        ),
      ).toBeLessThan(2)
      await expect(
        host.getByRole('button', { name: 'Start guessing' }),
      ).toBeEnabled()

      await host.getByRole('button', { name: 'Start guessing' }).click()
      await expect(host.getByText('Turn 1 of 2')).toBeVisible()
      await expect(late.getByText('Turn 1 of 2')).toBeVisible()
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })

  test('removes a guessing participant, preserves history, and skips their future turn', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const contexts: BrowserContext[] = []
    try {
      const host = await newPlayer(browser, contexts)
      const guest = await newPlayer(browser, contexts)
      const removed = await newPlayer(browser, contexts)

      await host.goto('/home')
      await host.getByRole('link', { name: 'Create a room' }).click()
      await host.getByLabel('Name').fill('Ada')
      await host.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(host).toHaveURL(/\/[a-z2-9]{5}$/)
      const roomCode = new URL(host.url()).pathname.slice(1)
      await joinRoom(guest, roomCode, 'Grace')
      await joinRoom(removed, roomCode, 'Linus')
      await host.getByRole('button', { name: 'Start game' }).click()
      await makeHint(host, 'Orbit', 1)
      await makeHint(guest, 'Garden', 1)
      await makeHint(removed, 'Metal', 1)
      await host.getByRole('button', { name: 'Start guessing' }).click()

      await host
        .getByRole('button', { name: 'Remove Linus from this game' })
        .click()
      await expect(
        host.getByRole('alertdialog', {
          name: 'Remove Linus from this game?',
        }),
      ).toContainText(/submitted hint and board will be skipped/i)
      await host
        .getByRole('alertdialog', { name: 'Remove Linus from this game?' })
        .getByRole('button', { name: 'Remove', exact: true })
        .click()
      await expect(
        removed.getByText(/host removed this browser/i),
      ).toBeVisible()
      await expect(host.getByText('Turn 1 of 2')).toBeVisible()

      await host.getByRole('button', { name: 'Next hint' }).click()
      await expect(
        host.getByRole('alertdialog', { name: 'Move on from this board?' }),
      ).toContainText('1 player is still guessing')
      await host.getByRole('button', { name: 'Move on' }).click()
      await expect(
        host.getByRole('heading', { name: 'Grace is the clue-giver' }),
      ).toBeVisible()
      await expect(host.getByText('Turn 2 of 2')).toBeVisible()
      await expect(host.getByText('Linus', { exact: true })).toHaveCount(0)
      await expect(host.getByText('No longer active')).toHaveCount(0)

      await host.getByRole('button', { name: 'I’m done guessing' }).click()
      await host.getByRole('button', { name: 'View scoreboard' }).click()
      await expect(host.getByText('Final standings')).toBeVisible()
      await expect(host.getByText('Linus', { exact: true })).toHaveCount(0)
      await host.getByRole('button', { name: 'Return to lobby' }).click()
      await leaveRoom(host)
      await expect(host).toHaveURL(/\/home$/)
      await leaveRoom(guest, false)
      await expect(guest).toHaveURL(/\/home$/)
      await removed.goto('/home')
    } finally {
      for (const context of contexts) await context.close()
    }
  })

  test('explains why a two-player hinting round returns to the lobby', async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const contexts: BrowserContext[] = []
    try {
      const host = await newPlayer(browser, contexts)
      const guest = await newPlayer(browser, contexts)

      await host.goto('/home')
      await host.getByRole('link', { name: 'Create a room' }).click()
      await host.getByLabel('Name').fill('Ada')
      await host.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(host).toHaveURL(/\/[a-z2-9]{5}$/)
      const roomCode = new URL(host.url()).pathname.slice(1)
      await joinRoom(guest, roomCode, 'Grace')
      await host.getByRole('button', { name: 'Start game' }).click()

      await leaveRoom(guest)
      await expect(guest).toHaveURL(/\/home$/)

      const dialog = host.getByRole('alertdialog', {
        name: 'The round ended early',
      })
      await expect(dialog).toContainText(
        /another player left.*fewer than two players.*returned to the lobby/i,
      )
      const returnToLobby = dialog.getByRole('button', {
        name: 'Return to lobby',
      })
      await expect(returnToLobby).toBeFocused()
      await returnToLobby.click()

      await expect(dialog).toHaveCount(0)
      await expect(
        host.getByRole('heading', { name: 'Assemble the room.' }),
      ).toBeVisible()
      await expect(
        host.getByRole('button', { name: 'Start game' }),
      ).toBeDisabled()
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })

  test('explains spectator host fallback after every starting player leaves', async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const contexts: BrowserContext[] = []
    try {
      const host = await newPlayer(browser, contexts)
      const guest = await newPlayer(browser, contexts)
      const spectator = await newPlayer(browser, contexts)

      await host.goto('/home')
      await host.getByRole('link', { name: 'Create a room' }).click()
      await host.getByLabel('Name').fill('Ada')
      await host.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(host).toHaveURL(/\/[a-z2-9]{5}$/)
      const roomCode = new URL(host.url()).pathname.slice(1)
      await joinRoom(guest, roomCode, 'Grace')
      await host.getByRole('button', { name: 'Start game' }).click()
      await makeHint(host, 'Orbit', 1)
      await makeHint(guest, 'Garden', 1)
      await host.getByRole('button', { name: 'Start guessing' }).click()
      await joinRoom(spectator, roomCode, 'Sofia')

      await leaveRoom(host)
      await expect(host).toHaveURL(/\/home$/)
      await expect(guest.getByText('Host control')).toBeVisible()
      await leaveRoom(guest)
      await expect(guest).toHaveURL(/\/home$/)

      await expect(
        spectator.getByText(/inherited operational host duties/i),
      ).toContainText(
        /spectator privacy and player-only actions remain unchanged/i,
      )
      await expect(
        spectator.getByRole('button', { name: 'View scoreboard' }),
      ).toBeEnabled()
      await expect(
        spectator.getByRole('button', { name: 'I’m done guessing' }),
      ).toHaveCount(0)
      await spectator.getByRole('button', { name: 'View scoreboard' }).click()
      await expect(spectator.getByText('Final standings')).toBeVisible()
      await spectator.getByRole('button', { name: 'Return to lobby' }).click()
      await leaveRoom(spectator, false)
      await expect(spectator).toHaveURL(/\/home$/)
    } finally {
      for (const context of contexts) await context.close()
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

async function leaveRoom(page: Page, confirmationExpected = true) {
  await page.getByRole('button', { name: 'Leave room' }).click()
  if (!confirmationExpected) {
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    return
  }
  const dialog = page.getByRole('alertdialog', {
    name: /Leave (?:as host|this room)\?/,
  })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Leave room' }).click()
}

async function joinRoom(page: Page, roomCode: string, name: string) {
  await page.goto(`/${roomCode}`)
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.getByLabel('Name')).not.toBeVisible()
}
