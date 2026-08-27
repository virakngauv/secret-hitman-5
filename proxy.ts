import { clerkMiddleware } from '@clerk/nextjs/server'
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from 'next/server'

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
const secretKey = process.env.CLERK_SECRET_KEY?.trim()
const clerkProxy =
  publishableKey && secretKey
    ? clerkMiddleware({ publishableKey, secretKey })
    : null

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return clerkProxy ? clerkProxy(request, event) : NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*',
  ],
}
