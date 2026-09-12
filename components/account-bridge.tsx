'use client'

import {
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
  useClerk,
} from '@clerk/nextjs'
import Link from 'next/link'
import {
  createContext,
  useContext,
  useRef,
  useState,
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

export function AccountControl({
  preserveRoom = false,
}: {
  preserveRoom?: boolean
}) {
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
      <Link
        href="/account"
        target={preserveRoom ? '_blank' : undefined}
        rel={preserveRoom ? 'noopener noreferrer' : undefined}
      >
        Account & Billing
      </Link>
      {preserveRoom ? <RoomUserButton /> : <UserButton />}
    </div>
  ) : preserveRoom ? (
    <div className="flex items-center gap-3">
      <Link
        href="/sign-in"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Log in (new tab)
      </Link>
      <Link
        href="/sign-up"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Sign up (new tab)
      </Link>
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

function RoomUserButton() {
  const { signOut } = useClerk()
  const pending = useRef(false)
  const [error, setError] = useState(false)
  async function leaveAccount() {
    if (pending.current) return
    pending.current = true
    setError(false)
    try {
      // A callback replaces Clerk's default navigation while still ending the session.
      await signOut(() => {})
    } catch {
      setError(true)
    } finally {
      pending.current = false
    }
  }
  return (
    <>
      <UserButton
        appearance={{
          elements: {
            userButtonPopoverActionButton__signOut: { display: 'none' },
            userButtonPopoverActionButton__signOutAll: { display: 'none' },
          },
        }}
      >
        <UserButton.MenuItems>
          <UserButton.Action
            label="Sign out and stay in room"
            labelIcon={
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 5H5v14h4M10 12h10m-4-4 4 4-4 4" />
              </svg>
            }
            onClick={() => void leaveAccount()}
          />
        </UserButton.MenuItems>
      </UserButton>
      {error && <span role="alert">Could not sign out. Please try again.</span>}
    </>
  )
}
