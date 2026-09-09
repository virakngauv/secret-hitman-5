import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameServer } from './game-server'
import { GameRoom } from './game-room'
import { BASE_PACK, PACKS, publicCatalog, validateWords } from './packs'
import { parsePackCommand, parseSelectPack } from './validation'
import type { CommandResult } from '../lib/game-protocol'
const premium = Object.freeze({ ...PACKS[1]!, enabled: true })
const request = { configurationRevision: 0, requestId: 'request-001' }
afterEach(() => vi.useRealTimers())
function setup(
  authorize = vi.fn(async (): Promise<CommandResult> => ({
    status: 'success',
  })),
) {
  const server = new GameServer(undefined, undefined, undefined, authorize, [
    BASE_PACK,
    premium,
  ])
  const created = server.createRoom('host', 'Host')
  if (created.status !== 'success') throw new Error('creation failed')
  server.joinRoom('guest', created.roomCode, 'Guest')
  return { server, roomCode: created.roomCode, authorize }
}
describe('pack content', () => {
  it('validates distinct normalized entries and excludes full pools and features from the catalog', () => {
    expect(validateWords(BASE_PACK.words).length).toBeGreaterThanOrEqual(12)
    expect(() => validateWords(Array(12).fill('same'))).toThrow()
    expect(() =>
      validateWords([...premium.words.slice(0, 11), '\u0000']),
    ).toThrow()
    expect(() =>
      validateWords([...premium.words.slice(0, 11), 'x'.repeat(33)]),
    ).toThrow()
    expect(publicCatalog([premium])[0]).not.toHaveProperty('words')
    expect(publicCatalog([premium])[0]).not.toHaveProperty('feature')
  })
  it('validates bounded commands without trusting extra entitlement fields', () => {
    expect(
      parsePackCommand({
        roomCode: 'BCDF2',
        ...request,
        accountToken: 'x'.repeat(8193),
      }),
    ).toBeNull()
    expect(
      parsePackCommand({
        roomCode: 'BCDF2',
        ...request,
        configurationRevision: -1,
      }),
    ).toBeNull()
    expect(
      parseSelectPack({
        roomCode: 'BCDF2',
        ...request,
        packId: 'movies-v1',
        isPaid: true,
      }),
    ).not.toHaveProperty('isPaid')
  })
})
describe('guarded pack transitions', () => {
  it('requires host access at both selection and start, then uses the fixed pool for late joins and replacements', async () => {
    const { server, roomCode, authorize } = setup()
    const select = {
      ...request,
      roomCode,
      packId: premium.id,
      accountToken: 'fresh',
    }
    expect((await server.packCommand('guest', select, false)).status).toBe(
      'forbidden',
    )
    expect(authorize).not.toHaveBeenCalled()
    expect((await server.packCommand('host', select, false)).status).toBe(
      'success',
    )
    expect(
      (
        await server.packCommand(
          'host',
          { ...select, configurationRevision: 1 },
          true,
        )
      ).status,
    ).toBe('success')
    expect(authorize).toHaveBeenCalledTimes(2)
    server.joinRoom('late', roomCode, 'Late')
    const guest = server.snapshot('guest', roomCode)
    if (guest.status !== 'hinting' || !guest.board)
      throw new Error('missing guest board')
    expect(
      server.submitHint('guest', {
        roomCode,
        gameId: guest.gameId,
        hint: 'Cinema',
        targetCardIds: [guest.board.find((card) => !card.locked)!.id],
      }).status,
    ).toBe('success')
    expect(
      server.rejectHint('host', {
        roomCode,
        gameId: guest.gameId,
        playerId: guest.player.playerId,
      }).status,
    ).toBe('success')
    const replaced = server.snapshot('guest', roomCode)
    if (replaced.status !== 'hinting' || !replaced.board)
      throw new Error('missing replacement')
    expect(replaced.board).not.toEqual(guest.board)
    expect(
      replaced.board.every((card) => premium.words.includes(card.word)),
    ).toBe(true)
    server.leaveRoom('guest', roomCode)
    expect(server.joinRoom('guest', roomCode, 'Guest').status).toBe('success')
    for (const token of ['host', 'guest', 'late']) {
      const snap = server.snapshot(token, roomCode)
      expect(snap.status).toBe('hinting')
      if (snap.status !== 'hinting') throw new Error('missing hinting')
      expect(snap.board).toHaveLength(12)
      expect(
        snap.board?.every((card) => premium.words.includes(card.word)),
      ).toBe(true)
    }
    expect(authorize).toHaveBeenCalledTimes(2)
    server.leaveRoom('host', roomCode)
    expect(server.rooms.get(roomCode)?.selectedPack.id).toBe('base')
    server.leaveRoom('late', roomCode)
    expect(server.snapshot('guest', roomCode).status).toBe('lobby')
  })
  it('does not commit after host departure', async () => {
    let resolve!: (result: CommandResult) => void
    const { server, roomCode } = setup(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      ),
    )
    const pending = server.packCommand(
      'host',
      { ...request, roomCode, packId: premium.id },
      false,
    )
    expect(
      (await server.packCommand('host', { ...request, roomCode }, true)).status,
    ).toBe('rate_limited')
    server.leaveRoom('host', roomCode)
    resolve({ status: 'success' })
    expect((await pending).status).toBe('forbidden')
    expect(server.snapshot('guest', roomCode).status).toBe('lobby')
  })
  it.each(['replacement', 'expiry', 'revision'] as const)(
    'does not commit after room %s during access I/O',
    async (change) => {
      let resolve!: (result: CommandResult) => void
      const { server, roomCode } = setup(
        vi.fn(
          () =>
            new Promise((done) => {
              resolve = done
            }),
        ),
      )
      const room = server.rooms.get(roomCode)!
      const pending = server.packCommand(
        'host',
        { ...request, roomCode, packId: premium.id },
        false,
      )
      if (change === 'replacement')
        server.rooms.set(
          roomCode,
          new GameRoom(roomCode, { token: 'host', name: 'Host' }),
        )
      if (change === 'expiry')
        room.lastMeaningfulActivityAt = Date.now() - 3 * 60 * 60 * 1000
      if (change === 'revision') room.selectPack('host', 0, BASE_PACK)
      resolve({ status: 'success' })
      expect((await pending).status).toBe('stale')
      expect(server.rooms.get(roomCode)?.selectedPack.id).toBe('base')
      expect(server.snapshot('host', roomCode).status).toBe('lobby')
    },
  )
  it('denies a disabled pack before calling Clerk', async () => {
    const authorize = vi.fn(async (): Promise<CommandResult> => ({
      status: 'success',
    }))
    const server = new GameServer(undefined, undefined, undefined, authorize, [
      BASE_PACK,
      { ...premium, enabled: false },
    ])
    const created = server.createRoom('host', 'Host')
    if (created.status !== 'success') throw new Error('creation failed')
    expect(
      (
        await server.packCommand(
          'host',
          { ...request, roomCode: created.roomCode, packId: premium.id },
          false,
        )
      ).status,
    ).toBe('invalid')
    expect(authorize).not.toHaveBeenCalled()
  })
  it('allows immediate premium selection after Base without bypassing premium cooldowns', async () => {
    vi.useFakeTimers()
    const { server, roomCode, authorize } = setup()
    const select = async (packId: string) =>
      server.packCommand(
        'host',
        {
          ...request,
          roomCode,
          configurationRevision:
            server.rooms.get(roomCode)!.configurationRevision,
          packId,
        },
        false,
      )
    expect((await select('base')).status).toBe('success')
    expect((await select(premium.id)).status).toBe('success')
    expect(authorize).toHaveBeenCalledOnce()
    expect((await select('base')).status).toBe('success')
    expect((await select(premium.id)).status).toBe('rate_limited')
    expect(authorize).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2000)
    expect((await select('base')).status).toBe('success')
    expect((await select(premium.id)).status).toBe('success')
    expect(authorize).toHaveBeenCalledTimes(2)
  })

  it('keeps authorization exceptions recoverable and allows Base recovery', async () => {
    const { server, roomCode } = setup(
      vi.fn(async () => {
        throw new Error('provider unavailable')
      }),
    )
    expect(
      await server.packCommand(
        'host',
        {
          ...request,
          roomCode,
          packId: premium.id,
        },
        false,
      ),
    ).toMatchObject({ status: 'server_unavailable' })
    expect(
      await server.packCommand(
        'host',
        {
          ...request,
          roomCode,
          packId: 'base',
        },
        false,
      ),
    ).toMatchObject({ status: 'success' })
  })

  it('allows Base selection while premium authorization is still pending', async () => {
    let resolve!: (result: CommandResult) => void
    const { server, roomCode } = setup(
      vi.fn(
        () =>
          new Promise<CommandResult>((done) => {
            resolve = done
          }),
      ),
    )
    const pending = server.packCommand(
      'host',
      { ...request, roomCode, packId: premium.id },
      false,
    )
    expect(
      (
        await server.packCommand(
          'host',
          { ...request, roomCode, packId: 'base' },
          false,
        )
      ).status,
    ).toBe('success')
    resolve({ status: 'success' })
    expect((await pending).status).toBe('stale')
    expect(server.rooms.get(roomCode)?.selectedPack.id).toBe('base')
  })

  it('times out without a late start and allows deliberate base recovery', async () => {
    vi.useFakeTimers()
    let resolve!: (result: CommandResult) => void
    const { server, roomCode } = setup(
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      ),
    )
    const pending = server.packCommand(
      'host',
      { ...request, roomCode, packId: premium.id },
      false,
    )
    await vi.advanceTimersByTimeAsync(4500)
    expect((await pending).status).toBe('server_unavailable')
    expect(
      (
        await server.packCommand(
          'host',
          { ...request, roomCode, packId: premium.id },
          false,
        )
      ).status,
    ).toBe('rate_limited')
    expect(server.rooms.get(roomCode)?.selectedPack.id).toBe('base')
    expect(
      (await server.packCommand('host', { ...request, roomCode }, true)).status,
    ).toBe('success')
    resolve({ status: 'success' })
    await Promise.resolve()
    expect(server.snapshot('host', roomCode).status).toBe('hinting')
  })
  it('denies unknown packs, duplicate starts and stale revisions', async () => {
    const { server, roomCode } = setup()
    expect(
      (
        await server.packCommand(
          'host',
          { ...request, roomCode, packId: 'unknown' },
          false,
        )
      ).status,
    ).toBe('invalid')
    expect(
      (
        await server.packCommand(
          'host',
          { ...request, roomCode, configurationRevision: 10 },
          true,
        )
      ).status,
    ).toBe('stale')
    expect(
      (await server.packCommand('host', { ...request, roomCode }, true)).status,
    ).toBe('success')
    expect(
      (await server.packCommand('host', { ...request, roomCode }, true)).status,
    ).toBe('stale')
  })
})
