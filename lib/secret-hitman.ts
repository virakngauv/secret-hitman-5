import { createHash } from 'node:crypto'

import { BOARD_CARD_COUNT, type CardKind } from './game-protocol'
import { SECRET_HITMAN_WORDS } from './words'

export type GameCard = {
  id: string
  word: string
  kind: CardKind
  claimers: Array<{ playerId: string; name: string }>
}

export function createPlayerBoard(seed: string, position: number): GameCard[] {
  const words = shuffle(SECRET_HITMAN_WORDS, `${seed}:words:${position}`).slice(
    0,
    BOARD_CARD_COUNT,
  )
  const assassinIndex = seededInteger(
    `${seed}:assassin:${position}`,
    words.length,
  )

  return words.map((word, index) => ({
    id: `p${position}-card-${index}`,
    word,
    kind: index === assassinIndex ? 'assassin' : 'civilian',
    claimers: [],
  }))
}

export function applyTargets(board: GameCard[], targetCardIds: string[]) {
  const targets = new Set(targetCardIds)
  for (const card of board) {
    if (card.kind === 'assassin') continue
    card.kind = targets.has(card.id) ? 'target' : 'civilian'
  }
}

function shuffle<T>(values: readonly T[], seed: string): T[] {
  const copy = [...values]
  let state = seedState(seed)
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = xorshift32(state)
    const target = state % (index + 1)
    const value = copy[index]!
    copy[index] = copy[target]!
    copy[target] = value
  }
  return copy
}

function seededInteger(seed: string, upperBound: number) {
  return seedState(seed) % upperBound
}

function seedState(seed: string) {
  const digest = createHash('sha256').update(seed).digest()
  return digest.readUInt32LE(0) || 0x9e3779b9
}

function xorshift32(value: number) {
  let state = value >>> 0
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return state >>> 0
}
