const requiredVercelVariables = ['NEXT_PUBLIC_GAME_SERVER_URL']
const optionalVercelVariables = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'NEXT_PUBLIC_POSTHOG_HOST',
]

const isConfigured = (name) => Boolean(process.env[name]?.trim())
const isValid = (name) =>
  name === 'NEXT_PUBLIC_GAME_SERVER_URL'
    ? isHttpsUrl(process.env[name])
    : isConfigured(name)
const missing = requiredVercelVariables.filter((name) => !isConfigured(name))
const invalid = requiredVercelVariables.filter(
  (name) => isConfigured(name) && !isValid(name),
)

console.log('Deployment environment (values are intentionally hidden):')
for (const name of requiredVercelVariables) {
  const status = !isConfigured(name)
    ? 'missing'
    : isValid(name)
      ? 'configured'
      : 'invalid'
  console.log(`- required ${name}: ${status}`)
}
for (const name of optionalVercelVariables) {
  console.log(
    `- optional ${name}: ${isConfigured(name) ? 'configured' : 'disabled'}`,
  )
}

const clerkVariables = ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY']
const configuredClerkVariables = clerkVariables.filter(isConfigured)
if (
  configuredClerkVariables.length > 0 &&
  configuredClerkVariables.length < clerkVariables.length
) {
  console.error(
    'Clerk is only partially configured. Set both Clerk variables or remove both.',
  )
  process.exitCode = 1
}

if (missing.length > 0) {
  console.error(`Missing required deployment variables: ${missing.join(', ')}`)
  process.exitCode = 1
}

if (invalid.length > 0) {
  console.error(`Invalid required deployment variables: ${invalid.join(', ')}`)
  console.error('NEXT_PUBLIC_GAME_SERVER_URL must be a valid HTTPS URL.')
  process.exitCode = 1
}

function isHttpsUrl(value) {
  try {
    return new URL(value?.trim() ?? '').protocol === 'https:'
  } catch {
    return false
  }
}
