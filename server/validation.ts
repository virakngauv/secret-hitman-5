import {
  GAME_PROTOCOL_VERSION,
  MAX_TARGET_COUNT,
  type ClaimCardPayload,
  type CreateRoomPayload,
  type FinishGuessingPayload,
  type JoinRoomPayload,
  type RemovePlayerPayload,
  type RoomCommandPayload,
  type SessionResumePayload,
  type SocketHandshakeAuth,
  type SubmitHintPayload,
} from '../lib/game-protocol'
import { ROOM_CODE_PATTERN } from '../lib/room-code'

export const CLIENT_TOKEN_PATTERN = /^[0-9a-f]{32}$/
export { ROOM_CODE_PATTERN }
export const COMMAND_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
export const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const CARD_ID_PATTERN = /^p\d{1,2}-card-\d{1,2}$/
export const MAX_PLAYER_NAME_LENGTH = 50
export const MAX_HINT_LENGTH = 40
const UNSAFE_TEXT_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

type UnknownRecord = Record<string, unknown>

export function parseHandshakeAuth(value: unknown): SocketHandshakeAuth | null {
  if (!isRecord(value)) return null

  return value.protocolVersion === GAME_PROTOCOL_VERSION &&
    typeof value.token === 'string' &&
    CLIENT_TOKEN_PATTERN.test(value.token)
    ? { token: value.token, protocolVersion: GAME_PROTOCOL_VERSION }
    : null
}

export function parseSessionResume(
  value: unknown,
): SessionResumePayload | null {
  if (!isRecord(value)) return null
  if (value.roomCode === undefined) return {}
  const roomCode = parseRoomCode(value.roomCode)
  return roomCode ? { roomCode } : null
}

export function parseCreateRoom(value: unknown): CreateRoomPayload | null {
  if (!isRecord(value)) return null
  const name = parsePlayerName(value.name)
  return name ? { name } : null
}

export function parseJoinRoom(value: unknown): JoinRoomPayload | null {
  if (!isRecord(value)) return null
  const roomCode = parseRoomCode(value.roomCode)
  const name = parsePlayerName(value.name)
  return roomCode && name ? { roomCode, name } : null
}

export function parseRoomCommand(value: unknown): RoomCommandPayload | null {
  if (!isRecord(value)) return null
  const roomCode = parseRoomCode(value.roomCode)
  return roomCode ? { roomCode } : null
}

export function parseFinishGuessing(
  value: unknown,
): FinishGuessingPayload | null {
  if (!isRecord(value)) return null
  const room = parseRoomCommand(value)
  return room &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 0
    ? { ...room, revision: value.revision as number }
    : null
}

export function parseRemovePlayer(value: unknown): RemovePlayerPayload | null {
  if (!isRecord(value)) return null
  const roomCode = parseRoomCode(value.roomCode)
  return roomCode &&
    typeof value.playerId === 'string' &&
    PLAYER_ID_PATTERN.test(value.playerId)
    ? { roomCode, playerId: value.playerId }
    : null
}

export function parseSubmitHint(value: unknown): SubmitHintPayload | null {
  if (!isRecord(value)) return null
  const roomCode = parseRoomCode(value.roomCode)
  const hint = parseHint(value.hint)
  const targetCardIds = value.targetCardIds

  if (
    !roomCode ||
    !hint ||
    !Array.isArray(targetCardIds) ||
    targetCardIds.length < 1 ||
    targetCardIds.length > MAX_TARGET_COUNT ||
    targetCardIds.some(
      (cardId) => typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId),
    )
  ) {
    return null
  }

  return { roomCode, hint, targetCardIds: targetCardIds as string[] }
}

export function parseClaimCard(value: unknown): ClaimCardPayload | null {
  if (!isRecord(value)) return null
  const roomCode = parseRoomCode(value.roomCode)

  if (
    !roomCode ||
    typeof value.commandId !== 'string' ||
    !COMMAND_ID_PATTERN.test(value.commandId) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.cardId !== 'string' ||
    !CARD_ID_PATTERN.test(value.cardId)
  ) {
    return null
  }

  return {
    roomCode,
    commandId: value.commandId,
    revision: value.revision as number,
    cardId: value.cardId,
  }
}

export function parseRoomCode(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return ROOM_CODE_PATTERN.test(normalized) ? normalized : null
}

export function parsePlayerName(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_TEXT_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length > 0 && normalized.length <= MAX_PLAYER_NAME_LENGTH
    ? normalized
    : null
}

export function parseHint(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_TEXT_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length > 0 && normalized.length <= MAX_HINT_LENGTH
    ? normalized
    : null
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
