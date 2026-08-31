import { expect, test, type Page, type TestInfo } from '@playwright/test'

const widths = [320, 359, 360, 361, 375, 390, 414, 639, 640, 928, 1216, 1280]
const longPickerName = 'Grace Hopper With An Extraordinarily Long Picker N'

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
    await guest.getByLabel('Name').fill(longPickerName)
    await guest.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(host.getByText(longPickerName, { exact: true })).toBeVisible()
    await host.getByRole('button', { name: 'Start game' }).click()

    await expect(host.getByLabel('Your twelve word board')).toBeVisible()
    const locked = host.locator('button[data-card-locked="true"]')
    await expect(locked).toHaveCount(4)
    await expect(host.locator('[data-card-kind="target"]')).toHaveCount(0)
    await expect(host.locator('[data-card-kind="civilian"]')).toHaveCount(3)
    const available = host
      .getByRole('button', { name: /Available −1/i })
      .first()
    await expect(available).toBeVisible()
    const roleLabel = available.locator('.word-card-index')
    await expect(roleLabel).toHaveText('Available')
    for (const property of ['margin-top', 'margin-left']) {
      const value = await roleLabel.evaluate(
        (element, propertyName) =>
          getComputedStyle(element).getPropertyValue(propertyName),
        property,
      )
      expect(Number.parseFloat(value)).toBeCloseTo(3.2, 1)
    }
    await expect(available.locator('.word-card-score')).toHaveText('−1')
    await expect(available.locator('.word-card-score')).toHaveCSS(
      'font-style',
      'normal',
    )
    await expect(available.locator('.word-card-score')).toHaveCSS(
      'position',
      'absolute',
    )
    const availableBox = await available.boundingBox()
    const scoreBox = await available.locator('.word-card-score').boundingBox()
    if (!availableBox || !scoreBox) throw new Error('Score box is not visible')
    const rightInset =
      availableBox.x + availableBox.width - scoreBox.x - scoreBox.width
    const bottomInset =
      availableBox.y + availableBox.height - scoreBox.y - scoreBox.height
    expect(rightInset).toBeGreaterThanOrEqual(0)
    expect(rightInset).toBeLessThan(16)
    expect(bottomInset).toBeGreaterThanOrEqual(0)
    expect(bottomInset).toBeLessThan(16)
    await expect(
      host.getByRole('button', { name: /Civilian −1.*Locked/i }).first(),
    ).toBeVisible()
    await expect(
      host.getByRole('button', { name: /Assassin −5.*Locked/i }),
    ).toBeVisible()
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
      const roleBox = await card.locator('.word-card-index').boundingBox()
      const lockBox = await card.locator('.word-card-lock').boundingBox()
      if (!roleBox || !lockBox) {
        throw new Error('Locked role and lock icon are not visible')
      }
      expect(Math.abs(roleBox.y - lockBox.y)).toBeLessThanOrEqual(1)
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
    await expect(host.locator('.hint-number-value')).toHaveText('0')
    await expect(host.locator('[data-card-kind="assassin"]')).toBeDisabled()
    const editableIds = await host
      .locator('button[data-card-kind="neutral"]')
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute('data-card-id')!),
      )
    const targetIds = editableIds.slice(0, 5)
    for (const id of targetIds) {
      await host.locator(`button[data-card-id="${id}"]`).click()
    }
    await expect(host.locator('.hint-number-value')).toHaveText('5')
    const derivedCivilians = host.locator(
      'button[data-card-derived-civilian="true"]',
    )
    await expect(derivedCivilians).toHaveCount(3)
    await expect(derivedCivilians.first()).toHaveAccessibleName(
      /Civilian −1.*Reversible when a target is deselected/i,
    )
    await expect(
      derivedCivilians.first().locator('.word-card-index'),
    ).toHaveText('Civilian')
    await expect(
      derivedCivilians.first().locator('.word-card-lock'),
    ).toHaveCount(0)
    await expect(derivedCivilians.first()).toHaveCSS('border-style', 'solid')
    const lockedCivilian = host
      .locator('button.word-card-civilian[data-card-locked="true"]')
      .first()
    expect(
      await derivedCivilians
        .first()
        .evaluate((card) => getComputedStyle(card).backgroundColor),
    ).toBe(
      await lockedCivilian.evaluate(
        (card) => getComputedStyle(card).backgroundColor,
      ),
    )

    await host.locator(`button[data-card-id="${targetIds[0]}"]`).click()
    await expect(derivedCivilians).toHaveCount(0)
    await expect(
      host.getByRole('button', { name: /Available −1/i }),
    ).toHaveCount(4)
    await host.locator(`button[data-card-id="${targetIds[0]}"]`).click()
    await expect(derivedCivilians).toHaveCount(3)
    for (const id of targetIds.slice(1)) {
      await host.locator(`button[data-card-id="${id}"]`).click()
    }
    const targetId = targetIds[0]
    const target = host.locator(`button[data-card-id="${targetId}"]`)
    await expect(host.locator('.hint-number-value')).toHaveText('1')
    await expect(target).toHaveAttribute('aria-pressed', 'true')
    await expect(target).toHaveAccessibleName(/Target \+3/i)
    await checkWidths(host, 'hinting', testInfo)

    await host.getByLabel('Your hint').fill('Orbit')
    await host.getByRole('button', { name: 'Lock in hint · 1' }).click()
    await expect(host.getByText('Hint locked in')).toBeVisible()
    await guest.getByLabel('Your hint').fill('Garden')
    const guestTarget = guest
      .locator('button[data-card-kind="neutral"]')
      .first()
    const guestTargetId = await guestTarget.getAttribute('data-card-id')
    await guestTarget.click()
    await guest.getByRole('button', { name: 'Lock in hint · 1' }).click()
    await host.getByRole('button', { name: 'Start guessing' }).click()
    await expect(guest.getByLabel('Current guessing board')).toBeVisible()

    await guest.locator(`button[data-card-id="${targetId}"]`).click()
    await expect(guest.getByText(/Target found/)).toBeVisible()
    await expect(guest.locator('.score-value')).toHaveText(['3', '3'])
    await expect(
      guest.locator(`button[data-card-id="${targetId}"]`),
    ).toBeDisabled()
    const revealedTarget = guest.locator(`button[data-card-id="${targetId}"]`)
    const revealedScore = revealedTarget.locator('.word-card-score')
    await expect(revealedScore).toHaveText('+3')
    const roleBox = await revealedTarget
      .locator('.word-card-index')
      .boundingBox()
    const claimerBox = await revealedTarget
      .locator('.word-card-claimers')
      .boundingBox()
    const wordBox = await revealedTarget
      .locator('.word-card-word')
      .boundingBox()
    await expect(revealedTarget.locator('.word-card-claimers')).toHaveCSS(
      'font-style',
      'italic',
    )
    await expect(revealedTarget).toHaveAccessibleName(
      new RegExp(`selected by ${longPickerName}`, 'i'),
    )
    await expect(
      revealedTarget.locator('.word-card-claimers .sr-only'),
    ).toHaveText('Selected by')
    const revealedScoreBox = await revealedScore.boundingBox()
    if (!roleBox || !wordBox || !claimerBox || !revealedScoreBox) {
      throw new Error('Revealed card labels are not visible')
    }
    expect(wordBox.y + wordBox.height).toBeLessThanOrEqual(claimerBox.y + 1)
    expect(Math.abs(claimerBox.x - roleBox.x)).toBeLessThanOrEqual(1)
    expect(claimerBox.x + claimerBox.width).toBeLessThanOrEqual(
      revealedScoreBox.x,
    )
    expect(
      Math.abs(
        claimerBox.y +
          claimerBox.height -
          (revealedScoreBox.y + revealedScoreBox.height),
      ),
    ).toBeLessThanOrEqual(1)
    await expect(
      guest.locator('button[data-card-kind="hidden"] .word-card-score'),
    ).toHaveCount(0)
    await checkWidths(guest, 'guessing', testInfo)

    await guest.setViewportSize({ width: 360, height: 900 })
    await host.getByRole('button', { name: 'Next hint' }).click()
    await expect(host.getByText('Garden', { exact: true })).toBeVisible()
    await host.locator(`button[data-card-id="${guestTargetId}"]`).click()
    await expect(host.getByText(/Target found/)).toBeVisible()
    await host.getByRole('button', { name: 'Finish the game' }).click()
    const finalBoard = guest.getByLabel('Fully revealed final board')
    await expect(finalBoard).toBeVisible()
    await expect(finalBoard.locator('.word-card-score')).toHaveCount(1)
    await expect(
      finalBoard.locator('[data-card-kind="target"] .word-card-score'),
    ).toHaveText('+3')
    await expect(
      finalBoard.locator(
        '.word-card:not(.word-card-has-score) .word-card-score',
      ),
    ).toHaveCount(0)
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
        .evaluateAll((elements) =>
          elements.map((element) => ({
            className: element.className,
            text: element.textContent,
          })),
        )
      try {
        let normalFontSize: number | undefined
        const supportsNativeTextFit = await page.evaluate(() =>
          CSS.supports('text-fit', 'shrink 59%'),
        )
        for (const { className, label, word } of [
          {
            className: 'word-card-word word-card-word-single',
            label: 'cotton',
            word: 'COTTON',
          },
          {
            className:
              'word-card-word word-card-word-single word-card-word-compact',
            label: 'unicorn',
            word: 'UNICORN',
          },
          {
            className:
              'word-card-word word-card-word-single word-card-word-compact',
            label: 'telescope',
            word: 'TELESCOPE',
          },
          {
            className:
              'word-card-word word-card-word-single word-card-word-compact',
            label: 'snowman',
            word: 'SNOWMAN',
          },
          {
            className:
              'word-card-word word-card-word-single word-card-word-compact word-card-word-wide',
            label: 'longest-deck-word',
            word: 'MILLIONAIRE',
          },
          {
            className:
              'word-card-word word-card-word-single word-card-word-compact word-card-word-wide',
            label: 'wide-deck-word',
            word: 'WASHINGTON',
          },
          {
            className: 'word-card-word',
            label: 'new-york',
            word: 'NEW YORK',
          },
          {
            className: 'word-card-word',
            label: 'great-britain',
            word: 'GREAT BRITAIN',
          },
          {
            className:
              'word-card-word word-card-word-single word-card-word-compact word-card-word-wide word-card-word-break',
            label: 'break-fallback',
            word: 'COUNTERREVOLUTIONARIES',
          },
        ]) {
          await grid.locator('.word-card-word').evaluateAll(
            (elements, fixture) => {
              for (const element of elements) {
                element.setAttribute('class', fixture.className)
                element.textContent = fixture.word
              }
            },
            { className, word },
          )
          await assertCardContentFits(page)
          const fontSize = await grid
            .locator('.word-card-word')
            .first()
            .evaluate((element) =>
              Number.parseFloat(getComputedStyle(element).fontSize),
            )
          if (label === 'cotton') normalFontSize = fontSize
          if (label === 'unicorn' && width === 1280) {
            expect(fontSize).toBeCloseTo(normalFontSize!, 2)
          }
          if (label === 'wide-deck-word' && width === 1280) {
            expect(fontSize).toBeCloseTo(normalFontSize!, 2)
          }
          if (
            label === 'wide-deck-word' &&
            width === 928 &&
            !supportsNativeTextFit
          ) {
            expect(fontSize).toBeLessThan(normalFontSize!)
          }
          if ([320, 359, 360, 390, 640, 1280].includes(width)) {
            await grid.screenshot({
              path: testInfo.outputPath(`${phase}-${width}-${label}.png`),
            })
          }
        }
      } finally {
        await grid
          .locator('.word-card-word')
          .evaluateAll((elements, originals) => {
            elements.forEach((element, index) => {
              element.setAttribute('class', originals[index].className)
              element.textContent = originals[index].text
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
      const claimer = card.querySelector<HTMLElement>('.word-card-claimers')
      const claimerBox = claimer?.getBoundingClientRect()
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
      if (
        claimer?.textContent?.trim() &&
        claimerBox &&
        wordBox.bottom > claimerBox.top + 1
      ) {
        issues.push(`Card ${index}: word overlaps picker attribution`)
      }
      if (box.width < 44 || box.height < 44) {
        issues.push(`Card ${index} is smaller than a 44px tap target`)
      }
      const contents = [...card.querySelectorAll<HTMLElement>(':scope > span')]
      const flowContents = contents.filter(
        (content) => getComputedStyle(content).position !== 'absolute',
      )
      const lock = card
        .querySelector('.word-card-lock')
        ?.getBoundingClientRect()
      if (lock) {
        const role = card
          .querySelector('.word-card-index')!
          .getBoundingClientRect()
        if (
          lock.right > box.right ||
          lock.top < box.top ||
          lock.left < box.left + box.width / 2
        ) {
          issues.push(`Card ${index}: lock is not inside the top-right corner`)
        }
        if (Math.abs(role.top - lock.top) > 1) {
          issues.push(`Card ${index}: role and lock are not vertically aligned`)
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
        const style = getComputedStyle(content)
        const usesTextFit = style
          .getPropertyValue('text-fit')
          .startsWith('shrink')
        let textOverflows =
          !content.classList.contains('word-card-claimers') &&
          content.scrollWidth > content.clientWidth + 1
        if (usesTextFit && content.firstChild) {
          const textRange = document.createRange()
          textRange.selectNodeContents(content)
          const textRect = textRange.getBoundingClientRect()
          textOverflows =
            textRect.left < rect.left - 1 || textRect.right > rect.right + 1
        }
        if (
          rect.left < box.left ||
          rect.right > box.right ||
          rect.top < box.top ||
          rect.bottom > box.bottom ||
          textOverflows
        ) {
          issues.push(
            `Card ${index} (${content.textContent}): ${content.className} overflows ` +
              `(${content.scrollWidth}/${content.clientWidth})`,
          )
        }
      }
      for (
        let contentIndex = 1;
        contentIndex < flowContents.length;
        contentIndex += 1
      ) {
        if (
          flowContents[contentIndex - 1].getBoundingClientRect().bottom >
          flowContents[contentIndex].getBoundingClientRect().top + 1
        ) {
          issues.push(`Card ${index}: labels or words overlap`)
        }
      }
    }
    return issues
  })
  expect(issues).toEqual([])
}
