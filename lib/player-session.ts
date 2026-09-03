const CLIENT_TOKEN_KEY = 'secret-hitman-5:client-token'
const CLIENT_TOKEN_PATTERN = /^[0-9a-f]{32}$/
const CLIENT_TOKEN_CHANGED_EVENT = 'secret-hitman-5:client-token-changed'
const DISMISSED_RESULTS_KEY = 'secret-hitman-5:dismissed-game-results'
const MAX_DISMISSED_RESULTS = 25

export function generateClientToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

export function saveClientToken(clientToken: string) {
  if (!CLIENT_TOKEN_PATTERN.test(clientToken)) {
    throw new Error('Invalid client token.')
  }

  window.localStorage.setItem(CLIENT_TOKEN_KEY, clientToken)
  window.dispatchEvent(new Event(CLIENT_TOKEN_CHANGED_EVENT))
}

export function getClientToken() {
  const storedToken = window.localStorage.getItem(CLIENT_TOKEN_KEY)

  return storedToken && CLIENT_TOKEN_PATTERN.test(storedToken)
    ? storedToken
    : null
}

export function getOrCreateClientToken() {
  const existingToken = getClientToken()

  if (existingToken) {
    return existingToken
  }

  const clientToken = generateClientToken()
  saveClientToken(clientToken)
  return clientToken
}

export function subscribeToClientToken(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (
      event.storageArea === window.localStorage &&
      (event.key === CLIENT_TOKEN_KEY || event.key === null)
    ) {
      onStoreChange()
    }
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(CLIENT_TOKEN_CHANGED_EVENT, onStoreChange)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(CLIENT_TOKEN_CHANGED_EVENT, onStoreChange)
  }
}

export function hasDismissedGameResults(gameId: string) {
  return readDismissedGameResults().includes(gameId)
}

export function dismissGameResults(gameId: string) {
  const dismissed = [
    gameId,
    ...readDismissedGameResults().filter((candidate) => candidate !== gameId),
  ].slice(0, MAX_DISMISSED_RESULTS)
  window.localStorage.setItem(DISMISSED_RESULTS_KEY, JSON.stringify(dismissed))
}

function readDismissedGameResults() {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(DISMISSED_RESULTS_KEY) ?? '[]',
    )
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}
