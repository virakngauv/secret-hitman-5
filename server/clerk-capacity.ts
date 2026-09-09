// The patched SDK aborts stalled fetches. Retain capacity until that work
// settles, even when a caller stops waiting before the transport deadline.
const inFlight = new Set<string | symbol>()
const MAX_CLERK_OPERATIONS = 32

export async function withClerkCapacity<T>(
  work: () => Promise<T>,
  key: string | symbol = Symbol(),
): Promise<T> {
  if (inFlight.has(key) || inFlight.size >= MAX_CLERK_OPERATIONS)
    throw new Error('Clerk access busy')
  inFlight.add(key)
  try {
    return await work()
  } finally {
    inFlight.delete(key)
  }
}
