import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function devHost(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [resolve('scripts/dev-host.mjs')], {
    env: { ...env, NODE_ENV: 'test' },
    encoding: 'utf8',
  })
}

describe('dev host resolution', () => {
  it('uses HOST when set', () => {
    const result = devHost({ HOST: '10.0.0.1' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('10.0.0.1\n')
  })

  it('defaults to a bindable IPv4 without HOST', () => {
    const result = devHost({})
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^((\d{1,3}\.){3}\d{1,3})\n$/)
  })

  it('treats whitespace-only HOST as unset', () => {
    const result = devHost({ HOST: '  ' })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^((\d{1,3}\.){3}\d{1,3})\n$/)
  })

  it('expands 0.0.0.0 to a routable LAN IPv4 when one exists', () => {
    const result = devHost({ HOST: '0.0.0.0' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(
      /^(0\.0\.0\.0|((10|172\.(1[6-9]|2\d|3[01])|192\.168)(\.\d{1,3}){2}))$/,
    )
  })
})
