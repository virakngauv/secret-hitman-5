import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['terminal.local', '127.0.0.1', '192.168.*.*'],
  turbopack: { root: process.cwd() },
}

export default nextConfig
