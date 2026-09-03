import { expect, test, type Locator } from '@playwright/test'

for (const viewport of [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
]) {
  test(`lobby centers its invite section at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/create')
    const create = page.getByRole('button', { name: 'Create', exact: true })
    await expect(create).toBeEnabled()
    await page.getByLabel('Name').fill(`Ada ${viewport.width}`)
    await create.click()

    const heading = page.getByRole('heading', { name: 'lobby.' })
    await expect(heading).toBeVisible()
    const roomCode = new URL(page.url()).pathname.slice(1)
    const code = page.getByLabel(`Room code ${roomCode}`)
    const qr = page.getByRole('img', {
      name: `Scan to join room ${roomCode}`,
    })
    const qrColumn = qr.locator('../..')
    const caption = page.getByText('Scan to join', { exact: true })
    const copy = page.getByRole('button', { name: 'Copy invite link' })

    await expect(code).toBeVisible()
    await expect(qr).toBeVisible()
    await expect(caption).toBeVisible()
    await expect(copy).toBeEnabled()
    await expect(qr).toHaveAttribute(
      'data-invite-url',
      new URL(`/${roomCode}`, page.url()).href,
    )

    const [headingBox, codeBox, qrBox, qrColumnBox, captionBox, copyBox] =
      await Promise.all(
        [heading, code, qr, qrColumn, caption, copy].map(async (locator) => {
          const box = await locator.boundingBox()
          expect(box).not.toBeNull()
          return box!
        }),
      )
    const inviteCenter =
      viewport.width < 640
        ? centerX(codeBox)
        : (codeBox.x + qrColumnBox.x + qrColumnBox.width) / 2
    expect(Math.abs(centerX(headingBox) - inviteCenter)).toBeLessThanOrEqual(1)
    expect(Math.abs(centerX(qrBox) - centerX(captionBox))).toBeLessThanOrEqual(
      1,
    )
    expect(Math.abs(inviteCenter - centerX(copyBox))).toBeLessThanOrEqual(1)

    if (viewport.width < 640) {
      expect(codeBox.y + codeBox.height).toBeLessThan(qrBox.y)
      expect(Math.abs(centerX(codeBox) - centerX(qrBox))).toBeLessThanOrEqual(1)
    } else {
      expect(codeBox.x + codeBox.width).toBeLessThan(qrColumnBox.x)
      expect(
        Math.abs(centerY(codeBox) - centerY(qrColumnBox)),
      ).toBeLessThanOrEqual(1)
    }

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await assertInsideViewport(heading)
    await assertInsideViewport(code)
    await assertInsideViewport(qr)
    await assertInsideViewport(copy)

    await testInfo.attach(`lobby-${viewport.width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
}

function centerX(box: { x: number; width: number }) {
  return box.x + box.width / 2
}

function centerY(box: { y: number; height: number }) {
  return box.y + box.height / 2
}

async function assertInsideViewport(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const viewport = locator.page().viewportSize()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
}
