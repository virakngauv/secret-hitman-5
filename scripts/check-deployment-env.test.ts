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
  it('treats whitespace-only optional Clerk values as disabled', () => {
    const result = checkEnvironment({
      NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '  ',
      CLERK_SECRET_KEY: '\t',
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })

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

  it.each([undefined, '', '   '])(
    'reports an absent game-server URL as missing: %s',
    (url) => {
      const result = checkEnvironment({ NEXT_PUBLIC_GAME_SERVER_URL: url })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Missing required deployment variables: NEXT_PUBLIC_GAME_SERVER_URL',
      )
      expect(result.stderr).not.toContain(
        'Invalid required deployment variables',
      )
    },
  )

  it.each(['not-a-url', 'http://game.example.com'])(
    'reports a configured but invalid URL without exposing it: %s',
    (url) => {
      const result = checkEnvironment({ NEXT_PUBLIC_GAME_SERVER_URL: url })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain(
        '- required NEXT_PUBLIC_GAME_SERVER_URL: invalid',
      )
      expect(result.stderr).toContain(
        'Invalid required deployment variables: NEXT_PUBLIC_GAME_SERVER_URL',
      )
      expect(result.stderr).toContain('must be a valid HTTPS URL')
      expect(result.stderr).not.toContain(
        'Missing required deployment variables',
      )
      expect(result.stdout + result.stderr).not.toContain(url)
    },
  )

  it.each(['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'])(
    'rejects configuring only %s',
    (name) => {
      const result = checkEnvironment({
        NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
        [name]: 'test-key',
        ENABLE_WORD_PACKS: 'true',
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
      CLERK_AUTHORIZED_PARTIES: 'https://game.example.com',
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('test-publishable-key')
    expect(result.stdout).not.toContain('test-secret-key')
  })
  it.each([
    undefined,
    '',
    ' , , ',
    'https://game.example.com/path',
    'https://game.example.com/',
    'https://game.example.com?x=1',
    'https://game.example.com#x',
    'https://user:pass@game.example.com',
    'not-an-origin',
    'https://game.example.com,broken',
    'https://game.example.com,',
    'ftp://game.example.com',
    'http://game.example.com',
    'http://192.168.1.5:3140',
  ])(
    'requires allowed origins whenever Clerk is configured (%s)',
    (origins) => {
      const result = checkEnvironment({
        NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'test-publishable-key',
        CLERK_SECRET_KEY: 'test-secret-key',
        CLERK_AUTHORIZED_PARTIES: origins,
        ENABLE_WORD_PACKS: 'true',
        CLERK_ISSUER: 'https://clerk.example.com',
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Clerk authentication requires CLERK_AUTHORIZED_PARTIES',
      )
    },
  )
  it('accepts exact HTTPS and loopback HTTP origins', () => {
    const result = checkEnvironment({
      NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'key',
      CLERK_SECRET_KEY: 'secret',
      CLERK_AUTHORIZED_PARTIES:
        ' https://game.example.com, http://localhost:3140, http://127.0.0.1:3000, http://[::1]:3140 ',
    })
    expect(result.status).toBe(0)
  })
})
it('allows a dark deployment with unused incomplete Clerk configuration', () => {
  const result = checkEnvironment({
    NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
    ENABLE_WORD_PACKS: 'false',
    CLERK_SECRET_KEY: 'secret',
  })
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
})
it('requires both processes to have complete launch configuration', () => {
  const result = checkEnvironment({
    NEXT_PUBLIC_GAME_SERVER_URL: gameServerUrl,
    ENABLE_WORD_PACKS: 'true',
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('in both web and game processes')
})
