import { clerkMiddleware } from '@clerk/nextjs/server'
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from 'next/server'

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  const secretKey = process.env.CLERK_SECRET_KEY?.trim()
  if (!publishableKey || !secretKey) {
    return NextResponse.next()
  }

  return clerkMiddleware({ publishableKey, secretKey })(request, event)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
}
