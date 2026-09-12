'use client'
import { useWordPackShop } from './word-pack-shop'
import { useEffect, useState } from 'react'
import { useAccount } from './account-bridge'
import { useGameSocket } from './game-socket-provider'
import type { PackSummary, RoomSnapshot } from '@/lib/game-protocol'

export function PackSelector({
  view,
  disabled,
  selectedIds = ['base'],
  onSelectionChange,
}: {
  view: Extract<RoomSnapshot, { status: 'lobby' }>
  disabled: boolean
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
}) {
  const openShop = useWordPackShop()
  const game = useGameSocket()
  const { catalog, connectionStatus } = game
  const account = useAccount()
  const [packs, setPacks] = useState<PackSummary[]>([])
  const [catalogError, setCatalogError] = useState(false)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [previewAttempt, setPreviewAttempt] = useState(0)
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
      // Bound the browser fetch like the server's provider deadline; cleanup
      // aborts stay silent, the deadline surfaces the retry control.
      let timedOut = false
      const deadline = setTimeout(() => {
        timedOut = true
        controller?.abort()
      }, 4500)
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
        if (active && !signal.aborted) {
          if (result.userId === account.userId) setAccess(result)
          else {
            // A stale response for a different account is no access answer.
            setAccess(null)
            setPreviewError(true)
          }
        }
      } catch {
        if (active && (!signal.aborted || timedOut)) {
          setAccess(null)
          setPreviewError(true)
        }
      } finally {
        clearTimeout(deadline)
        if (active && (!signal.aborted || timedOut)) setChecking(false)
      }
    }
    void refresh()
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('pack-access-refresh', onFocus)
    return () => {
      active = false
      controller?.abort()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pack-access-refresh', onFocus)
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
  // Only hosts carry an access answer; a demoted mounted host renders as
  // unowned instead of keeping the previous check.
  const isHost = view.player.role === 'host'
  const hostAccess = isHost ? access : null
  const choices = [...packs]
  for (const id of selectedIds) {
    if (!choices.some((pack) => pack.id === id))
      choices.push({
        id,
        name: id === 'base' ? 'Base' : `Selected pack (${id})`,
        premium: id !== 'base',
        wordCount: 0,
        description: '',
        version: '',
      })
  }
  const changeSelection = (packId: string) => {
    const nextIds = selectedIds.includes(packId)
      ? selectedIds.filter((id) => id !== packId)
      : [...selectedIds, packId]
    onSelectionChange?.(nextIds.length ? nextIds : ['base'])
  }
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 font-semibold">Word packs</legend>
      <div className="grid gap-2">
        {choices.map((pack) => {
          const selected = selectedIds.includes(pack.id)
          const owned =
            !pack.premium ||
            (hostAccess?.userId === account.userId &&
              hostAccess.packIds.includes(pack.id))
          const loading =
            pack.premium &&
            isHost &&
            (!account.loaded ||
              (!!account.userId &&
                (checking ||
                  (hostAccess?.userId !== account.userId && !previewError))))
          return (
            <div
              key={pack.id}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${selected ? 'border-accent bg-accent/5' : 'bg-background'}`}
            >
              <label className="flex flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  className="accent-accent size-4"
                  checked={selected}
                  disabled={
                    disabled ||
                    !account.loaded ||
                    (selected &&
                      selectedIds.length === 1 &&
                      pack.id === 'base') ||
                    (!selected && (!owned || loading))
                  }
                  onChange={() => void changeSelection(pack.id)}
                />
                <span className="font-semibold">
                  {pack.name}
                  {pack.wordCount > 0 ? ` (${pack.wordCount})` : ''}
                </span>
              </label>
              {loading ? (
                <span className="text-muted-foreground text-xs">Checking…</span>
              ) : pack.premium && isHost && account.userId && previewError ? (
                <span className="text-muted-foreground text-xs">
                  Access unavailable
                </span>
              ) : !owned ? (
                <button
                  type="button"
                  className="text-accent text-sm font-semibold underline underline-offset-4"
                  aria-label={`Buy ${pack.name}`}
                  onClick={(event) => openShop(pack.name, event.currentTarget)}
                >
                  Buy
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
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
      {isHost && account.userId && previewError && (
        <p role="status">
          Could not check pack access.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
          >
            Retry access check
          </button>
        </p>
      )}
    </fieldset>
  )
}
