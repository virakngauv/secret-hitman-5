import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { Providers } from '@/components/providers'

import './globals.css'

export const metadata: Metadata = {
  title: 'Secret Hitman',
  description: 'A host-driven word game for friends.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
