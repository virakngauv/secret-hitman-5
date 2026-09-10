import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})
it.each([undefined, 'false', 'true'])(
  'enforces the release flag in the default game catalog and commands (%s)',
  async (flag) => {
    vi.stubEnv('ENABLE_WORD_PACKS', flag)
    vi.resetModules()
    const { GameServer } = await import('./game-server')
    const { publicCatalog } = await import('./packs')
    const authorize = vi.fn().mockResolvedValue({ status: 'success' })
    const server = new GameServer(undefined, undefined, undefined, authorize)
    const created = server.createRoom('host', 'Host')
    if (created.status !== 'success') throw new Error('create failed')
    server.joinRoom('guest', created.roomCode, 'Guest')
    const command = {
      roomCode: created.roomCode,
      configurationRevision: 0,
      requestId: 'request-001',
      packIds: ['movies-v1'],
      packId: 'movies-v1',
    }
    expect(publicCatalog().map((pack) => pack.id)).toEqual(
      flag === 'true' ? ['base', 'movies-v1', 'travel-v1'] : ['base'],
    )
    if (flag !== 'true') {
      expect((await server.packCommand('host', command, false)).status).toBe(
        'invalid',
      )
      expect((await server.packCommand('host', command, true)).status).toBe(
        'invalid',
      )
      expect(authorize).not.toHaveBeenCalled()
      expect(
        (
          await server.packCommand(
            'host',
            { ...command, packIds: ['base'] },
            true,
          )
        ).status,
      ).toBe('success')
    } else {
      expect((await server.packCommand('host', command, true)).status).toBe(
        'success',
      )
      expect(authorize).toHaveBeenCalledOnce()
    }
  },
)
it('rejects an enabled production game process missing Clerk configuration', async () => {
  vi.stubEnv('ENABLE_WORD_PACKS', 'true')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('CLERK_SECRET_KEY', '')
  const { startGameServer } = await import('./index')
  expect(() => startGameServer()).toThrow('Word packs require CLERK_SECRET_KEY')
})
