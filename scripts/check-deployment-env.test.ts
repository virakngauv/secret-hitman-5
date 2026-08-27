import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const gameServerUrl = 'https://game.example.com'

function checkEnvironment(env: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    [resolve('scripts/check-deployment-env.mjs')],
    { env: { ...env, NODE_ENV: 'production' }, encoding: 'utf8' },
  )
}

describe('deployment environment check', () => {
  it('accepts just an HTTPS game-server URL without exposing its value', () => {
    const result = checkEnvironment({
      NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain(
      '- required NEXT_PUBLIC_GAME_SERVER_URL: configured',
    )
    expect(result.stdout).not.toContain(gameServerUrl)
  })

  it.each([undefined, '', '   ', 'not-a-url', 'http://game.example.com'])(
    'rejects an absent or invalid game-server URL: %s',
    (url) => {
      const result = checkEnvironment({ NEXT_PUBLIC_GAME_SERVER_URL: url })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Missing required deployment variables: NEXT_PUBLIC_GAME_SERVER_URL',
      )
    },
  )

  it.each(['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'])(
    'rejects configuring only %s',
    (name) => {
      const result = checkEnvironment({
        NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
        [name]: 'test-key',
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Clerk is only partially configured.')
    },
  )

  it('accepts both optional Clerk keys without exposing their values', () => {
    const result = checkEnvironment({
      NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'test-publishable-key',
      CLERK_SECRET_KEY: 'test-secret-key',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('test-publishable-key')
    expect(result.stdout).not.toContain('test-secret-key')
  })
})
