'use client'

import { SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/nextjs'
import Link from 'next/link'
import {
  createContext,
  useContext,
  useRef,
  useLayoutEffect,
  type ReactNode,
} from 'react'

const anonymous = {
  configured: false,
  loaded: true,
  userId: null as string | null,
  getToken: async (): Promise<string | null> => null,
}
const AccountContext = createContext(anonymous)
export const useAccount = () => useContext(AccountContext)

export function AccountBridge({ children }: { children: ReactNode }) {
  const { isLoaded, userId, getToken } = useAuth()
  const currentUser = useRef(userId)
  useLayoutEffect(() => {
    currentUser.current = userId
  }, [userId])
  return (
    <AccountContext.Provider
      value={{
        configured: true,
        loaded: isLoaded,
        userId: userId ?? null,
        getToken: async () => {
          const user = currentUser.current
          const token = await getToken({ skipCache: true })
          if (user !== currentUser.current)
            throw new Error('Account changed. Please try again.')
          return token
        },
      }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function AccountControl() {
  const account = useAccount()
  if (!account.configured)
    return (
      <span className="text-muted-foreground text-sm">
        Account features unavailable
      </span>
    )
  if (!account.loaded) return <span role="status">Checking account…</span>
  return account.userId ? (
    <div className="flex items-center gap-3">
      <Link href="/account">Account & Billing</Link>
      <UserButton />
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <SignInButton mode="modal">
        <button type="button" className="underline">
          Log in
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button type="button" className="underline">
          Sign up
        </button>
      </SignUpButton>
    </div>
  )
}
