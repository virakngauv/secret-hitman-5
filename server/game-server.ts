import { randomBytes, randomInt } from 'node:crypto'

import type {
  ClaimCardPayload,
  CommandResult,
  RoomSnapshot,
  SubmitHintPayload,
} from '../lib/game-protocol'
import { GameRoom } from './game-room'
import { ROOM_CODE_CONSONANTS, ROOM_CODE_FINAL_CHARACTERS } from './room-code'

const MAX_CODE_ATTEMPTS = 25
export const MAX_ACTIVE_ROOMS = 25_000

export type RoomExpirationPolicy = {
  roomIdleMs: number
}

export const DEFAULT_ROOM_EXPIRATION: RoomExpirationPolicy = {
  roomIdleMs: 2 * 60 * 60 * 1_000,
}

export class GameServer {
  readonly rooms = new Map<string, GameRoom>()

  constructor(
    private readonly expiration = DEFAULT_ROOM_EXPIRATION,
    private readonly random: () => number = () => randomInt(2 ** 30) / 2 ** 30,
    private readonly maxRooms = MAX_ACTIVE_ROOMS,
  ) {}

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

    const roomCode = this.availableRoomCode()
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

  startGuessing(token: string, roomCode: string, now = Date.now()) {
    return this.withRoom(roomCode, (room) => room.startGuessing(token, now))
  }

  claimCard(token: string, payload: ClaimCardPayload, now = Date.now()) {
    return this.withRoom(payload.roomCode, (room) =>
      room.claimCard(token, payload, now),
    )
  }

  finishGuessing(token: string, roomCode: string, now = Date.now()) {
    return this.withRoom(roomCode, (room) => room.finishGuessing(token, now))
  }

  advanceTurn(token: string, roomCode: string, now = Date.now()) {
    return this.withRoom(roomCode, (room) => room.advanceTurn(token, now))
  }

  snapshot(token: string, roomCode: string): RoomSnapshot {
    return (
      this.rooms.get(roomCode)?.snapshotFor(token) ?? {
        status: 'not_found',
        roomCode,
      }
    )
  }

  expireRooms(now = Date.now()) {
    const expired: string[] = []
    for (const [roomCode, room] of this.rooms) {
      if (now - room.lastMeaningfulActivityAt >= this.expiration.roomIdleMs) {
        this.rooms.delete(roomCode)
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

  private availableRoomCode() {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = `${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_CONSONANTS, this.random)}${pick(ROOM_CODE_FINAL_CHARACTERS, this.random)}`
      if (!this.rooms.has(code)) return code
    }
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const bytes = randomBytes(5)
      const code = `${ROOM_CODE_CONSONANTS[bytes[0]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_CONSONANTS[bytes[1]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_CONSONANTS[bytes[2]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_CONSONANTS[bytes[3]! % ROOM_CODE_CONSONANTS.length]}${ROOM_CODE_FINAL_CHARACTERS[bytes[4]! % ROOM_CODE_FINAL_CHARACTERS.length]}`
      if (!this.rooms.has(code)) return code
    }
    return null
  }
}

function pick(characters: string, random: () => number) {
  return characters.charAt(Math.floor(random() * characters.length))
}
