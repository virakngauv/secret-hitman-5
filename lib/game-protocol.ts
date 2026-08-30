export const GAME_PROTOCOL_VERSION = 7 as const
export const MAX_STARTING_PLAYERS = 12

export const BOARD_CARD_COUNT = 12
export const MIN_TARGET_COUNT = 1
export const MAX_TARGET_COUNT = 5

export type RoomPhase = 'lobby' | 'hinting' | 'guessing' | 'finished'
export type PlayerRole = 'host' | 'player'
export type Participation = 'player' | 'spectator'
export type CardKind = 'target' | 'civilian' | 'assassin'

export const CARD_SCORE = {
  target: 3,
  civilian: -1,
  assassin: -5,
} as const satisfies Record<CardKind, number>

export type PlayerIdentity = {
  playerId: string
  name: string
  role: PlayerRole
  participation: Participation
}

export type ScoreboardEntry = PlayerIdentity & {
  position: number | null
  score: number | null
}

export type HintStatus = {
  playerId: string
  name: string
  submitted: boolean
}

export type HintCardSnapshot = {
  id: string
  word: string
  kind: 'neutral' | CardKind
  locked: boolean
}

export type GuessCardSnapshot = {
  id: string
  word: string
  revealedKind: CardKind | null
  claimedBy: string[]
  selectedByYou: boolean
  disabled: boolean
}

export type TurnPlayerSnapshot = {
  playerId: string
  name: string
  state: 'clue-giver' | 'guessing' | 'done'
}

type MemberSnapshotBase = {
  roomCode: string
  player: PlayerIdentity
  members: PlayerIdentity[]
}

export type RoomSnapshot =
  | { status: 'not_found'; roomCode: string }
  | { status: 'joinable'; roomCode: string; joinsAsSpectator: boolean }
  | { status: 'removed_from_room'; roomCode: string }
  | ({ status: 'lobby'; minimumPlayers: number } & MemberSnapshotBase)
  | ({
      status: 'hinting'
      hintStatuses: HintStatus[]
      allHintsSubmitted: boolean
      board: HintCardSnapshot[] | null
      hint: string | null
      hintSubmitted: boolean
    } & MemberSnapshotBase)
  | ({
      status: 'guessing'
      turnId: string
      turnNumber: number
      totalTurns: number
      clueGiverId: string
      clueGiverName: string
      hint: string
      hintNumber: number
      board: GuessCardSnapshot[]
      turnPlayers: TurnPlayerSnapshot[]
      scoreboard: ScoreboardEntry[]
      canGuess: boolean
      canMarkDone: boolean
      canAdvanceTurn: boolean
    } & MemberSnapshotBase)
  | ({
      status: 'finished'
      scoreboard: ScoreboardEntry[]
      winners: ScoreboardEntry[]
      lastClueGiverName: string
      lastHint: string
      lastHintNumber: number
      board: GuessCardSnapshot[]
    } & MemberSnapshotBase)

export function isMemberSnapshot(
  snapshot: RoomSnapshot,
): snapshot is Extract<
  RoomSnapshot,
  { status: 'lobby' | 'hinting' | 'guessing' | 'finished' }
> {
  return (
    snapshot.status === 'lobby' ||
    snapshot.status === 'hinting' ||
    snapshot.status === 'guessing' ||
    snapshot.status === 'finished'
  )
}

export type CommandFailureStatus =
  | 'invalid'
  | 'forbidden'
  | 'room_not_found'
  | 'room_full'
  | 'removed_from_room'
  | 'stale'
  | 'already_claimed'
  | 'rate_limited'
  | 'server_unavailable'

export type CommandSuccess<T extends object = Record<never, never>> = {
  status: 'success'
} & T

export type CommandFailure = {
  status: CommandFailureStatus
  message: string
}

export type CommandResult<T extends object = Record<never, never>> =
  CommandSuccess<T> | CommandFailure

export type SessionResumePayload = { roomCode?: string }
export type CreateRoomPayload = { name: string }
export type JoinRoomPayload = { roomCode: string; name: string }
export type RoomCommandPayload = { roomCode: string }
export type FinishGuessingPayload = RoomCommandPayload & { turnId: string }
export type RemovePlayerPayload = RoomCommandPayload & { playerId: string }
export type SubmitHintPayload = RoomCommandPayload & {
  hint: string
  targetCardIds: string[]
}
export type ClaimCardPayload = RoomCommandPayload & {
  commandId: string
  turnId: string
  cardId: string
}

export type ClientToServerEvents = {
  'session:resume': (
    payload: SessionResumePayload,
    acknowledge: (result: CommandResult<{ snapshot?: RoomSnapshot }>) => void,
  ) => void
  'room:create': (
    payload: CreateRoomPayload,
    acknowledge: (result: CommandResult<{ roomCode: string }>) => void,
  ) => void
  'room:join': (
    payload: JoinRoomPayload,
    acknowledge: (result: CommandResult<{ roomCode: string }>) => void,
  ) => void
  'room:leave': (
    payload: RoomCommandPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
  'room:remove-player': (
    payload: RemovePlayerPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
  'game:start': (
    payload: RoomCommandPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
  'game:submit-hint': (
    payload: SubmitHintPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
  'game:unlock-hint': (
    payload: RoomCommandPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
  'game:start-guessing': (
    payload: RoomCommandPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
  'game:claim-card': (
    payload: ClaimCardPayload,
    acknowledge: (result: CommandResult<{ kind: CardKind }>) => void,
  ) => void
  'game:finish-guessing': (
    payload: FinishGuessingPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
  'game:advance-turn': (
    payload: RoomCommandPayload,
    acknowledge: (result: CommandResult) => void,
  ) => void
}

export type ServerToClientEvents = {
  'room:snapshot': (snapshot: RoomSnapshot) => void
  'room:removed': (payload: { roomCode: string }) => void
  'room:expired': (payload: { roomCode: string; reason: 'idle' }) => void
  'server:shutdown': () => void
}

export type SocketHandshakeAuth = {
  token: string
  protocolVersion: typeof GAME_PROTOCOL_VERSION
}
