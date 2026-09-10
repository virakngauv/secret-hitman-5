import { notFound } from 'next/navigation'
import { wordPacksEnabled } from '@/lib/word-packs'
import Link from 'next/link'
import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  if (!wordPacksEnabled()) notFound()
  if (
    !process.env.CLERK_SECRET_KEY?.trim() ||
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  )
    return (
      <main className="game-page">
        Account features are unavailable.{' '}
        <Link href="/">Return to free play</Link>
      </main>
    )
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  )
}
