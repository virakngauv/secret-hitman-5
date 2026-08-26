import { request } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  parseAllowPrivateNetworkOrigins,
  parseEnvPort,
  startGameServer,
} from './index'

describe('game server HTTP process', () => {
  let server: ReturnType<typeof startGameServer> | null = null
  let secondServer: ReturnType<typeof startGameServer> | null = null

  afterEach(async () => {
    await Promise.all([server?.stop(), secondServer?.stop()])
    server = null
    secondServer = null
    vi.restoreAllMocks()
  })

  it('reports process health without exposing room or player state', async () => {
    server = startGameServer({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['http://localhost:3100'],
    })
    await new Promise<void>((resolve) =>
      server?.httpServer.once('listening', resolve),
    )
    const address = server.httpServer.address() as AddressInfo
    const response = await fetch(
      `http://127.0.0.1:${address.port}/healthz?probe=1`,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('does not trust an invalid Host header when parsing health probes', async () => {
    server = startGameServer({ port: 0, host: '127.0.0.1' })
    await new Promise<void>((resolve) =>
      server?.httpServer.once('listening', resolve),
    )
    const address = server.httpServer.address() as AddressInfo

    const statusCode = await new Promise<number | undefined>(
      (resolve, reject) => {
        const probe = request(
          {
            host: '127.0.0.1',
            port: address.port,
            path: '/healthz?probe=1',
            headers: { host: '[invalid' },
          },
          (response) => {
            response.resume()
            response.once('end', () => resolve(response.statusCode))
          },
        )
        probe.once('error', reject)
        probe.end()
      },
    )

    expect(statusCode).toBe(200)
  })

  it('rejects an invalid listen port before starting', () => {
    expect(() => startGameServer({ port: Number.NaN })).toThrow(
      'Invalid game-server port: NaN',
    )
  })

  it('uses the default port for blank environment values', () => {
    expect(parseEnvPort(undefined)).toBe(3200)
    expect(parseEnvPort('')).toBe(3200)
    expect(parseEnvPort('   ')).toBe(3200)
    expect(parseEnvPort(' 3201 ')).toBe(3201)
  })

  it('allows private-network origins outside production unless overridden', () => {
    expect(parseAllowPrivateNetworkOrigins(undefined, undefined)).toBe(true)
    expect(parseAllowPrivateNetworkOrigins(undefined, 'development')).toBe(true)
    expect(parseAllowPrivateNetworkOrigins(undefined, 'production')).toBe(false)
    expect(parseAllowPrivateNetworkOrigins(' true ', 'production')).toBe(true)
    expect(parseAllowPrivateNetworkOrigins('false', undefined)).toBe(false)
    expect(parseAllowPrivateNetworkOrigins('garbage', 'production')).toBe(false)
  })

  it('logs a structured error when the listen port is already occupied', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    server = startGameServer({ port: 0, host: '127.0.0.1' })
    await new Promise<void>((resolve) =>
      server?.httpServer.once('listening', resolve),
    )
    const address = server.httpServer.address() as AddressInfo

    secondServer = startGameServer({
      port: address.port,
      host: '127.0.0.1',
    })
    await new Promise<void>((resolve) =>
      secondServer?.httpServer.once('error', () => resolve()),
    )

    expect(errorSpy).toHaveBeenCalledOnce()
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toMatchObject({
      event: 'game_server_error',
      host: '127.0.0.1',
      port: address.port,
      code: 'EADDRINUSE',
    })
  })

  it('shares in-progress shutdown work across concurrent callers', async () => {
    server = startGameServer({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['http://localhost:3100'],
    })
    await new Promise<void>((resolve) =>
      server?.httpServer.once('listening', resolve),
    )

    const firstStop = server.stop()
    const secondStop = server.stop()

    expect(secondStop).toBe(firstStop)
    await Promise.all([firstStop, secondStop])
    expect(server.httpServer.listening).toBe(false)
    server = null
  })
})
