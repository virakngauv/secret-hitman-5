import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RoomSnapshot } from '@/lib/game-protocol'
import { PackSelector } from './pack-selector'
const mocks = vi.hoisted(() => ({
  userId: 'user_one' as string | null,
  catalog: vi.fn(),
  selectPack: vi.fn(),
  onSelectionChange: vi.fn(),
  openShop: vi.fn(),
}))
vi.mock('./word-pack-shop', () => ({ useWordPackShop: () => mocks.openShop }))
vi.mock('./account-bridge', () => ({
  useAccount: () => ({ loaded: true, userId: mocks.userId }),
}))
vi.mock('./game-socket-provider', () => ({
  useGameSocket: () => ({
    catalog: mocks.catalog,
    selectPack: mocks.selectPack,
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
  { id: 'base', name: 'Base', premium: false, wordCount: 100 },
  { id: 'movies-v1', name: 'Movies', premium: true, wordCount: 24 },
]
const response = (userId: string, packIds: string[]) => ({
  ok: true,
  json: async () => ({ userId, packIds }),
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  mocks.userId = 'user_one'
})
it('preserves selected packs during catalog failure and supports retry', async () => {
  mocks.userId = null
  mocks.catalog
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ status: 'success', packs })
  render(
    <PackSelector view={view} selectedIds={['movies-v1']} disabled={false} />,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry pack list' }),
  )
  expect(
    await screen.findByRole('checkbox', { name: 'Movies (24)' }),
  ).toBeChecked()
  expect(screen.getByRole('button', { name: 'Buy Movies' })).toBeVisible()
})
it('checks access on mount, shows counts without owned labels, and selects multiple packs', async () => {
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  mocks.selectPack.mockResolvedValue({ status: 'success' })
  const fetcher = vi.fn().mockResolvedValue(response('user_one', ['movies-v1']))
  vi.stubGlobal('fetch', fetcher)
  render(
    <PackSelector
      view={view}
      disabled={false}
      onSelectionChange={mocks.onSelectionChange}
    />,
  )
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Movies (24)' })).toBeEnabled(),
  )
  expect(fetcher).toHaveBeenCalledOnce()
  expect(screen.queryByText('Available')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Buy Movies' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Base (100)' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Movies (24)' }))
  await waitFor(() =>
    expect(mocks.onSelectionChange).toHaveBeenCalledWith(['base', 'movies-v1']),
  )
})
it('opens the shop for an unowned pack and refreshes when the shop closes', async () => {
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(response('user_one', []))
      .mockResolvedValue(response('user_one', ['movies-v1'])),
  )
  render(
    <PackSelector
      view={view}
      disabled={false}
      onSelectionChange={mocks.onSelectionChange}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Buy Movies' }))
  expect(mocks.openShop).toHaveBeenCalledWith(
    'Movies',
    screen.getByRole('button', { name: 'Buy Movies' }),
  )
  fireEvent(window, new Event('pack-access-refresh'))
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Movies (24)' })).toBeEnabled(),
  )
  expect(screen.getByRole('checkbox', { name: 'Base (100)' })).toBeChecked()
})
it('retries unavailable access instead of mislabeling it as unowned', async () => {
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue(response('user_one', ['movies-v1'])),
  )
  render(
    <PackSelector
      view={view}
      disabled={false}
      onSelectionChange={mocks.onSelectionChange}
    />,
  )
  const retry = await screen.findByRole('button', {
    name: 'Retry access check',
  })
  expect(
    screen.queryByRole('button', { name: 'Buy Movies' }),
  ).not.toBeInTheDocument()
  fireEvent.click(retry)
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Movies (24)' })).toBeEnabled(),
  )
})
it('ignores the aborted previous-account response', async () => {
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
    .mockResolvedValue(response('user_two', []))
  vi.stubGlobal('fetch', fetcher)
  const { rerender } = render(
    <PackSelector
      view={view}
      disabled={false}
      onSelectionChange={mocks.onSelectionChange}
    />,
  )
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  mocks.userId = 'user_two'
  rerender(
    <PackSelector
      view={view}
      disabled={false}
      onSelectionChange={mocks.onSelectionChange}
    />,
  )
  await screen.findByRole('button', { name: 'Buy Movies' })
  await act(async () => finish(response('user_one', ['movies-v1'])))
  expect(screen.getByRole('checkbox', { name: 'Movies (24)' })).toBeDisabled()
})
it('treats a response for another account as a failed check', async () => {
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  const fetcher = vi.fn().mockResolvedValue(response('user_two', ['movies-v1']))
  vi.stubGlobal('fetch', fetcher)
  render(
    <PackSelector
      view={view}
      disabled={false}
      onSelectionChange={mocks.onSelectionChange}
    />,
  )
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Movies (24)' }),
    ).toBeDisabled(),
  )
  expect(
    screen.getByRole('button', { name: 'Retry access check' }),
  ).toBeInTheDocument()
})
it('ends checking with a retry when the access request stalls', async () => {
  vi.useFakeTimers()
  try {
    mocks.catalog.mockResolvedValue({ status: 'success', packs })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            )
          }),
      ),
    )
    render(
      <PackSelector
        view={view}
        disabled={false}
        onSelectionChange={mocks.onSelectionChange}
      />,
    )
    await act(async () => {})
    expect(screen.getByText('Checking…')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(4500)
    })
    expect(
      screen.getByRole('button', { name: 'Retry access check' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Checking…')).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})
it('shows unowned premium packs to signed-in players without checking', async () => {
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  const fetcher = vi.fn().mockResolvedValue(response('user_one', ['movies-v1']))
  vi.stubGlobal('fetch', fetcher)
  const guest = {
    ...player,
    playerId: 'guest',
    name: 'Guest',
    role: 'player' as const,
  }
  render(
    <PackSelector
      view={{ ...view, player: guest }}
      disabled={false}
      onSelectionChange={mocks.onSelectionChange}
    />,
  )
  await screen.findByRole('checkbox', { name: 'Movies (24)' })
  expect(screen.queryByText('Checking…')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Buy Movies' })).toBeInTheDocument()
})
it('returns to Base when the last paid pack is unchecked after sign-out', async () => {
  mocks.userId = null
  mocks.catalog.mockResolvedValue({ status: 'success', packs })
  mocks.selectPack.mockResolvedValue({ status: 'success' })
  render(
    <PackSelector
      view={view}
      selectedIds={['movies-v1']}
      onSelectionChange={mocks.onSelectionChange}
      disabled={false}
    />,
  )
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Movies (24)' }))
  await waitFor(() =>
    expect(mocks.onSelectionChange).toHaveBeenCalledWith(['base']),
  )
})
