import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createGameSocketServer, SlidingWindowRateLimiter } from './protocol'
import { isPrivateNetworkOrigin } from './origins'
import { parseTrustedProxies } from './proxy-trust'
import { parseLeaveIntentForm } from './validation'

export function startGameServer(
  options: {
    port?: number
    host?: string
    allowedOrigins?: string[]
    allowPrivateNetworkOrigins?: boolean
    trustedProxyAddresses?: string[]
    trustDigitalOceanProxy?: boolean
  } = {},
) {
  const port = validatePort(options.port ?? parseEnvPort(process.env.PORT))
  const host = options.host ?? process.env.HOST ?? '127.0.0.1'
  const allowedOrigins =
    options.allowedOrigins ?? parseAllowedOrigins(process.env.ALLOWED_ORIGINS)
  const allowPrivateNetworkOrigins =
    options.allowPrivateNetworkOrigins ??
    parseAllowPrivateNetworkOrigins(
      process.env.ALLOW_PRIVATE_NETWORK_ORIGINS,
      process.env.NODE_ENV,
    )
  const logger = createStructuredLogger(process.env.LOG_LEVEL)
  const isOriginAllowed = (origin: string | undefined) =>
    origin === undefined ||
    allowedOrigins.includes(origin) ||
    (allowPrivateNetworkOrigins && isPrivateNetworkOrigin(origin))
  const trustedProxyAddresses =
    options.trustedProxyAddresses ??
    (process.env.TRUSTED_PROXIES === undefined
      ? undefined
      : parseTrustedProxies(process.env.TRUSTED_PROXIES, (entry) => {
          logger.warn(JSON.stringify({ event: 'invalid_trusted_proxy', entry }))
        }))

  const socketServerRef: {
    current?: ReturnType<typeof createGameSocketServer>
  } = {}
  const leaveIntentCommands = new SlidingWindowRateLimiter(20, 10_000)
  const httpServer = createServer((request, response) => {
    let pathname = ''
    if (request.url) {
      try {
        pathname = new URL(request.url, 'http://localhost').pathname
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'bad_request' }))
        return
      }
    }
    if (request.method === 'GET' && pathname === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (request.method === 'POST' && pathname === '/leave-intent') {
      if (!isOriginAllowed(request.headers.origin)) {
        response.writeHead(403, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ status: 'forbidden' }))
        return
      }
      void readRequestBody(request, 16 * 1_024).then(
        (body) => {
          const intent = parseLeaveIntentForm(body)
          const activeSocketServer = socketServerRef.current
          if (!intent || !activeSocketServer) {
            response.writeHead(intent ? 503 : 400, {
              'content-type': 'application/json',
            })
            response.end(
              JSON.stringify({
                status: intent ? 'server_unavailable' : 'invalid',
              }),
            )
            return
          }
          if (!leaveIntentCommands.take(intent.token, Date.now())) {
            response.writeHead(429, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ status: 'rate_limited' }))
            return
          }
          response.writeHead(202, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ status: 'accepted' }))
          void activeSocketServer
            .receiveLeaveIntent(intent.token, intent.roomCodes, intent.socketId)
            .catch((error: unknown) => {
              logger.error(
                JSON.stringify({
                  event: 'leave_intent_failed',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                }),
              )
            })
        },
        () => {
          response.writeHead(413, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ status: 'too_large' }))
        },
      )
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'not_found' }))
  })
  const activeSocketServer = createGameSocketServer(httpServer, {
    allowedOrigins,
    allowPrivateNetworkOrigins,
    trustDigitalOceanProxy:
      options.trustDigitalOceanProxy ??
      process.env.TRUST_DIGITALOCEAN_PROXY?.trim().toLowerCase() === 'true',
    ...(trustedProxyAddresses !== undefined ? { trustedProxyAddresses } : {}),
    logger,
  })
  socketServerRef.current = activeSocketServer

  httpServer.on('error', (error) => {
    logger.error(
      JSON.stringify({
        event: 'game_server_error',
        host,
        port,
        message: error.message,
        code: 'code' in error ? error.code : undefined,
      }),
    )
    if (isMain) {
      process.exitCode = 1
      void stop().catch((stopError: unknown) => {
        logger.error(
          JSON.stringify({
            event: 'game_server_stop_failed',
            message:
              stopError instanceof Error
                ? stopError.message
                : 'Unknown shutdown error',
          }),
        )
      })
    }
  })
  httpServer.listen(port, host, () => {
    const address = httpServer.address()
    logger.info(
      JSON.stringify({
        event: 'game_server_started',
        host,
        port:
          typeof address === 'object' && address !== null ? address.port : port,
      }),
    )
  })

  let stopPromise: Promise<void> | undefined
  function stop() {
    stopPromise ??= (async () => {
      await activeSocketServer.shutdown()
      if (httpServer.listening) {
        await new Promise<void>((resolveClose, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolveClose())),
        )
      }
    })()
    return stopPromise
  }

  return { httpServer, ...activeSocketServer, stop }
}

function readRequestBody(
  request: import('node:http').IncomingMessage,
  maxBytes: number,
) {
  return new Promise<string>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > maxBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) rejectBody(new Error('Request body is too large.'))
      else resolveBody(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', rejectBody)
  })
}

export function parseEnvPort(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? Number(normalized) : 3200
}

export function parseAllowPrivateNetworkOrigins(
  value: string | undefined,
  nodeEnv: string | undefined,
) {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return nodeEnv === 'development'
}

function validatePort(port: number) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid game-server port: ${String(port)}`)
  }
  return port
}

function parseAllowedOrigins(value: string | undefined) {
  const origins = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return origins?.length
    ? origins
    : ['http://localhost:3000', 'http://127.0.0.1:3000']
}

function createStructuredLogger(value: string | undefined) {
  const configuredLevel =
    value === 'error' || value === 'warn' || value === 'info' ? value : 'info'
  const priority = { error: 0, warn: 1, info: 2 } as const

  return {
    info(message: string) {
      if (priority[configuredLevel] >= priority.info) console.info(message)
    },
    warn(message: string) {
      if (priority[configuredLevel] >= priority.warn) console.warn(message)
    },
    error(message: string) {
      console.error(message)
    },
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  const server = startGameServer()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void server.stop().then(
        () => process.exit(0),
        () => process.exit(1),
      )
    })
  }
}
