'use client'
import Link from 'next/link'
import { generateRequestId } from '@/lib/player-session'
import { useEffect, useState } from 'react'
import { useAccount, AccountControl } from './account-bridge'
import { useGameSocket } from './game-socket-provider'
import type { PackSummary, RoomSnapshot } from '@/lib/game-protocol'

export function PackSelector({
  view,
  disabled,
  onPendingChange,
}: {
  view: Extract<RoomSnapshot, { status: 'lobby' }>
  disabled: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const game = useGameSocket()
  const { catalog, connectionStatus } = game
  const account = useAccount()
  const [packs, setPacks] = useState<PackSummary[]>([])
  const [catalogError, setCatalogError] = useState(false)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [previewAttempt, setPreviewAttempt] = useState(0)
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
  }, [account.userId, view.player.role, previewAttempt])
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await catalog?.()
        if (!active) return
        if (result?.status === 'success') {
          setPacks(result.packs)
          setCatalogError(false)
        } else setCatalogError(true)
      } catch {
        if (active) setCatalogError(true)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [catalog, connectionStatus, catalogAttempt])
  const selectedId = view.selectedPackId ?? 'base'
  const choices: Array<Pick<PackSummary, 'id' | 'name' | 'premium'>> =
    packs.length ? [...packs] : [{ id: 'base', name: 'Base', premium: false }]
  if (!choices.some((pack) => pack.id === selectedId)) {
    choices.push({
      id: selectedId,
      name: `Selected pack (${selectedId})`,
      premium: selectedId !== 'base',
    })
  }
  return (
    <div className="mt-4 space-y-2 rounded-xl border p-3">
      <p className="font-semibold">Word pack</p>
      {catalogError && (
        <p role="status">
          Pack list unavailable.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
          >
            Retry pack list
          </button>
        </p>
      )}
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
              onPendingChange?.(true)
              setError(null)
              try {
                const result = await game.selectPack(
                  {
                    roomCode: view.roomCode,
                    configurationRevision: view.configurationRevision,
                    packId,
                    requestId: generateRequestId(),
                  },
                  premium,
                )
                if (result.status !== 'success') setError(result.message)
              } catch {
                setError('Could not select the pack. Please try again.')
              } finally {
                setBusy(false)
                onPendingChange?.(false)
              }
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
              <AccountControl preserveRoom />
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
          {!account.userId && selectedId !== 'base' && (
            <p role="status">
              Sign in again or choose Base to start a new round.
            </p>
          )}
          {account.userId && previewError && (
            <p role="status">
              Access preview unavailable. Selecting a pack will check again.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
              >
                Retry access check
              </button>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>
  )
}
