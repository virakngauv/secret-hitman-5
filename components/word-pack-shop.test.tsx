import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, it } from 'vitest'
import type { PackSummary } from '@/lib/game-protocol'
import { useWordPackShop, WordPackShopProvider } from './word-pack-shop'

const packs: PackSummary[] = [
  {
    id: 'movies-v1',
    name: 'Movies',
    premium: true,
    wordCount: 24,
    description: 'Movie words.',
    version: '',
  },
]
// jsdom lacks showModal; mirror the browser's open-dialog rejection so the
// idempotency guard is exercised exactly as in a real browser.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    if (this.open) throw new DOMException('already open', 'InvalidStateError')
    this.open = true
  }
})
function ShopTriggers() {
  const openShop = useWordPackShop()
  return (
    <>
      <button onClick={(event) => openShop('Movies', event.currentTarget)}>
        open movies
      </button>
      <button onClick={(event) => openShop('Travel', event.currentTarget)}>
        open travel
      </button>
    </>
  )
}
it('keeps an open shop dialog open across re-selections', () => {
  render(
    <WordPackShopProvider packs={packs} checkoutEnabled={false}>
      <ShopTriggers />
    </WordPackShopProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'open movies' }))
  const dialog = screen.getByRole('dialog', { name: 'Buy Movies' })
  expect(dialog).toBeInTheDocument()
  expect(() =>
    fireEvent.click(screen.getByRole('button', { name: 'open travel' })),
  ).not.toThrow()
  expect(screen.getByRole('dialog', { name: 'Buy Travel' })).toBe(dialog)
  expect(
    screen.getByRole('button', { name: 'Close word pack shop' }),
  ).toBeInTheDocument()
})
