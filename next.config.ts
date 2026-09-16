import { networkInterfaces } from 'node:os'

import type { NextConfig } from 'next'

const localIPv4Addresses = Object.values(networkInterfaces()).flatMap(
  (interfaces) =>
    interfaces
      ?.filter(({ family, internal }) => family === 'IPv4' && !internal)
      .map(({ address }) => address) ?? [],
)

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The installed Next.js SDK reads this setting for its browser runtime.
  env: { NEXT_PUBLIC_CLERK_JS_VERSION: '6.31.0' },
  allowedDevOrigins: ['terminal.local', '127.0.0.1', ...localIPv4Addresses],
  turbopack: { root: process.cwd() },
}

export default nextConfig
