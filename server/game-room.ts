import { randomUUID } from 'node:crypto'

import {
  MAX_STARTING_PLAYERS,
  type CardKind,
  type ClaimCardPayload,
  type CommandResult,
  type FinishGuessingPayload,
  type Participation,
  type PlayerIdentity,
  type PlayerRole,
  type RoomPhase,
  type RoomSnapshot,
  type ScoreboardEntry,
  type SubmitHintPayload,
} from '../lib/game-protocol'
import {
  applyTargets,
  createPlayerBoard,
  type GameCard,
} from '../lib/secret-hitman'
import { fingerprintClientToken } from './token-fingerprint'

export const MIN_STARTING_PLAYERS = 2
export { MAX_STARTING_PLAYERS }
export const MAX_ROOM_MEMBERS = 32
// Bound retained identities without ever evicting a room's removal restrictions.
export const MAX_ROOM_IDENTITIES = 1_024
const MAX_REMEMBERED_COMMANDS_PER_PLAYER = 100

type Member = {
  playerId: string
  token: string
  name: string
  role: PlayerRole
  participation: Participation
  joinedAt: number
  active: boolean
  game: GameSeat | null
}

type GameSeat = {
  position: number
  score: number
  board: GameCard[]
  hint: string | null
  targetCount: number
  hintSubmitted: boolean
  turnState: 'waiting' | 'guessing' | 'done'
}

type GameState = {
  seed: string
  playerOrder: string[]
  turnIndex: number
  turnStartRevision: number
}

export type GameRoomOptions = {
  now?: number
  createPlayerId?: () => string
  seed?: string
}

export class GameRoom {
  readonly code: string
  phase: RoomPhase = 'lobby'
  revision = 1
  lastMeaningfulActivityAt: number

  private readonly members: Member[]
  private readonly removedTokenFingerprints = new Set<string>()
  private game: GameState | null = null
  private readonly createPlayerId: () => string
  private readonly initialSeed: string
  private readonly commandResults = new Map<
    string,
    Map<string, CommandResult<{ kind: CardKind }>>
  >()

  constructor(
    code: string,
    host: { token: string; name: string },
    options: GameRoomOptions = {},
  ) {
    const now = options.now ?? Date.now()
    this.code = code
    this.lastMeaningfulActivityAt = now
    this.createPlayerId = options.createPlayerId ?? randomUUID
    this.initialSeed = options.seed ?? `${code}:${now}:${randomUUID()}`
    this.members = [this.createMember(host.token, host.name, 'host', now)]
  }

  join(token: string, name: string, now = Date.now()): CommandResult {
    if (this.isRemovedToken(token)) {
      return {
        status: 'removed_from_room',
        message: 'The host removed you from this room. You can’t rejoin it.',
      }
    }

    const existing = this.findMember(token)
    if (existing?.active) {
      this.touch(now)
      return { status: 'success' }
    }
    // Starting players keep their seats even while inactive. Spectators may
    // use only the remaining capacity, so reconnects never exceed the limit.
    const occupiedSlots = this.members.filter(
      (member) => member.active || member.game !== null,
    ).length
    if (!existing?.game && occupiedSlots >= MAX_ROOM_MEMBERS) {
      return { status: 'room_full', message: 'This room is full.' }
    }
    if (
      !existing &&
      this.members.length + this.removedTokenFingerprints.size >=
        MAX_ROOM_IDENTITIES
    ) {
      return {
        status: 'room_full',
        message:
          'This room has reached its player history limit. Please create a new room.',
      }
    }

    if (existing) {
      existing.name = name
      existing.active = true
    } else {
      const member = this.createMember(token, name, 'player', now)
      if (this.phase !== 'lobby') member.participation = 'spectator'
      this.members.push(member)
    }

    this.changed(now)
    return { status: 'success' }
  }

  leave(token: string, now = Date.now()): CommandResult {
    const member = this.findActiveMember(token)
    if (!member) return { status: 'success' }

    member.active = false
    if (member.role === 'host') {
      member.role = 'player'
      const successor = this.activeMembers()[0]
      if (successor) successor.role = 'host'
    }

    if (this.phase === 'lobby') {
      const index = this.members.indexOf(member)
      if (index >= 0) this.members.splice(index, 1)
    } else if (member.game) {
      if (this.phase === 'hinting' && !member.game.hintSubmitted) {
        member.game.hint = 'PASS'
        member.game.targetCount = member.game.board.filter(
          ({ kind }) => kind === 'target',
        ).length
        member.game.hintSubmitted = true
      }
      if (this.phase === 'guessing') member.game.turnState = 'done'
    }

    this.commandResults.delete(token)
    this.changed(now)
    return { status: 'success' }
  }

  removePlayer(
    token: string,
    playerId: string,
    now = Date.now(),
  ): CommandResult<{ removedToken: string }> {
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can remove a player.',
      }
    }
    if (this.phase !== 'lobby') {
      return {
        status: 'invalid',
        message: 'Players can only be removed from the lobby.',
      }
    }

    const target = this.members.find(
      (member) => member.active && member.playerId === playerId,
    )
    if (!target) {
      return {
        status: 'stale',
        message: 'That player is no longer in the lobby.',
      }
    }
    if (target === actor || target.role === 'host') {
      return {
        status: 'forbidden',
        message: 'The host cannot be removed from the room.',
      }
    }

    this.removedTokenFingerprints.add(fingerprintClientToken(target.token))
    this.members.splice(this.members.indexOf(target), 1)
    this.commandResults.delete(target.token)
    this.changed(now)
    return { status: 'success', removedToken: target.token }
  }

  start(token: string, now = Date.now()): CommandResult {
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can start the game.',
      }
    }
    if (this.phase !== 'lobby') {
      return {
        status: 'invalid',
        message: 'The game can only start from the lobby.',
      }
    }

    const players = this.activeMembers()
    if (players.length < MIN_STARTING_PLAYERS) {
      return {
        status: 'invalid',
        message: `At least ${MIN_STARTING_PLAYERS} players are required to start.`,
      }
    }
    if (players.length > MAX_STARTING_PLAYERS) {
      return {
        status: 'invalid',
        message: `A game supports up to ${MAX_STARTING_PLAYERS} starting players.`,
      }
    }

    const seed = `${this.initialSeed}:${this.revision}:${now}`
    players.forEach((member, position) => {
      member.participation = 'player'
      member.game = {
        position,
        score: 0,
        board: createPlayerBoard(seed, position),
        hint: null,
        targetCount: 0,
        hintSubmitted: false,
        turnState: 'waiting',
      }
    })
    this.game = {
      seed,
      playerOrder: players.map(({ playerId }) => playerId),
      turnIndex: 0,
      turnStartRevision: 0,
    }
    this.phase = 'hinting'
    this.commandResults.clear()
    this.changed(now)
    return { status: 'success' }
  }

  submitHint(
    token: string,
    payload: SubmitHintPayload,
    now = Date.now(),
  ): CommandResult {
    const member = this.findActiveMember(token)
    const seat = member?.game
    if (!member || !seat || this.phase !== 'hinting') {
      return {
        status: 'forbidden',
        message: 'Only starting players can submit a hint.',
      }
    }
    if (seat.hintSubmitted) {
      return { status: 'invalid', message: 'Your hint is already locked in.' }
    }

    const targetIds = new Set(payload.targetCardIds)
    const selectableIds = new Set(
      seat.board
        .filter(({ kind, locked }) => !locked || kind === 'target')
        .map(({ id }) => id),
    )
    if (
      targetIds.size !== payload.targetCardIds.length ||
      targetIds.size < 1 ||
      [...targetIds].some((cardId) => !selectableIds.has(cardId)) ||
      seat.board.some(
        ({ id, kind, locked }) =>
          locked && kind === 'target' && !targetIds.has(id),
      )
    ) {
      return {
        status: 'invalid',
        message:
          'Keep the locked target selected and leave locked civilians and the assassin unchanged.',
      }
    }

    applyTargets(seat.board, payload.targetCardIds)
    seat.hint = payload.hint
    seat.targetCount = targetIds.size
    seat.hintSubmitted = true
    this.changed(now)
    return { status: 'success' }
  }

  startGuessing(token: string, now = Date.now()): CommandResult {
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can start guessing.',
      }
    }
    if (this.phase !== 'hinting' || !this.allHintsSubmitted()) {
      return {
        status: 'invalid',
        message: 'Wait for every player to lock in a hint.',
      }
    }

    this.phase = 'guessing'
    this.requireGame().turnIndex = 0
    this.prepareCurrentTurn()
    this.changed(now)
    return { status: 'success' }
  }

  claimCard(
    token: string,
    payload: ClaimCardPayload,
    now = Date.now(),
  ): CommandResult<{ kind: CardKind }> {
    const previous = this.commandResults.get(token)?.get(payload.commandId)
    if (previous) return previous

    const member = this.findActiveMember(token)
    const seat = member?.game
    if (!member || !seat || this.phase !== 'guessing') {
      return { status: 'forbidden', message: 'You cannot guess on this turn.' }
    }
    const clueGiver = this.currentClueGiver()
    if (
      member.playerId === clueGiver.playerId ||
      seat.turnState !== 'guessing'
    ) {
      return { status: 'forbidden', message: 'You cannot guess on this turn.' }
    }
    // Claims from the same turn can race. Validate against current card
    // ownership below, while rejecting requests from a different turn.
    if (
      payload.revision < this.requireGame().turnStartRevision ||
      payload.revision > this.revision
    ) {
      return this.remember(token, payload.commandId, {
        status: 'stale',
        message: 'The board changed before that guess arrived.',
      })
    }

    const card = clueGiver.game?.board.find(({ id }) => id === payload.cardId)
    if (!card) {
      return this.remember(token, payload.commandId, {
        status: 'invalid',
        message: 'That card is not on the current board.',
      })
    }
    if (card.claimers.some(({ playerId }) => playerId === member.playerId)) {
      return this.remember(token, payload.commandId, {
        status: 'already_claimed',
        message: 'You already selected that card.',
      })
    }
    if (card.kind !== 'assassin' && card.claimers.length > 0) {
      return this.remember(token, payload.commandId, {
        status: 'already_claimed',
        message: 'Another player already claimed that card.',
      })
    }

    card.claimers.push({ playerId: member.playerId, name: member.name })
    if (card.kind === 'target') {
      seat.score += 1
      if (clueGiver.game) clueGiver.game.score += 1
    } else if (card.kind === 'civilian') {
      seat.turnState = 'done'
    } else {
      seat.score -= 1
      if (clueGiver.game) clueGiver.game.score -= 1
      seat.turnState = 'done'
    }

    if (this.allTargetsClaimed()) {
      for (const player of this.gamePlayers()) {
        if (player.playerId !== clueGiver.playerId && player.game) {
          player.game.turnState = 'done'
        }
      }
    }

    this.changed(now)
    return this.remember(token, payload.commandId, {
      status: 'success',
      kind: card.kind,
    })
  }

  finishGuessing(
    token: string,
    payload: FinishGuessingPayload,
    now = Date.now(),
  ): CommandResult {
    const member = this.findActiveMember(token)
    if (!member?.game || this.phase !== 'guessing') {
      return { status: 'forbidden', message: 'You are not an active guesser.' }
    }
    const clueGiver = this.currentClueGiver()
    if (member.playerId === clueGiver.playerId) {
      return { status: 'forbidden', message: 'You are not an active guesser.' }
    }
    if (
      payload.revision < this.requireGame().turnStartRevision ||
      payload.revision > this.revision
    ) {
      return {
        status: 'stale',
        message: 'That guessing turn is no longer current.',
      }
    }
    // Passing has no scoring effect: reaching the same finished state is
    // already a success, without changing revision or extending room life.
    if (member.game.turnState === 'done') return { status: 'success' }
    member.game.turnState = 'done'
    this.changed(now)
    return { status: 'success' }
  }

  advanceTurn(token: string, now = Date.now()): CommandResult {
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can advance the game.',
      }
    }
    if (this.phase !== 'guessing') {
      return {
        status: 'invalid',
        message: 'The game is not in the guessing phase.',
      }
    }
    if (this.hasActiveGuessers()) {
      return {
        status: 'invalid',
        message: 'Waiting for players to finish guessing.',
      }
    }

    const game = this.requireGame()
    if (game.turnIndex >= game.playerOrder.length - 1) {
      this.phase = 'finished'
    } else {
      game.turnIndex += 1
      this.prepareCurrentTurn()
    }
    this.commandResults.clear()
    this.changed(now)
    return { status: 'success' }
  }

  snapshotFor(token: string): RoomSnapshot {
    const member = this.findActiveMember(token)
    if (!member) {
      if (this.isRemovedToken(token)) {
        return { status: 'removed_from_room', roomCode: this.code }
      }
      return {
        status: 'joinable',
        roomCode: this.code,
        joinsAsSpectator: this.phase !== 'lobby',
      }
    }

    const base = {
      roomCode: this.code,
      revision: this.revision,
      player: this.identity(member),
      members: this.activeMembers().map((candidate) =>
        this.identity(candidate),
      ),
    }

    if (this.phase === 'lobby') {
      return { status: 'lobby', minimumPlayers: MIN_STARTING_PLAYERS, ...base }
    }

    if (this.phase === 'hinting') {
      return {
        status: 'hinting',
        ...base,
        hintStatuses: this.gamePlayers().map((player) => ({
          playerId: player.playerId,
          name: player.name,
          submitted: player.game?.hintSubmitted ?? false,
        })),
        allHintsSubmitted: this.allHintsSubmitted(),
        board:
          member.game?.board.map(({ id, word, kind, locked }) => ({
            id,
            word,
            kind: locked ? kind : 'neutral',
            locked,
          })) ?? null,
        hintSubmitted: member.game?.hintSubmitted ?? false,
      }
    }

    const clueGiver = this.currentClueGiver()
    const clueSeat = clueGiver.game
    if (!clueSeat?.hint)
      throw new Error('Current clue giver is missing a hint.')
    const revealAll =
      this.phase === 'finished' ||
      member === clueGiver ||
      member.game?.turnState === 'done'
    const board = clueSeat.board.map((card) => {
      const selectedByYou = card.claimers.some(
        ({ playerId }) => playerId === member.playerId,
      )
      const publiclyRevealed =
        card.kind !== 'assassin' && card.claimers.length > 0
      const revealedKind =
        revealAll ||
        publiclyRevealed ||
        (card.kind === 'assassin' && selectedByYou)
          ? card.kind
          : null
      const canGuess =
        this.phase === 'guessing' &&
        Boolean(member.game) &&
        member !== clueGiver &&
        member.game?.turnState === 'guessing'
      return {
        id: card.id,
        word: card.word,
        revealedKind,
        claimedBy:
          card.kind === 'assassin' && !revealAll
            ? card.claimers
                .filter(({ playerId }) => playerId === member.playerId)
                .map(({ name }) => name)
            : card.claimers.map(({ name }) => name),
        selectedByYou,
        disabled:
          !canGuess ||
          selectedByYou ||
          (card.kind !== 'assassin' && card.claimers.length > 0),
      }
    })

    if (this.phase === 'finished') {
      const scoreboard = this.scoreboard()
      const playerScores = scoreboard.filter(
        (entry): entry is ScoreboardEntry & { score: number } =>
          entry.participation === 'player' && entry.score !== null,
      )
      const winningScore = Math.max(...playerScores.map(({ score }) => score))
      return {
        status: 'finished',
        ...base,
        scoreboard,
        winners: playerScores.filter(({ score }) => score === winningScore),
        lastClueGiverName: clueGiver.name,
        lastHint: clueSeat.hint,
        lastHintNumber: clueSeat.targetCount,
        board,
      }
    }

    return {
      status: 'guessing',
      ...base,
      turnNumber: this.requireGame().turnIndex + 1,
      totalTurns: this.requireGame().playerOrder.length,
      clueGiverId: clueGiver.playerId,
      clueGiverName: clueGiver.name,
      hint: clueSeat.hint,
      hintNumber: clueSeat.targetCount,
      board,
      turnPlayers: this.gamePlayers().map((player) => ({
        playerId: player.playerId,
        name: player.name,
        state:
          player === clueGiver
            ? 'clue-giver'
            : player.game?.turnState === 'done'
              ? 'done'
              : 'guessing',
      })),
      scoreboard: this.scoreboard(),
      canGuess:
        Boolean(member.game) &&
        member !== clueGiver &&
        member.game?.turnState === 'guessing',
      canMarkDone:
        Boolean(member.game) &&
        member !== clueGiver &&
        member.game?.turnState === 'guessing',
      canAdvanceTurn: member.role === 'host' && !this.hasActiveGuessers(),
    }
  }

  isEmpty() {
    return this.activeMembers().length === 0
  }

  private createMember(
    token: string,
    name: string,
    role: PlayerRole,
    joinedAt: number,
  ): Member {
    return {
      playerId: this.createPlayerId(),
      token,
      name,
      role,
      participation: 'player',
      joinedAt,
      active: true,
      game: null,
    }
  }

  private identity(member: Member): PlayerIdentity {
    return {
      playerId: member.playerId,
      name: member.name,
      role: member.role,
      participation: member.participation,
    }
  }

  private activeMembers() {
    return this.members
      .filter(({ active }) => active)
      .sort((left, right) => left.joinedAt - right.joinedAt)
  }

  private gamePlayers() {
    const order = new Map(
      this.requireGame().playerOrder.map((playerId, index) => [
        playerId,
        index,
      ]),
    )
    return this.members
      .filter((member) => member.game !== null)
      .sort(
        (left, right) =>
          (order.get(left.playerId) ?? 0) - (order.get(right.playerId) ?? 0),
      )
  }

  private scoreboard(): ScoreboardEntry[] {
    const players: ScoreboardEntry[] = this.gamePlayers().map((member) => ({
      ...this.identity(member),
      position: member.game?.position ?? null,
      score: member.game?.score ?? null,
    }))
    const spectators: ScoreboardEntry[] = this.activeMembers()
      .filter(({ participation }) => participation === 'spectator')
      .map((member) => ({
        ...this.identity(member),
        position: null,
        score: null,
      }))
    return [...players, ...spectators]
  }

  private currentClueGiver() {
    const game = this.requireGame()
    const playerId = game.playerOrder[game.turnIndex]
    const member = this.members.find(
      (candidate) => candidate.playerId === playerId,
    )
    if (!member?.game) throw new Error('Current clue giver is missing.')
    return member
  }

  private prepareCurrentTurn() {
    this.requireGame().turnStartRevision = this.revision + 1
    const clueGiver = this.currentClueGiver()
    for (const player of this.gamePlayers()) {
      if (!player.game) continue
      player.game.turnState =
        player === clueGiver || !player.active ? 'done' : 'guessing'
    }
  }

  private allHintsSubmitted() {
    return this.gamePlayers().every(({ game }) => game?.hintSubmitted)
  }

  private hasActiveGuessers() {
    const clueGiver = this.currentClueGiver()
    return this.gamePlayers().some(
      (player) =>
        player.active &&
        player !== clueGiver &&
        player.game?.turnState === 'guessing',
    )
  }

  private allTargetsClaimed() {
    const board = this.currentClueGiver().game?.board ?? []
    const targets = board.filter(({ kind }) => kind === 'target')
    return (
      targets.length > 0 && targets.every(({ claimers }) => claimers.length > 0)
    )
  }

  private findMember(token: string) {
    return this.members.find((member) => member.token === token)
  }

  private findActiveMember(token: string) {
    const member = this.findMember(token)
    return member?.active ? member : null
  }

  private isRemovedToken(token: string) {
    return this.removedTokenFingerprints.has(fingerprintClientToken(token))
  }

  private requireGame() {
    if (!this.game) throw new Error('Room game state is missing.')
    return this.game
  }

  private touch(now: number) {
    this.lastMeaningfulActivityAt = now
  }

  private changed(now: number) {
    this.revision += 1
    this.touch(now)
  }

  private remember(
    token: string,
    commandId: string,
    result: CommandResult<{ kind: CardKind }>,
  ) {
    let results = this.commandResults.get(token)
    if (!results) {
      results = new Map()
      this.commandResults.set(token, results)
    }
    results.set(commandId, result)
    while (results.size > MAX_REMEMBERED_COMMANDS_PER_PLAYER) {
      const oldest = results.keys().next().value as string | undefined
      if (!oldest) break
      results.delete(oldest)
    }
    return result
  }
}
