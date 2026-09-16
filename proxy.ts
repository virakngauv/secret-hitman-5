import { wordPacksEnabled } from './lib/word-packs'
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from 'next/server'

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
const secretKey = process.env.CLERK_SECRET_KEY?.trim()
const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const isAccountRoute = createRouteMatcher(['/account(.*)'])
const clerkProxy =
  wordPacksEnabled() && publishableKey && secretKey && authorizedParties?.length
    ? clerkMiddleware(
        async (auth, request) => {
          if (isAccountRoute(request)) await auth.protect()
        },
        {
          publishableKey,
          secretKey,
          authorizedParties,
        },
      )
    : null

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!wordPacksEnabled()) {
    if (request.nextUrl?.pathname.startsWith('/__clerk'))
      return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.next()
  }
  // Refuse a half-configured Clerk: exactly one key (or keys without an
  // authorized-party list) would serve /account without Clerk middleware.
  if (
    Boolean(publishableKey) !== Boolean(secretKey) ||
    Boolean(publishableKey && secretKey && !authorizedParties?.length)
  ) {
    return NextResponse.json(
      { error: 'Account configuration unavailable.' },
      { status: 503 },
    )
  }
  return clerkProxy ? clerkProxy(request, event) : NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
}
