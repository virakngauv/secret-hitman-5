import { expect, it, vi } from 'vitest'
import { withClerkCapacity } from './clerk-capacity'

it('retains per-account and global capacity until SDK operations settle', async () => {
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => {
    finish = resolve
  })
  const first = withClerkCapacity(() => waiting, 'preview:user_test')
  const work = vi.fn(async () => {})
  await expect(withClerkCapacity(work, 'preview:user_test')).rejects.toThrow(
    'busy',
  )
  const others = Array.from({ length: 31 }, () =>
    withClerkCapacity(() => waiting),
  )
  await expect(withClerkCapacity(work)).rejects.toThrow('busy')
  expect(work).not.toHaveBeenCalled()
  finish()
  await Promise.all([first, ...others])
  await expect(
    withClerkCapacity(work, 'preview:user_test'),
  ).resolves.toBeUndefined()
})
