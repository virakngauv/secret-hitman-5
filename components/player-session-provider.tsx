'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import {
  getClientToken,
  getOrCreateClientToken,
  subscribeToClientToken,
} from '@/lib/player-session'

type PlayerSession = {
  clientToken: string | null | undefined
  ensureClientToken: () => string
}

const PlayerSessionContext = createContext<PlayerSession | null>(null)

export function PlayerSessionProvider({ children }: { children: ReactNode }) {
  const clientToken = useSyncExternalStore(
    subscribeToClientToken,
    getClientToken,
    getServerClientToken,
  )
  const ensureClientToken = useCallback(() => getOrCreateClientToken(), [])
  const value = useMemo(
    () => ({ clientToken, ensureClientToken }),
    [clientToken, ensureClientToken],
  )

  return (
    <PlayerSessionContext.Provider value={value}>
      {children}
    </PlayerSessionContext.Provider>
  )
}

export function usePlayerSession() {
  const session = useContext(PlayerSessionContext)

  if (!session) {
    throw new Error(
      'usePlayerSession must be used within PlayerSessionProvider.',
    )
  }

  return session
}

function getServerClientToken() {
  return undefined
}
