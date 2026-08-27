import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns uncached health metadata for the deployed commit', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'candidate-commit-sha')

    const response = GET()

    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'secret-hitman-5',
      commitSha: 'candidate-commit-sha',
    })
  })
})
