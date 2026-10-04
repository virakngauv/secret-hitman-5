import { expect, test } from '@playwright/test'
import { PNG } from 'pngjs'

test('declared app icons serve image content, including the ICO fallback', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const icons = page.locator('link[rel="icon"]')
  await expect(icons).toHaveCount(2)
  // File-based metadata adds cache-busting queries to the icon URLs.
  const svgIcon = page.locator('link[rel="icon"][type="image/svg+xml"]')
  await expect(svgIcon).toHaveAttribute('href', /^\/icon\.svg\?/)
  await expect(svgIcon).toHaveAttribute('sizes', 'any')
  const appleIcon = page.locator('link[rel="apple-touch-icon"]')
  await expect(appleIcon).toHaveCount(1)
  await expect(appleIcon).toHaveAttribute('sizes', '180x180')
  const icoIcon = page.locator('link[rel="icon"][href^="/favicon.ico"]')
  await expect(icoIcon).toHaveCount(1)

  for (const [link, contentType] of [
    [svgIcon, 'image/svg+xml'],
    [appleIcon, 'image/png'],
  ] as const) {
    const response = await request.get((await link.getAttribute('href'))!)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain(contentType)
    const body = await response.body()
    if (contentType === 'image/svg+xml') {
      expect(body.toString()).toContain('<svg')
    } else {
      const png = PNG.sync.read(body)
      expect([png.width, png.height]).toEqual([180, 180])
    }
  }

  const fallback = await request.get('/favicon.ico')
  expect(fallback.status()).toBe(200)
  expect(fallback.headers()['content-type']).toMatch(
    /^image\/(?:x-icon|vnd.microsoft.icon)/,
  )
  const ico = await fallback.body()
  const declaredFallback = await request.get(
    (await icoIcon.getAttribute('href'))!,
  )
  expect(declaredFallback.status()).toBe(200)
  expect(declaredFallback.headers()['content-type']).toBe(
    fallback.headers()['content-type'],
  )
  expect(await declaredFallback.body()).toEqual(ico)
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  expect(ico.readUInt16LE(4)).toBe(2)
  for (const [index, size] of [16, 32].entries()) {
    const entry = 6 + index * 16
    expect([ico[entry], ico[entry + 1]]).toEqual([size, size])
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    const png = PNG.sync.read(ico.subarray(offset, offset + length))
    expect([png.width, png.height]).toEqual([size, size])
  }
})
