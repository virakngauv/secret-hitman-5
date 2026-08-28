import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { SECRET_HITMAN_WORDS } from '../lib/words'

const widths = [320, 359, 360, 361, 375, 390, 414, 639, 640, 928, 1216, 1280]
const longestWord = [...SECRET_HITMAN_WORDS].sort(
  (left, right) => right.length - left.length,
)[0]

test('boards remain readable through hinting, guessing, and final reveal at mobile and desktop widths', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  try {
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    await host.setViewportSize({ width: 360, height: 900 })
    await guest.setViewportSize({ width: 360, height: 900 })
    await host.goto('/create')
    // The server-rendered input can accept text before hydration; wait for
    // the socket-backed form to be ready so hydration cannot reset the name.
    await expect(
      host.getByRole('button', { name: 'Create', exact: true }),
    ).toBeEnabled()
    await host.getByLabel('Name').fill('Ada Layout')
    await host.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(
      host.getByRole('heading', { name: 'Assemble the room.' }),
    ).toBeVisible()
    const roomCode = new URL(host.url()).pathname.slice(1)
    await guest.goto(`/${roomCode}`)
    await guest.getByLabel('Name').fill('Grace Layout')
    await guest.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(host.getByText('Grace Layout', { exact: true })).toBeVisible()
    await host.getByRole('button', { name: 'Start the single round' }).click()

    await expect(host.getByLabel('Your twelve word board')).toBeVisible()
    const locked = host.locator('button[data-card-locked="true"]')
    await expect(locked).toHaveCount(4)
    await expect(host.locator('[data-card-kind="target"]')).toHaveCount(1)
    await expect(host.locator('[data-card-kind="civilian"]')).toHaveCount(2)
    const fixedBefore = await locked.evaluateAll((cards) =>
      cards.map((card) => ({
        id: card.getAttribute('data-card-id'),
        role: card.getAttribute('data-card-kind'),
        text: card.textContent,
      })),
    )
    for (const card of await locked.all()) {
      await expect(card).toBeDisabled()
      await expect(card.locator('.word-card-lock')).toBeVisible()
    }
    await host.reload()
    await expect(host.getByLabel('Your twelve word board')).toBeVisible()
    expect(
      await locked.evaluateAll((cards) =>
        cards.map((card) => ({
          id: card.getAttribute('data-card-id'),
          role: card.getAttribute('data-card-kind'),
          text: card.textContent,
        })),
      ),
    ).toEqual(fixedBefore)
    await expect(host.locator('.hint-number-value')).toHaveText('1')
    await expect(host.locator('[data-card-kind="assassin"]')).toBeDisabled()
    const targets = host.locator('button[data-card-kind="neutral"]')
    const targetId = await targets.first().getAttribute('data-card-id')
    await targets.nth(0).click()
    await expect(targets.nth(0)).toHaveAttribute('aria-pressed', 'true')
    await checkWidths(host, 'hinting', testInfo)

    await host.getByLabel('Your hint').fill('Orbit')
    await host.getByRole('button', { name: 'Lock in hint · 2' }).click()
    await expect(host.getByText('Hint locked in')).toBeVisible()
    await guest.getByLabel('Your hint').fill('Garden')
    await guest.getByRole('button', { name: 'Lock in hint · 1' }).click()
    await host.getByRole('button', { name: 'Start guessing' }).click()
    await expect(guest.getByLabel('Current guessing board')).toBeVisible()

    await guest.locator(`button[data-card-id="${targetId}"]`).click()
    await expect(guest.getByText(/Target found/)).toBeVisible()
    await expect(guest.locator('.score-value')).toHaveText(['1', '1'])
    await expect(
      guest.locator(`button[data-card-id="${targetId}"]`),
    ).toBeDisabled()
    await checkWidths(guest, 'guessing', testInfo)

    await guest.setViewportSize({ width: 360, height: 900 })
    await guest.getByRole('button', { name: 'I’m done guessing' }).click()
    await host.getByRole('button', { name: 'Next hint' }).click()
    await expect(host.getByText('Garden', { exact: true })).toBeVisible()
    await host.getByRole('button', { name: 'I’m done guessing' }).click()
    await host.getByRole('button', { name: 'Finish the game' }).click()
    await expect(guest.getByLabel('Fully revealed final board')).toBeVisible()
    await checkWidths(guest, 'finished', testInfo)
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()])
  }
})

async function checkWidths(page: Page, phase: string, testInfo: TestInfo) {
  for (const width of widths) {
    await test.step(`${phase} at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 })
      await page.mouse.move(0, 0)
      const grid = page.locator('.word-grid')
      await expect(grid.locator('.word-card')).toHaveCount(12)
      const columns = width < 360 ? 2 : width >= 1216 ? 4 : 3
      await expect
        .poll(() =>
          grid.evaluate((element) => {
            const boxes = [...element.children].map((card) =>
              card.getBoundingClientRect(),
            )
            return {
              columns: new Set(boxes.map(({ x }) => Math.round(x))).size,
              rows: new Set(boxes.map(({ y }) => Math.round(y))).size,
            }
          }),
        )
        .toEqual({ columns, rows: 12 / columns })
      await assertCardContentFits(page)

      // Layout-only stress fixtures exercise real deck words and wrapping,
      // without changing game state, roles, or interactions.
      const originalWords = await grid
        .locator('.word-card-word')
        .allTextContents()
      try {
        for (const [label, word] of [
          ['long-words', longestWord],
          ['wrapped-words', 'COUNTERREVOLUTIONARIES'],
        ]) {
          await grid
            .locator('.word-card-word')
            .evaluateAll((elements, word) => {
              for (const element of elements) element.textContent = word
            }, word)
          await assertCardContentFits(page)
          if ([320, 359, 360, 390, 640, 1280].includes(width)) {
            await grid.screenshot({
              path: testInfo.outputPath(`${phase}-${width}-${label}.png`),
            })
          }
        }
      } finally {
        await grid.locator('.word-card-word').evaluateAll((elements, words) => {
          elements.forEach((element, index) => {
            element.textContent = words[index]
          })
        }, originalWords)
      }
    })
  }
}

async function assertCardContentFits(page: Page) {
  const issues = await page.locator('.word-grid').evaluate((grid) => {
    const issues: string[] = []
    if (document.documentElement.scrollWidth > window.innerWidth) {
      issues.push('Page overflows horizontally')
    }
    for (const [index, card] of [...grid.children].entries()) {
      const box = card.getBoundingClientRect()
      const word = card.querySelector<HTMLElement>('.word-card-word')!
      const wordBox = word.getBoundingClientRect()
      if (
        Math.abs(
          wordBox.left + wordBox.width / 2 - (box.left + box.width / 2),
        ) > 1 ||
        Math.abs(
          wordBox.top + wordBox.height / 2 - (box.top + box.height / 2),
        ) > 1
      ) {
        issues.push(`Card ${index}: word is not centered`)
      }
      if (getComputedStyle(word).textAlign !== 'center') {
        issues.push(`Card ${index}: wrapped word lines are not centered`)
      }
      if (box.width < 44 || box.height < 44) {
        issues.push(`Card ${index} is smaller than a 44px tap target`)
      }
      const contents = [...card.querySelectorAll<HTMLElement>('span')]
      const lock = card
        .querySelector('.word-card-lock')
        ?.getBoundingClientRect()
      if (lock) {
        if (
          lock.right > box.right ||
          lock.top < box.top ||
          lock.left < box.left + box.width / 2
        ) {
          issues.push(`Card ${index}: lock is not inside the top-right corner`)
        }
        for (const content of contents) {
          const rect = content.getBoundingClientRect()
          if (
            rect.left < lock.right &&
            rect.right > lock.left &&
            rect.top < lock.bottom &&
            rect.bottom > lock.top
          ) {
            issues.push(`Card ${index}: lock overlaps ${content.className}`)
          }
        }
      }
      for (const content of contents) {
        const rect = content.getBoundingClientRect()
        if (
          rect.left < box.left ||
          rect.right > box.right ||
          rect.top < box.top ||
          rect.bottom > box.bottom ||
          (!content.classList.contains('word-card-claimers') &&
            content.scrollWidth > content.clientWidth + 1)
        ) {
          issues.push(`Card ${index}: ${content.className} overflows`)
        }
      }
      for (
        let contentIndex = 1;
        contentIndex < contents.length;
        contentIndex += 1
      ) {
        if (
          contents[contentIndex - 1].getBoundingClientRect().bottom >
          contents[contentIndex].getBoundingClientRect().top + 1
        ) {
          issues.push(`Card ${index}: labels or words overlap`)
        }
      }
    }
    return issues
  })
  expect(issues).toEqual([])
}
