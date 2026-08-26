import { randomBytes, randomUUID } from 'node:crypto'

import { io, type Socket } from 'socket.io-client'

import {
  GAME_PROTOCOL_VERSION,
  type ClientToServerEvents,
  type RoomSnapshot,
  type ServerToClientEvents,
} from '../lib/game-protocol'
import { ROOM_CODE_PATTERN } from '../server/validation'

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>

const gameServerUrl = requiredHttpsEnvironment('GAME_SERVER_URL')
const browserOrigin = requiredHttpsEnvironment('GAME_SERVER_ORIGIN')
const ACK_TIMEOUT_MS = 5_000
const clients: GameClient[] = []

try {
  const healthResponse = await fetch(new URL('/healthz', gameServerUrl), {
    signal: AbortSignal.timeout(ACK_TIMEOUT_MS),
  })
  if (!healthResponse.ok)
    throw new Error(`Health check failed: ${healthResponse.status}`)

  const hostToken = randomBytes(16).toString('hex')
  const host = await connect(hostToken)
  const guest = await connect()
  const created = await host
    .timeout(ACK_TIMEOUT_MS)
    .emitWithAck('room:create', {
      name: 'Smoke host',
    })
  if (created.status !== 'success') throw new Error(created.message)
  const roomCode = created.roomCode

  const hostLobby = nextSnapshot(host, 'lobby')
  const guestLobby = nextSnapshot(guest, 'lobby')
  const joined = await guest.timeout(ACK_TIMEOUT_MS).emitWithAck('room:join', {
    roomCode,
    name: 'Smoke guest',
  })
  if (joined.status !== 'success') throw new Error(joined.message)
  await Promise.all([hostLobby, guestLobby])

  const hostHinting = nextSnapshot(host, 'hinting')
  const guestHinting = nextSnapshot(guest, 'hinting')
  const started = await host
    .timeout(ACK_TIMEOUT_MS)
    .emitWithAck('game:start', { roomCode })
  if (started.status !== 'success') throw new Error(started.message)
  const [hostHintState, guestHintState] = await Promise.all([
    hostHinting,
    guestHinting,
  ])
  const hostTargets = selectableIds(hostHintState, 2)
  const guestTargets = selectableIds(guestHintState, 2)

  for (const [client, hint, targetCardIds] of [
    [host, 'Orbit', hostTargets],
    [guest, 'Garden', guestTargets],
  ] as const) {
    const result = await client
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('game:submit-hint', {
        roomCode,
        hint,
        targetCardIds,
      })
    if (result.status !== 'success') throw new Error(result.message)
  }

  const hostGuessing = nextSnapshot(host, 'guessing')
  const guestGuessing = nextSnapshot(guest, 'guessing')
  const guessingStarted = await host
    .timeout(ACK_TIMEOUT_MS)
    .emitWithAck('game:start-guessing', { roomCode })
  if (guessingStarted.status !== 'success')
    throw new Error(guessingStarted.message)
  const [hostState, guestState] = await Promise.all([
    hostGuessing,
    guestGuessing,
  ])

  const hostScored = nextSnapshot(host, 'guessing')
  const guestScored = nextSnapshot(guest, 'guessing')
  const guestClaim = await guest
    .timeout(ACK_TIMEOUT_MS)
    .emitWithAck('game:claim-card', {
      roomCode,
      commandId: randomUUID(),
      revision: guestState.revision,
      cardId: hostTargets[0]!,
    })
  if (guestClaim.status !== 'success') throw new Error(guestClaim.message)
  const [, afterGuestScore] = await Promise.all([hostScored, guestScored])
  const guestScore = afterGuestScore.scoreboard.find(
    ({ name }) => name === 'Smoke guest',
  )?.score
  if (guestScore !== 1) throw new Error('Guest score did not synchronize.')

  host.disconnect()
  const reconnectedHost = await connect(hostToken)
  const resumed = await reconnectedHost
    .timeout(ACK_TIMEOUT_MS)
    .emitWithAck('session:resume', { roomCode })
  if (resumed.status !== 'success' || resumed.snapshot?.status !== 'guessing') {
    throw new Error('Host could not restore the current snapshot.')
  }
  if (!ROOM_CODE_PATTERN.test(roomCode))
    throw new Error('Invalid room code returned.')

  console.info(
    JSON.stringify({
      status: 'ok',
      health: true,
      wssClients: 2,
      roomCodePatternValid: true,
      initialRevision: hostState.revision,
      finalRevision: resumed.snapshot.revision,
    }),
  )
} finally {
  for (const client of clients) client.disconnect()
}

async function connect(token = randomBytes(16).toString('hex')) {
  const client: GameClient = io(gameServerUrl, {
    auth: { token, protocolVersion: GAME_PROTOCOL_VERSION },
    extraHeaders: { Origin: browserOrigin },
    forceNew: true,
    transports: ['websocket'],
  })
  clients.push(client)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out connecting.')),
      ACK_TIMEOUT_MS,
    )
    client.once('connect', () => {
      clearTimeout(timeout)
      resolve()
    })
    client.once('connect_error', reject)
  })
  return client
}

function nextSnapshot<TStatus extends RoomSnapshot['status']>(
  client: GameClient,
  status: TStatus,
) {
  return new Promise<Extract<RoomSnapshot, { status: TStatus }>>(
    (resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for ${status} snapshot.`)),
        ACK_TIMEOUT_MS,
      )
      const handler = (snapshot: RoomSnapshot) => {
        if (snapshot.status !== status) return
        clearTimeout(timeout)
        client.off('room:snapshot', handler)
        resolve(snapshot as Extract<RoomSnapshot, { status: TStatus }>)
      }
      client.on('room:snapshot', handler)
    },
  )
}

function selectableIds(
  snapshot: Extract<RoomSnapshot, { status: 'hinting' }>,
  count: number,
) {
  return (
    snapshot.board
      ?.filter(({ kind }) => kind === 'neutral')
      .slice(0, count)
      .map(({ id }) => id) ?? []
  )
}

function requiredHttpsEnvironment(
  name: 'GAME_SERVER_URL' | 'GAME_SERVER_ORIGIN',
) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Set ${name} before running the smoke test.`)
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`)
  return value
}
