'use client'

import { PricingTable } from '@clerk/nextjs'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { PackSummary } from '@/lib/game-protocol'
import { AccountControl, useAccount } from './account-bridge'
import { Button } from './ui/button'

const ShopContext = createContext<
  (packName?: string, trigger?: HTMLElement) => void
>(() => {})
export const useWordPackShop = () => useContext(ShopContext)

export function WordPackShopProvider({
  children,
  packs,
  checkoutEnabled,
}: {
  children: ReactNode
  packs: PackSummary[]
  checkoutEnabled: boolean
}) {
  const [selection, setSelection] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const account = useAccount()
  useEffect(() => {
    if (selection !== null) dialog.current?.showModal()
  }, [selection])
  const close = () => {
    dialog.current?.close()
    setSelection(null)
    returnFocus.current?.focus()
    window.dispatchEvent(new Event('pack-access-refresh'))
  }
  return (
    <ShopContext.Provider
      value={(name = '', trigger) => {
        returnFocus.current =
          trigger ?? (document.activeElement as HTMLElement | null)
        setSelection(name)
      }}
    >
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="word-pack-shop-title"
        className="bg-card text-card-foreground m-auto max-h-[90dvh] w-[min(48rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border p-6 shadow-xl backdrop:bg-black/60"
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        {selection !== null && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 id="word-pack-shop-title" className="text-2xl font-bold">
                {selection ? `Buy ${selection}` : 'Buy word packs'}
              </h2>
              <Button
                variant="outline"
                onClick={close}
                aria-label="Close word pack shop"
              >
                Close
              </Button>
            </div>
            <p>
              Host with your packs and share them with everyone in the room.
            </p>
            <ul className="space-y-3">
              {packs
                .filter((pack) => pack.premium)
                .map((pack) => (
                  <li key={pack.id}>
                    <strong>
                      {pack.name} ({pack.wordCount})
                    </strong>
                    <p className="text-muted-foreground text-sm">
                      {pack.description}
                    </p>
                  </li>
                ))}
            </ul>
            {checkoutEnabled && account.configured ? (
              <>
                <AccountControl preserveRoom />
                <PricingTable for="user" />
              </>
            ) : (
              <p role="status">
                Word packs are not available for purchase here yet.
              </p>
            )}
          </div>
        )}
      </dialog>
    </ShopContext.Provider>
  )
}

export function BuyWordPacksButton() {
  const openShop = useWordPackShop()
  return (
    <Button
      variant="outline"
      className="h-12 w-full text-base"
      onClick={(event) => openShop(undefined, event.currentTarget)}
    >
      Buy word packs
    </Button>
  )
}
