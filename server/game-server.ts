import { randomBytes, randomInt } from 'node:crypto'

import type {
  ClaimCardPayload,
  CommandResult,
  FinishGuessingPayload,
  RoomSnapshot,
  RejectHintPayload,
  SubmitHintPayload,
} from '../lib/game-protocol'
import { GameRoom } from './game-room'
import {
  ROOM_CODE_CONSONANTS,
  ROOM_CODE_FINAL_CHARACTERS,
} from '../lib/room-code'

const MAX_CODE_ATTEMPTS = 25
export const MAX_ACTIVE_ROOMS = 25_000

export type RoomExpirationPolicy = {
  roomIdleMs: number
  expiredRoomTombstoneMs?: number
}

export const DEFAULT_ROOM_EXPIRATION = {
  roomIdleMs: 2 * 60 * 60 * 1_000,
  expiredRoomTombstoneMs: 5 * 60 * 1_000,
} satisfies Required<RoomExpirationPolicy>

export class GameServer {
  readonly rooms = new Map<string, GameRoom>()
  private readonly expiredRooms = new Map<string, number>()
  private readonly expiration: Required<RoomExpirationPolicy>

  constructor(
    expiration: RoomExpirationPolicy = DEFAULT_ROOM_EXPIRATION,
    private readonly random: () => number = () => randomInt(2 ** 30) / 2 ** 30,
    private readonly maxRooms = MAX_ACTIVE_ROOMS,
  ) {
    this.expiration = {
      roomIdleMs: expiration.roomIdleMs,
      expiredRoomTombstoneMs:
        expiration.expiredRoomTombstoneMs ??
        DEFAULT_ROOM_EXPIRATION.expiredRoomTombstoneMs,
    }
  }

  createRoom(
    token: string,
    name: string,
    now = Date.now(),
  ): CommandResult<{ roomCode: string }> {
    if (this.rooms.size >= this.maxRooms) {
      return {
        status: 'server_unavailable',
        message: 'The game server is at capacity. Please try again later.',
      }
    }

    const roomCode = this.availableRoomCode(now)
    if (!roomCode) {
      return {
        status: 'server_unavailable',
        message: 'A room code could not be allocated. Please try again.',
      }
    }
    this.rooms.set(roomCode, new GameRoom(roomCode, { token, name }, { now }))
    return { status: 'success' as const, roomCode }
  }

  joinRoom(
    token: string,
    roomCode: string,
    name: string,
    now = Date.now(),
  ): CommandResult<{ roomCode: string }> {
    const room = this.rooms.get(roomCode)
    if (!room) {
      return { status: 'room_not_found', message: 'Room not found.' }
    }
    const result = room.join(token, name, now)
    return result.status === 'success'
      ? { status: 'success', roomCode }
      : result
  }

  leaveRoom(token: string, roomCode: string, now = Date.now()) {
    const room = this.rooms.get(roomCode)
    if (!room) return { status: 'success' as const }
    const result = room.leave(token, now)
    if (room.isEmpty()) this.rooms.delete(roomCode)
    return result
  }

  removePlayer(
    token: string,
    roomCode: string,
    playerId: string,
    now = Date.now(),
  ) {
    return this.withRoom(roomCode, (room) =>
      room.removePlayer(token, playerId, now),
    )
  }

  startGame(token: string, roomCode: string, now = Date.now()) {
    return this.withRoom(roomCode, (room) => room.start(token, now))
  }

  submitHint(token: string, payload: SubmitHintPayload, now = Date.now()) {
    return this.withRoom(payload.roomCode, (room) =>
      room.submitHint(token, payload, now),
    )
  }

  unlockHint(token: string, roomCode: string, now = Date.now()) {
    return this.withRoom(roomCode, (room) => room.unlockHint(token, now))
  }

  rejectHint(token: string, payload: RejectHintPayload, now = Date.now()) {
    return this.withRoom(payload.roomCode, (room) =>
      room.rejectHint(token, payload, now),
    )
  }

  startGuessing(token: string, roomCode: string, now = Date.now()) {
    return this.withRoom(roomCode, (room) => room.startGuessing(token, now))
  }

  claimCard(token: string, payload: ClaimCardPayload, now = Date.now()) {
    return this.withRoom(payload.roomCode, (room) =>
      room.claimCard(token, payload, now),
    )
  }

  finishGuessing(
    token: string,
    payload: FinishGuessingPayload,
    now = Date.now(),
  ) {
    return this.withRoom(payload.roomCode, (room) =>
      room.finishGuessing(token, payload, now),
    )
  }

  advanceTurn(token: string, roomCode: string, now = Date.now()) {
    return this.withRoom(roomCode, (room) => room.advanceTurn(token, now))
  }

  snapshot(token: string, roomCode: string, now = Date.now()): RoomSnapshot {
    const room = this.rooms.get(roomCode)
    if (room) return room.snapshotFor(token)

    const tombstoneExpiresAt = this.expiredRooms.get(roomCode)
    if (tombstoneExpiresAt !== undefined) {
      if (now < tombstoneExpiresAt) return { status: 'expired', roomCode }
      this.expiredRooms.delete(roomCode)
    }
    return { status: 'not_found', roomCode }
  }

  expireRooms(now = Date.now()) {
    this.pruneExpiredRoomTombstones(now)
    const expired: string[] = []
    for (const [roomCode, room] of this.rooms) {
      if (now - room.lastMeaningfulActivityAt >= this.expiration.roomIdleMs) {
        this.rooms.delete(roomCode)
        if (this.expiration.expiredRoomTombstoneMs > 0) {
          this.expiredRooms.set(
            roomCode,
            now + this.expiration.expiredRoomTombstoneMs,
          )
        }
        expired.push(roomCode)
      }
    }
    return expired
  }

  private withRoom<TResult extends object = Record<never, never>>(
    roomCode: string,
    action: (room: GameRoom) => CommandResult<TResult>,
  ): CommandResult<TResult> {
    const room = this.rooms.get(roomCode)
    return room
      ? action(room)
      : { status: 'room_not_found', message: 'Room not found.' }
  }

  private availableRoomCode(now: number) {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = `${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_FINAL_CHARACTERS, this.random)}`
      if (this.isRoomCodeAvailable(code, now)) return code
    }
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const bytes = randomBytes(5)
      const code = `${ROOM_CODE_CONSONANTS[bytes[0]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_CONSONANTS[bytes[1]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_CONSONANTS[bytes[2]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_CONSONANTS[bytes[3]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_FINAL_CHARACTERS[bytes[4]! % ROOM_CODE_FINAL_CHARACTERS.length]}`
      if (this.isRoomCodeAvailable(code, now)) return code
    }
    return null
  }

  private isRoomCodeAvailable(roomCode: string, now: number) {
    if (this.rooms.has(roomCode)) return false
    const tombstoneExpiresAt = this.expiredRooms.get(roomCode)
    if (tombstoneExpiresAt === undefined) return true
    if (now < tombstoneExpiresAt) return false
    this.expiredRooms.delete(roomCode)
    return true
  }

  private pruneExpiredRoomTombstones(now: number) {
    for (const [roomCode, expiresAt] of this.expiredRooms) {
      if (now >= expiresAt) this.expiredRooms.delete(roomCode)
    }
  }
}

function pick(characters: string, random: () => number) {
  return characters.charAt(Math.floor(random() * characters.length))
}
