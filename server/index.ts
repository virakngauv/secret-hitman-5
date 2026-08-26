import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createGameSocketServer } from './protocol'
import { parseTrustedProxies } from './proxy-trust'

export function startGameServer(
  options: {
    port?: number
    host?: string
    allowedOrigins?: string[]
    allowPrivateNetworkOrigins?: boolean
    trustedProxyAddresses?: string[]
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
  const trustedProxyAddresses =
    options.trustedProxyAddresses ??
    parseTrustedProxies(process.env.TRUSTED_PROXIES)
  const logger = createStructuredLogger(process.env.LOG_LEVEL)

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
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'not_found' }))
  })
  const socketServer = createGameSocketServer(httpServer, {
    allowedOrigins,
    allowPrivateNetworkOrigins,
    ...(trustedProxyAddresses.length ? { trustedProxyAddresses } : {}),
    logger,
  })

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
      await socketServer.shutdown()
      if (httpServer.listening) {
        await new Promise<void>((resolveClose, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolveClose())),
        )
      }
    })()
    return stopPromise
  }

  return { httpServer, ...socketServer, stop }
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
  return nodeEnv !== 'production'
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
