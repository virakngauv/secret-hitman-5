import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { wordPacksEnabled } from '@/lib/word-packs'
import { publicCatalog } from '@/server/packs'
import { Providers } from '@/components/providers'

import './globals.css'

export const dynamic = 'force-dynamic'

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
        <Providers
          wordPacksEnabled={wordPacksEnabled()}
          packs={wordPacksEnabled() ? publicCatalog() : []}
          clerkEnabled={Boolean(
            process.env.CLERK_SECRET_KEY?.trim() &&
            process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
          )}
        >
          {children}
        </Providers>
      </body>
    </html>
  )
}
