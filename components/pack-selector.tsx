'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAccount, AccountControl } from './account-bridge'
import { useGameSocket } from './game-socket-provider'
import type { PackSummary, RoomSnapshot } from '@/lib/game-protocol'

export function PackSelector({
  view,
  disabled,
}: {
  view: Extract<RoomSnapshot, { status: 'lobby' }>
  disabled: boolean
}) {
  const game = useGameSocket()
  const { catalog, connectionStatus } = game
  const account = useAccount()
  const [packs, setPacks] = useState<PackSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [access, setAccess] = useState<{
    userId: string
    packIds: string[]
  } | null>(null)
  const [checking, setChecking] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  useEffect(() => {
    if (!account.userId || view.player.role !== 'host') return
    let active = true
    let controller: AbortController | undefined
    const refresh = async () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      setChecking(true)
      setPreviewError(false)
      try {
        const response = await fetch('/api/me/pack-access', {
          cache: 'no-store',
          signal,
        })
        if (!response.ok) throw new Error('Access unavailable')
        const result = (await response.json()) as {
          userId: string
          packIds: string[]
        }
        if (active && !signal.aborted && result.userId === account.userId)
          setAccess(result)
      } catch {
        if (active && !signal.aborted) {
          setAccess(null)
          setPreviewError(true)
        }
      } finally {
        if (active && !signal.aborted) setChecking(false)
      }
    }
    void refresh()
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      controller?.abort()
      window.removeEventListener('focus', onFocus)
    }
  }, [account.userId, view.player.role])
  useEffect(() => {
    let active = true
    void catalog?.().then((result) => {
      if (active && result.status === 'success') setPacks(result.packs)
    })
    return () => {
      active = false
    }
  }, [catalog, connectionStatus])
  const selectedId = view.selectedPackId ?? 'base'
  const choices = packs.length
    ? packs
    : [{ id: 'base', name: 'Base', premium: false }]
  return (
    <div className="mt-4 space-y-2 rounded-xl border p-3">
      <p className="font-semibold">Word pack</p>
      {view.player.role !== 'host' ? (
        <p>
          {choices.find((pack) => pack.id === selectedId)?.name ?? selectedId} ·
          Chosen by the host. Guests play free.
        </p>
      ) : (
        <>
          <select
            aria-label="Word pack"
            className="bg-background w-full rounded border p-2"
            value={selectedId}
            disabled={disabled || busy || !account.loaded}
            onChange={async (event) => {
              const packId = event.target.value
              const premium =
                choices.find((pack) => pack.id === packId)?.premium ?? false
              setBusy(true)
              setError(null)
              const result = await game.selectPack(
                {
                  roomCode: view.roomCode,
                  configurationRevision: view.configurationRevision,
                  packId,
                  requestId: crypto.randomUUID(),
                },
                premium,
              )
              setBusy(false)
              if (result.status !== 'success') setError(result.message)
            }}
          >
            {choices.map((pack) => (
              <option
                key={pack.id}
                value={pack.id}
                disabled={pack.premium && !account.userId}
              >
                {pack.name}
                {pack.premium
                  ? !account.userId
                    ? ' · Sign in required'
                    : checking
                      ? ' · Checking access…'
                      : access?.userId === account.userId &&
                          access.packIds.includes(pack.id)
                        ? ' · Available'
                        : previewError
                          ? ' · Access unavailable'
                          : ' · Subscription required'
                  : ' · Free'}
              </option>
            ))}
          </select>
          {choices.some((pack) => pack.premium) && (
            <>
              <p className="text-sm">
                {account.userId
                  ? 'Access is checked when selecting a pack and again before starting.'
                  : 'The host must sign in to select premium packs.'}{' '}
                Guests always play free.
              </p>
              <AccountControl />
              <Link
                href="/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="block underline"
              >
                View plans in a new tab
              </Link>
            </>
          )}
          {busy && <p role="status">Checking access…</p>}
          {account.userId && previewError && (
            <p role="status">
              Access preview unavailable. Selecting a pack will check again.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>
  )
}
