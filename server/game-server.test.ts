import { describe, expect, it } from 'vitest'

import { GameServer } from './game-server'

describe('GameServer', () => {
  it('creates collision-free rooms and restores a token snapshot', () => {
    const server = new GameServer(undefined, () => 0)
    const first = createdRoom(server, 'a'.repeat(32), 'Ada', 1_000)
    const second = createdRoom(server, 'b'.repeat(32), 'Grace', 1_001)

    expect(first.roomCode).toBe('bbbb2')
    expect(second.roomCode).not.toBe(first.roomCode)
    expect(server.snapshot('a'.repeat(32), first.roomCode)).toMatchObject({
      status: 'lobby',
      player: { name: 'Ada' },
    })
  })

  it('expires rooms from meaningful activity without connectivity traffic', () => {
    const server = new GameServer({ roomIdleMs: 100 })
    const { roomCode } = createdRoom(server, 'a'.repeat(32), 'Ada', 1_000)

    expect(server.snapshot('a'.repeat(32), roomCode).status).toBe('lobby')
    expect(server.expireRooms(1_099)).toEqual([])
    expect(server.expireRooms(1_100)).toEqual([roomCode])
    expect(server.expireRooms(1_101)).toEqual([])
    expect(server.snapshot('a'.repeat(32), roomCode)).toEqual({
      status: 'not_found',
      roomCode,
    })
  })

  it('expires every phase after the same shared idle window and starts a new process empty', () => {
    const expiration = { roomIdleMs: 200 }
    const server = new GameServer(expiration)
    const host = 'a'.repeat(32)
    const guest = 'b'.repeat(32)
    const { roomCode } = createdRoom(server, host, 'Ada', 1_000)
    server.joinRoom(guest, roomCode, 'Grace', 1_001)
    server.startGame(host, roomCode, 1_002)

    expect(server.expireRooms(1_201)).toEqual([])
    expect(server.expireRooms(1_202)).toEqual([roomCode])
    expect(new GameServer(expiration).rooms.size).toBe(0)
  })

  it('deletes a lobby after its final member explicitly leaves', () => {
    const server = new GameServer()
    const token = 'a'.repeat(32)
    const { roomCode } = createdRoom(server, token, 'Ada', 1_000)
    server.leaveRoom(token, roomCode, 1_001)
    expect(server.rooms.has(roomCode)).toBe(false)
  })

  it('routes host removal without exposing the removed token in snapshots', () => {
    const server = new GameServer()
    const host = 'a'.repeat(32)
    const guest = 'b'.repeat(32)
    const { roomCode } = createdRoom(server, host, 'Ada', 1_000)
    server.joinRoom(guest, roomCode, 'Grace', 1_001)
    const lobby = server.snapshot(host, roomCode)
    if (lobby.status !== 'lobby') throw new Error('Expected lobby.')
    const guestId = lobby.members[1]?.playerId
    if (!guestId) throw new Error('Expected guest player id.')

    expect(server.removePlayer(host, roomCode, guestId, 1_002)).toEqual({
      status: 'success',
      removedToken: guest,
    })
    expect(server.snapshot(guest, roomCode)).toEqual({
      status: 'removed_from_room',
      roomCode,
    })
    expect(server.joinRoom(guest, roomCode, 'Grace II', 1_003)).toEqual({
      status: 'removed_from_room',
      message: 'The host removed you from this room. You can’t rejoin it.',
    })
    expect(server.joinRoom('c'.repeat(32), roomCode, 'Linus', 1_004)).toEqual({
      status: 'success',
      roomCode,
    })
  })

  it('returns a typed failure when the process reaches room capacity', () => {
    const server = new GameServer(undefined, () => 0, 1)
    createdRoom(server, 'a'.repeat(32), 'Ada', 1_000)

    expect(server.createRoom('b'.repeat(32), 'Grace', 1_001)).toEqual({
      status: 'server_unavailable',
      message: 'The game server is at capacity. Please try again later.',
    })
  })
})

function createdRoom(
  server: GameServer,
  token: string,
  name: string,
  now: number,
) {
  const result = server.createRoom(token, name, now)
  if (result.status !== 'success') throw new Error(result.message)
  return result
}
