import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setImmediate } from 'node:timers/promises'

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
    vi.unstubAllEnvs()
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

  it('accepts valid leave-intent beacons only from allowed origins', async () => {
    server = startGameServer({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['http://localhost:3100'],
    })
    await new Promise<void>((resolve) =>
      server?.httpServer.once('listening', resolve),
    )
    const address = server.httpServer.address() as AddressInfo
    const endpoint = `http://127.0.0.1:${address.port}/leave-intent`
    const body = new URLSearchParams({
      token: 'a'.repeat(32),
      socketId: 'socket-1',
      roomCode: 'bcdf2',
    })

    const accepted = await fetch(endpoint, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3100' },
      body,
    })
    expect(accepted.status).toBe(202)
    await expect(accepted.json()).resolves.toEqual({ status: 'accepted' })

    const forbidden = await fetch(endpoint, {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example' },
      body,
    })
    expect(forbidden.status).toBe(403)
  })

  it('rate limits leave intents per token before enumerating sockets', async () => {
    server = startGameServer({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['http://localhost:3100'],
    })
    await new Promise<void>((resolve) =>
      server?.httpServer.once('listening', resolve),
    )
    const address = server.httpServer.address() as AddressInfo
    const token = 'a'.repeat(32)
    const created = server.gameServer.createRoom(token, 'Ada')
    if (created.status !== 'success') throw new Error('Expected a room.')
    const endpoint = `http://127.0.0.1:${address.port}/leave-intent`
    const body = new URLSearchParams({
      token,
      socketId: 'socket-1',
      roomCode: created.roomCode,
    })
    const fetchSockets = vi
      .spyOn(server.io, 'fetchSockets')
      .mockResolvedValue([])

    for (let requestNumber = 0; requestNumber < 20; requestNumber += 1) {
      const accepted = await fetch(endpoint, {
        method: 'POST',
        headers: { Origin: 'http://localhost:3100' },
        body,
      })
      expect(accepted.status).toBe(202)
    }
    await vi.waitFor(() => expect(fetchSockets).toHaveBeenCalledTimes(20))

    const blocked = await fetch(endpoint, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3100' },
      body,
    })
    expect(blocked.status).toBe(429)
    await expect(blocked.json()).resolves.toEqual({ status: 'rate_limited' })
    await setImmediate()
    expect(fetchSockets).toHaveBeenCalledTimes(20)
  })

  it('drains an oversized leave intent before returning JSON 413', async () => {
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
      `http://127.0.0.1:${address.port}/leave-intent`,
      {
        method: 'POST',
        headers: { Origin: 'http://localhost:3100' },
        body: 'x'.repeat(16 * 1_024 + 1),
      },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ status: 'too_large' })
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

  it('logs rejected trusted-proxy configuration at startup', async () => {
    vi.stubEnv('TRUSTED_PROXIES', '10.0.0.0/8, fe80::/64, not-an-ip')
    vi.stubEnv('LOG_LEVEL', 'warn')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    server = startGameServer({ port: 0, host: '127.0.0.1' })
    await new Promise<void>((resolve) =>
      server?.httpServer.once('listening', resolve),
    )

    expect(
      warnSpy.mock.calls.map(([message]) => JSON.parse(message as string)),
    ).toEqual([
      { event: 'invalid_trusted_proxy', entry: 'fe80::/64' },
      { event: 'invalid_trusted_proxy', entry: 'not-an-ip' },
    ])
  })

  it('uses the default port for blank environment values', () => {
    expect(parseEnvPort(undefined)).toBe(3200)
    expect(parseEnvPort('')).toBe(3200)
    expect(parseEnvPort('   ')).toBe(3200)
    expect(parseEnvPort(' 3201 ')).toBe(3201)
  })

  it('allows private-network origins only in explicit development or with opt-in', () => {
    expect(parseAllowPrivateNetworkOrigins(undefined, undefined)).toBe(false)
    expect(parseAllowPrivateNetworkOrigins(undefined, '')).toBe(false)
    expect(parseAllowPrivateNetworkOrigins(undefined, 'staging')).toBe(false)
    expect(parseAllowPrivateNetworkOrigins(undefined, 'development')).toBe(true)
    expect(parseAllowPrivateNetworkOrigins(undefined, 'production')).toBe(false)
    expect(parseAllowPrivateNetworkOrigins(' true ', 'production')).toBe(true)
    expect(parseAllowPrivateNetworkOrigins('false', undefined)).toBe(false)
    expect(parseAllowPrivateNetworkOrigins('false', 'development')).toBe(false)
    expect(parseAllowPrivateNetworkOrigins('true', undefined)).toBe(true)
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

  it('closes the underlying HTTP server when stopped immediately after start', async () => {
    server = startGameServer({ port: 0, host: '127.0.0.1' })
    const closeSpy = vi.spyOn(server.httpServer, 'close')

    await expect(server.stop()).resolves.toBeUndefined()
    await setImmediate()

    expect(closeSpy).toHaveBeenCalled()
    expect(server.httpServer.listening).toBe(false)
    expect(server.httpServer.address()).toBeNull()
  })
})
