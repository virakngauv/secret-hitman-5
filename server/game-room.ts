import { randomUUID } from 'node:crypto'

import {
  CARD_SCORE,
  MAX_TARGET_COUNT,
  MAX_STARTING_PLAYERS,
  MIN_TARGET_COUNT,
  type AdvanceTurnPayload,
  type CardKind,
  type ClaimCardPayload,
  type CommandFailure,
  type CommandResult,
  type FinishGuessingPayload,
  type GameCommandPayload,
  type Participation,
  type PlayerIdentity,
  type PlayerRole,
  type RejectHintPayload,
  type RoomPhase,
  type RoomSnapshot,
  type ScoreboardEntry,
  type SubmitHintPayload,
  type TurnActivitySnapshot,
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
const KICKED_PLAYER_NAME = 'xxxx'

type Member = {
  playerId: string
  token: string
  name: string
  role: PlayerRole
  participation: Participation
  joinedAt: number
  active: boolean
  departedGame: boolean
  kicked: boolean
  lobbyNotice?: 'player_left'
  game: GameSeat | null
}

type GameSeat = {
  position: number
  score: number
  board: GameCard[]
  hint: string | null
  targetCount: number
  hintSubmitted: boolean
  hintRejected: boolean
  turnState: 'waiting' | 'guessing' | 'done'
}

type GameState = {
  gameId: string
  boardSeed: string
  nextBoardIndex: number
  playerOrder: string[]
  turnIndex: number
  turnId: string
  turnCompleted: boolean
  latestActivity:
    (Omit<TurnActivitySnapshot, 'message'> & { playerId: string }) | null
}

export type GameRoomOptions = {
  now?: number
  createPlayerId?: () => string
  seed?: string
}

export class GameRoom {
  readonly code: string
  phase: RoomPhase = 'lobby'
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
    // Guessing players keep their established seats while inactive. Spectators
    // and hinting leavers use only remaining capacity when they return.
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
      if (existing.departedGame) existing.participation = 'spectator'
      if (
        !existing.game &&
        this.phase === 'hinting' &&
        this.gamePlayers().length < MAX_STARTING_PLAYERS
      ) {
        this.addGameSeat(existing)
      } else if (!existing.game && this.phase !== 'lobby') {
        existing.participation = 'spectator'
      }
    } else {
      const member = this.createMember(token, name, 'player', now)
      if (
        this.phase === 'hinting' &&
        this.gamePlayers().length < MAX_STARTING_PLAYERS
      ) {
        this.addGameSeat(member)
      } else if (this.phase !== 'lobby') {
        member.participation = 'spectator'
      }
      this.members.push(member)
    }

    this.touch(now)
    return { status: 'success' }
  }

  leave(token: string, now = Date.now()): CommandResult {
    const member = this.findActiveMember(token)
    if (!member) return { status: 'success' }

    const wasHost = member.role === 'host'
    member.active = false
    if (wasHost) {
      member.role = 'player'
      const successor = this.hostSuccessor()
      if (successor) successor.role = 'host'
    }

    if (this.phase === 'lobby') {
      const index = this.members.indexOf(member)
      if (index >= 0) this.members.splice(index, 1)
    } else if (member.game) {
      if (this.phase === 'hinting') {
        this.removeGameSeat(member)
        if (this.gamePlayers().length < MIN_STARTING_PLAYERS) {
          this.resetRoundToLobby('player_left')
        }
      }
      if (this.phase === 'guessing') this.departGuessingPlayer(member)
    }

    this.commandResults.delete(token)
    this.touch(now)
    return { status: 'success' }
  }

  removePlayer(
    token: string,
    playerId: string,
    allowRoundReset = false,
    now = Date.now(),
  ): CommandResult<{ removedToken: string }> {
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can remove a player.',
      }
    }
    if (
      this.phase !== 'lobby' &&
      this.phase !== 'hinting' &&
      this.phase !== 'guessing'
    ) {
      return {
        status: 'invalid',
        message: 'Players cannot be removed after the game finishes.',
      }
    }

    const target = this.members.find(
      (member) =>
        member.playerId === playerId &&
        (this.phase === 'lobby' ? member.active : member.game !== null) &&
        !this.isRemovedToken(member.token),
    )
    if (!target) {
      return {
        status: 'stale',
        message: 'That player is no longer available to remove.',
      }
    }
    if (target === actor || target.role === 'host') {
      return {
        status: 'forbidden',
        message: 'The host cannot be removed from the room.',
      }
    }
    const roundReset =
      this.phase === 'hinting' &&
      this.gamePlayers().length <= MIN_STARTING_PLAYERS
    if (roundReset && !allowRoundReset) {
      return {
        status: 'invalid',
        message:
          'Removing this player ends the current round. Confirm the removal again to return everyone to the lobby.',
      }
    }

    this.removedTokenFingerprints.add(fingerprintClientToken(target.token))
    target.kicked = true
    this.commandResults.delete(target.token)
    if (this.phase === 'guessing') {
      this.departGuessingPlayer(target)
      this.touch(now)
      return { status: 'success', removedToken: target.token }
    }
    if (target.game) this.removeGameSeat(target)
    this.members.splice(this.members.indexOf(target), 1)
    if (roundReset) this.resetRoundToLobby()
    this.touch(now)
    return { status: 'success', removedToken: target.token }
  }

  private resetRoundToLobby(lobbyNotice?: Member['lobbyNotice']) {
    this.phase = 'lobby'
    this.game = null
    for (const member of this.members) {
      member.participation = 'player'
      member.departedGame = false
      member.lobbyNotice = member.active ? lobbyNotice : undefined
      member.game = null
    }
    this.commandResults.clear()
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

    const gameId = randomUUID()
    const seed = `${this.initialSeed}:${now}`
    players.forEach((member, position) => {
      member.participation = 'player'
      member.lobbyNotice = undefined
      member.game = {
        position,
        score: 0,
        board: createPlayerBoard(seed, position),
        hint: null,
        targetCount: 0,
        hintSubmitted: false,
        hintRejected: false,
        turnState: 'waiting',
      }
    })
    this.game = {
      gameId,
      boardSeed: seed,
      nextBoardIndex: players.length,
      playerOrder: players.map(({ playerId }) => playerId),
      turnIndex: 0,
      turnId: randomUUID(),
      turnCompleted: false,
      latestActivity: null,
    }
    this.phase = 'hinting'
    this.commandResults.clear()
    this.touch(now)
    return { status: 'success' }
  }

  submitHint(
    token: string,
    payload: SubmitHintPayload,
    now = Date.now(),
  ): CommandResult {
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
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
      seat.board.filter(({ locked }) => !locked).map(({ id }) => id),
    )
    if (
      targetIds.size !== payload.targetCardIds.length ||
      targetIds.size < MIN_TARGET_COUNT ||
      targetIds.size > MAX_TARGET_COUNT ||
      [...targetIds].some((cardId) => !selectableIds.has(cardId)) ||
      seat.board.some(({ id, locked }) => locked && targetIds.has(id))
    ) {
      return {
        status: 'invalid',
        message:
          'Select one to five editable words and leave locked civilians and the assassin unchanged.',
      }
    }

    applyTargets(seat.board, payload.targetCardIds)
    seat.hint = payload.hint
    seat.targetCount = targetIds.size
    seat.hintSubmitted = true
    seat.hintRejected = false
    this.touch(now)
    return { status: 'success' }
  }

  unlockHint(
    token: string,
    payload: GameCommandPayload,
    now = Date.now(),
  ): CommandResult {
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
    const member = this.findActiveMember(token)
    const seat = member?.game
    if (!member || !seat || this.phase !== 'hinting') {
      return {
        status: 'forbidden',
        message:
          'Only starting players can unlock a hint during clue creation.',
      }
    }
    if (!seat.hintSubmitted) {
      return { status: 'invalid', message: 'Your hint is already editable.' }
    }

    seat.hintSubmitted = false
    seat.hintRejected = false
    this.touch(now)
    return { status: 'success' }
  }

  rejectHint(
    token: string,
    payload: RejectHintPayload,
    now = Date.now(),
  ): CommandResult {
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can reject a hint.',
      }
    }
    if (this.phase !== 'hinting') {
      return {
        status: 'invalid',
        message: 'Hints can only be rejected during clue creation.',
      }
    }

    const target = this.members.find(
      (member) =>
        member.playerId === payload.playerId &&
        member.game !== null &&
        member.active,
    )
    if (!target) {
      return { status: 'stale', message: 'That hint is no longer available.' }
    }
    if (target === actor) {
      return {
        status: 'forbidden',
        message: 'Unlock your own hint to revise it.',
      }
    }
    if (!target.game?.hintSubmitted) {
      return {
        status: 'stale',
        message: 'That player does not have a submitted hint to reject.',
      }
    }

    const game = this.requireGame()
    const boardIndex = game.nextBoardIndex
    game.nextBoardIndex += 1
    target.game.board = createPlayerBoard(game.boardSeed, boardIndex)
    target.game.hint = null
    target.game.targetCount = 0
    target.game.hintSubmitted = false
    target.game.hintRejected = true
    this.touch(now)
    return { status: 'success' }
  }

  startGuessing(
    token: string,
    payload: GameCommandPayload,
    now = Date.now(),
  ): CommandResult {
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
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
    if (this.gamePlayers().length < MIN_STARTING_PLAYERS) {
      return {
        status: 'invalid',
        message: `At least ${MIN_STARTING_PLAYERS} players are required to start guessing.`,
      }
    }

    this.phase = 'guessing'
    this.requireGame().turnIndex = 0
    this.prepareCurrentTurn()
    this.touch(now)
    return { status: 'success' }
  }

  claimCard(
    token: string,
    payload: ClaimCardPayload,
    now = Date.now(),
  ): CommandResult<{ kind: CardKind }> {
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
    const member = this.findActiveMember(token)
    const seat = member?.game
    if (!member || !seat || this.phase !== 'guessing') {
      return { status: 'forbidden', message: 'You cannot guess on this turn.' }
    }
    if (payload.turnId !== this.requireGame().turnId) {
      return {
        status: 'stale',
        message: 'That guessing turn is no longer current.',
      }
    }
    const previous = this.commandResults.get(token)?.get(payload.commandId)
    if (previous) return previous

    if (this.requireGame().turnCompleted) {
      return { status: 'forbidden', message: 'This board is already complete.' }
    }

    const clueGiver = this.currentClueGiver()
    if (
      member.playerId === clueGiver.playerId ||
      seat.turnState !== 'guessing'
    ) {
      return { status: 'forbidden', message: 'You cannot guess on this turn.' }
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
    if (card.claimers.length > 0) {
      return this.remember(token, payload.commandId, {
        status: 'already_claimed',
        message: 'Another player already claimed that card.',
      })
    }

    card.claimers.push({ playerId: member.playerId, name: member.name })
    const scoreDelta = CARD_SCORE[card.kind]
    seat.score += scoreDelta
    if (clueGiver.game) clueGiver.game.score += scoreDelta

    if (card.kind === 'civilian') {
      seat.turnState = 'done'
    } else if (card.kind === 'assassin') {
      this.completeCurrentTurn()
    }

    if (this.allTargetsClaimed()) {
      this.completeCurrentTurn()
    }

    this.requireGame().latestActivity = {
      type: card.kind,
      playerId: member.playerId,
      playerName: member.name,
      word: card.word,
    }

    this.touch(now)
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
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
    const member = this.findActiveMember(token)
    if (!member?.game || this.phase !== 'guessing') {
      return { status: 'forbidden', message: 'You are not an active guesser.' }
    }
    const clueGiver = this.currentClueGiver()
    if (member.playerId === clueGiver.playerId) {
      return { status: 'forbidden', message: 'You are not an active guesser.' }
    }
    if (payload.turnId !== this.requireGame().turnId) {
      return {
        status: 'stale',
        message: 'That guessing turn is no longer current.',
      }
    }
    // Passing has no scoring effect: reaching the same finished state is
    // already a success, without extending room life.
    if (member.game.turnState === 'done') return { status: 'success' }
    member.game.turnState = 'done'
    this.requireGame().latestActivity = {
      type: 'pass',
      playerId: member.playerId,
      playerName: member.name,
      word: null,
    }
    this.touch(now)
    return { status: 'success' }
  }

  advanceTurn(
    token: string,
    payload: AdvanceTurnPayload,
    now = Date.now(),
  ): CommandResult {
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
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
    if (payload.turnId !== this.requireGame().turnId) {
      return {
        status: 'stale',
        message: 'That guessing turn is no longer current.',
      }
    }
    const game = this.requireGame()
    if (game.turnIndex >= game.playerOrder.length - 1) {
      return {
        status: 'invalid',
        message: 'Use View scoreboard after the final turn.',
      }
    }
    const currentClueGiver = this.currentClueGiver()
    if (currentClueGiver.departedGame) {
      game.playerOrder.splice(game.turnIndex, 1)
    } else {
      game.turnIndex += 1
    }
    game.turnId = randomUUID()
    game.turnCompleted = false
    game.latestActivity = null
    this.prepareCurrentTurn()
    this.commandResults.clear()
    this.touch(now)
    return { status: 'success' }
  }

  showScoreboard(
    token: string,
    payload: AdvanceTurnPayload,
    now = Date.now(),
  ): CommandResult {
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can show the scoreboard.',
      }
    }
    if (this.phase !== 'guessing' || !this.isFinalTurn()) {
      return {
        status: 'invalid',
        message: 'The scoreboard is available only after the final turn.',
      }
    }
    if (payload.turnId !== this.requireGame().turnId) {
      return {
        status: 'stale',
        message: 'That guessing turn is no longer current.',
      }
    }
    this.phase = 'finished'
    this.commandResults.clear()
    this.touch(now)
    return { status: 'success' }
  }

  returnToLobby(
    token: string,
    payload: GameCommandPayload,
    now = Date.now(),
  ): CommandResult {
    const actor = this.findActiveMember(token)
    if (!actor || actor.role !== 'host') {
      return {
        status: 'forbidden',
        message: 'Only the host can return the room to the lobby.',
      }
    }
    if (this.phase === 'lobby') return { status: 'success' }
    if (!this.isCurrentGame(payload.gameId)) return this.staleGame()
    if (this.phase !== 'finished') {
      return {
        status: 'invalid',
        message: 'The room can return to the lobby only from final results.',
      }
    }

    for (const member of this.members) {
      member.participation = 'player'
      member.departedGame = false
      member.game = null
    }
    this.game = null
    this.phase = 'lobby'
    this.commandResults.clear()
    this.touch(now)
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
        joinsAsSpectator:
          !this.findMember(token)?.game &&
          this.phase !== 'lobby' &&
          (this.phase !== 'hinting' ||
            this.gamePlayers().length >= MAX_STARTING_PLAYERS),
      }
    }

    const base = {
      roomCode: this.code,
      player: this.identity(member),
      members: this.activeMembers().map((candidate) =>
        this.identity(candidate),
      ),
    }

    if (this.phase === 'lobby') {
      return {
        status: 'lobby',
        minimumPlayers: MIN_STARTING_PLAYERS,
        ...(member.lobbyNotice ? { lobbyNotice: member.lobbyNotice } : {}),
        ...base,
      }
    }

    if (this.phase === 'hinting') {
      const allHintsSubmitted = this.allHintsSubmitted()
      return {
        status: 'hinting',
        gameId: this.requireGame().gameId,
        ...base,
        hintStatuses: this.gamePlayers().map((player) => {
          const seat = player.game
          return {
            playerId: player.playerId,
            name: player.name,
            submitted: seat?.hintSubmitted ?? false,
            needsRevision: seat?.hintRejected ?? false,
            hint: seat?.hintSubmitted ? (seat.hint ?? null) : null,
            hintNumber: seat?.hintSubmitted ? seat.targetCount : null,
          }
        }),
        allHintsSubmitted,
        board:
          member.game?.board.map(({ id, word, kind, locked }) => ({
            id,
            word,
            kind:
              locked || member.game?.hintSubmitted || kind === 'target'
                ? kind
                : 'neutral',
            locked,
          })) ?? null,
        hint: member.game?.hint ?? null,
        hintSubmitted: member.game?.hintSubmitted ?? false,
        hintRejected: member.game?.hintRejected ?? false,
      }
    }

    if (this.phase === 'finished') {
      const scoreboard = this.scoreboard()
      const playerScores = scoreboard.filter(
        (entry): entry is ScoreboardEntry & { score: number } =>
          entry.participation === 'player' && entry.score !== null,
      )
      const winningScore =
        playerScores.length > 0
          ? Math.max(...playerScores.map(({ score }) => score))
          : null
      return {
        status: 'finished',
        gameId: this.requireGame().gameId,
        ...base,
        scoreboard,
        winners:
          winningScore === null
            ? []
            : playerScores.filter(({ score }) => score === winningScore),
      }
    }

    const clueGiver = this.currentClueGiver()
    const clueSeat = clueGiver.game
    if (!clueSeat?.hint)
      throw new Error('Current clue giver is missing a hint.')
    const turnSettled = this.isCurrentTurnSettled()
    const finalTurnReview = this.isFinalTurn() && turnSettled
    const revealAll =
      turnSettled ||
      (!member.departedGame &&
        (member === clueGiver || member.game?.turnState === 'done'))
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
        !member.departedGame &&
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
                .map(({ playerId, name }) =>
                  this.publicPlayerName(playerId, name),
                )
            : card.claimers.map(({ playerId, name }) =>
                this.publicPlayerName(playerId, name),
              ),
        selectedByYou,
        disabled:
          !canGuess ||
          selectedByYou ||
          (card.kind !== 'assassin' && card.claimers.length > 0),
      }
    })

    return {
      status: 'guessing',
      gameId: this.requireGame().gameId,
      turnId: this.requireGame().turnId,
      isFinalTurn: this.isFinalTurn(),
      ...base,
      turnNumber: this.requireGame().turnIndex + 1,
      totalTurns: this.requireGame().playerOrder.length,
      clueGiverId: clueGiver.playerId,
      clueGiverName: this.publicPlayerName(clueGiver.playerId, clueGiver.name),
      hint: clueSeat.hint,
      hintNumber: clueSeat.targetCount,
      boardCompleted: this.requireGame().turnCompleted || finalTurnReview,
      turnSettled,
      board,
      turnPlayers: this.gamePlayers().map((player) => ({
        playerId: player.playerId,
        name: this.publicPlayerName(player.playerId, player.name),
        state:
          player === clueGiver
            ? 'clue-giver'
            : player.game?.turnState === 'done'
              ? 'done'
              : 'guessing',
      })),
      latestActivity: this.turnActivitySnapshot(),
      unfinishedPickerCount: this.activeGuesserCount(),
      scoreboard: this.scoreboard(),
      canGuess:
        Boolean(member.game) &&
        !member.departedGame &&
        member !== clueGiver &&
        member.game?.turnState === 'guessing',
      canMarkDone:
        Boolean(member.game) &&
        !member.departedGame &&
        member !== clueGiver &&
        member.game?.turnState === 'guessing',
      canAdvanceTurn: member.role === 'host' && !this.isFinalTurn(),
      canViewScoreboard: member.role === 'host' && this.isFinalTurn(),
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
      departedGame: false,
      kicked: false,
      lobbyNotice: undefined,
      game: null,
    }
  }

  private addGameSeat(member: Member) {
    const game = this.requireGame()
    const position = game.playerOrder.length
    const boardIndex = game.nextBoardIndex
    game.nextBoardIndex += 1
    member.participation = 'player'
    member.departedGame = false
    member.game = {
      position,
      score: 0,
      board: createPlayerBoard(game.boardSeed, boardIndex),
      hint: null,
      targetCount: 0,
      hintSubmitted: false,
      hintRejected: false,
      turnState: 'waiting',
    }
    game.playerOrder.push(member.playerId)
  }

  private removeGameSeat(member: Member) {
    const game = this.requireGame()
    game.playerOrder = game.playerOrder.filter(
      (candidate) => candidate !== member.playerId,
    )
    member.game = null
    member.participation = 'spectator'
    this.reindexGameSeats()
  }

  private reindexGameSeats() {
    for (const [position, player] of this.gamePlayers().entries()) {
      if (player.game) player.game.position = position
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
    const players: ScoreboardEntry[] = this.gamePlayers()
      .filter(({ kicked }) => !kicked)
      .map((member) => ({
        ...this.identity(member),
        participation: 'player',
        position: member.game?.position ?? null,
        score: member.game?.score ?? null,
      }))
    const spectators: ScoreboardEntry[] = this.activeMembers()
      .filter(
        ({ participation, game }) =>
          participation === 'spectator' && game === null,
      )
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
    const clueGiver = this.currentClueGiver()
    for (const player of this.gamePlayers()) {
      if (!player.game) continue
      player.game.turnState =
        player === clueGiver || !player.active || player.departedGame
          ? 'done'
          : 'guessing'
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
        !player.departedGame &&
        player !== clueGiver &&
        player.game?.turnState === 'guessing',
    )
  }

  private isCurrentTurnSettled() {
    return !this.hasActiveGuessers()
  }

  private activeGuesserCount() {
    const clueGiver = this.currentClueGiver()
    return this.gamePlayers().filter(
      (player) =>
        player.active &&
        !player.departedGame &&
        player !== clueGiver &&
        player.game?.turnState === 'guessing',
    ).length
  }

  private turnActivitySnapshot(): TurnActivitySnapshot | null {
    const activity = this.requireGame().latestActivity
    if (!activity) return null

    const { playerId, ...publicActivity } = activity
    const playerName = this.publicPlayerName(playerId, activity.playerName)

    const next = this.isCurrentTurnSettled()
      ? 'The host can move on.'
      : 'Waiting for the other players to finish guessing.'
    const quotedWord = activity.word ? ` “${activity.word}”` : ''
    const message =
      activity.type === 'target'
        ? this.requireGame().turnCompleted
          ? `${playerName} found target${quotedWord}. The board is complete. ${next}`
          : `${playerName} found target${quotedWord} and may keep guessing.`
        : activity.type === 'civilian'
          ? `${playerName} found civilian${quotedWord} and is done guessing. ${next}`
          : activity.type === 'assassin'
            ? `${playerName} found assassin${quotedWord}. The board is complete. ${next}`
            : `${playerName} passed and is done guessing. ${next}`

    return { ...publicActivity, playerName, message }
  }

  private publicPlayerName(playerId: string, fallback: string) {
    return this.members.find((member) => member.playerId === playerId)?.kicked
      ? KICKED_PLAYER_NAME
      : fallback
  }

  private allTargetsClaimed() {
    const board = this.currentClueGiver().game?.board ?? []
    const targets = board.filter(({ kind }) => kind === 'target')
    return (
      targets.length > 0 && targets.every(({ claimers }) => claimers.length > 0)
    )
  }

  private completeCurrentTurn() {
    this.requireGame().turnCompleted = true
    const clueGiver = this.currentClueGiver()
    for (const player of this.gamePlayers()) {
      if (player !== clueGiver && player.game) player.game.turnState = 'done'
    }
  }

  private isFinalTurn() {
    const game = this.requireGame()
    return game.turnIndex === game.playerOrder.length - 1
  }

  private hostSuccessor() {
    const active = this.activeMembers()
    return (
      active.find(({ participation }) => participation === 'player') ??
      active[0]
    )
  }

  private departGuessingPlayer(member: Member) {
    member.active = false
    member.departedGame = true
    member.participation = 'spectator'
    if (member.game) member.game.turnState = 'done'

    const game = this.requireGame()
    const playerIndex = game.playerOrder.indexOf(member.playerId)
    if (playerIndex > game.turnIndex) {
      game.playerOrder.splice(playerIndex, 1)
    }
  }

  private isCurrentGame(gameId: string) {
    return this.game?.gameId === gameId
  }

  private staleGame(): CommandFailure {
    return {
      status: 'stale',
      message: 'That command belongs to a previous game.',
    }
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
