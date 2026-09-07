import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RoomSnapshot } from '@/lib/game-protocol'
import { PackSelector } from './pack-selector'

const mocks = vi.hoisted(() => ({
  userId: 'user_one' as string | null,
  catalog: vi.fn(),
}))
vi.mock('./account-bridge', () => ({
  useAccount: () => ({ loaded: true, userId: mocks.userId }),
  AccountControl: () => null,
}))
vi.mock('./game-socket-provider', () => ({
  useGameSocket: () => ({
    catalog: mocks.catalog,
    connectionStatus: 'connected',
  }),
}))
const player = {
  playerId: 'host',
  name: 'Host',
  role: 'host' as const,
  participation: 'player' as const,
}
const view: Extract<RoomSnapshot, { status: 'lobby' }> = {
  status: 'lobby',
  selectedPackId: 'base',
  configurationRevision: 0,
  roomCode: 'bcdf2',
  player,
  members: [player],
  minimumPlayers: 2,
}
const packs = [
  { id: 'base', name: 'Base', premium: false },
  { id: 'movies-v1', name: 'Movies', premium: true },
]
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  mocks.userId = 'user_one'
})
it('refreshes access when returning from checkout without changing the game seat', async () => {
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ userId: 'user_one', packIds: ['base'] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        userId: 'user_one',
        packIds: ['base', 'movies-v1'],
      }),
    })
  vi.stubGlobal('fetch', fetcher)
  render(<PackSelector view={view} disabled={false} />)
  await screen.findByRole('option', { name: 'Movies · Subscription required' })
  fireEvent.focus(window)
  await screen.findByRole('option', { name: 'Movies · Available' })
  expect(screen.getByRole('combobox')).toHaveValue('base')
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('ignores access responses belonging to the previous account', async () => {
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  let finish!: (value: unknown) => void
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue({
      ok: true,
      json: async () => ({ userId: 'user_two', packIds: ['base'] }),
    })
  vi.stubGlobal('fetch', fetcher)
  const { rerender } = render(<PackSelector view={view} disabled={false} />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  mocks.userId = 'user_two'
  rerender(<PackSelector view={view} disabled={false} />)
  await screen.findByRole('option', { name: 'Movies · Subscription required' })
  await act(async () => {
    finish({
      ok: true,
      json: async () => ({ userId: 'user_one', packIds: ['movies-v1'] }),
    })
  })
  expect(
    screen.queryByRole('option', { name: 'Movies · Available' }),
  ).not.toBeInTheDocument()
})
