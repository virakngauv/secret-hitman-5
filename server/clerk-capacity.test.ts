import { expect, it, vi } from 'vitest'
import { withClerkCapacity } from './clerk-capacity'

function stalled() {
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { waiting, finish }
}

it('retains per-account capacity until SDK operations settle', async () => {
  const { waiting, finish } = stalled()
  const first = withClerkCapacity(() => waiting, 'preview:user_test')
  const work = vi.fn(async () => {})
  await expect(withClerkCapacity(work, 'preview:user_test')).rejects.toThrow(
    'busy',
  )
  finish()
  await first
  await expect(
    withClerkCapacity(work, 'preview:user_test'),
  ).resolves.toBeUndefined()
})

it('caps anonymous token verification below the shared budget', async () => {
  const { waiting, finish } = stalled()
  const work = vi.fn(async () => {})
  const anonymous = Array.from({ length: 24 }, () =>
    withClerkCapacity(() => waiting),
  )
  await expect(withClerkCapacity(work)).rejects.toThrow('busy')
  expect(work).not.toHaveBeenCalled()
  finish()
  await Promise.all(anonymous)
  await expect(withClerkCapacity(work)).resolves.toBeUndefined()
})

it('reserves capacity for keyed account work during verification bursts', async () => {
  const { waiting, finish } = stalled()
  const work = vi.fn(async () => 'ok')
  const anonymous = Array.from({ length: 24 }, () =>
    withClerkCapacity(() => waiting),
  )
  const keyed = Array.from({ length: 8 }, (_, index) =>
    withClerkCapacity(() => waiting, `host:user_${index}`),
  )
  await expect(withClerkCapacity(work, 'host:user_next')).rejects.toThrow(
    'busy',
  )
  finish()
  await Promise.all([...anonymous, ...keyed])
  await expect(withClerkCapacity(work, 'host:user_next')).resolves.toBe('ok')
})
