import { PricingTable } from '@clerk/nextjs'
import Link from 'next/link'
import { AccountControl } from '@/components/account-bridge'
import { publicCatalog } from '@/server/packs'

export const dynamic = 'force-dynamic'

export default function PricingPage() {
  const configured = Boolean(
    process.env.CLERK_SECRET_KEY?.trim() &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim(),
  )
  const checkoutEnabled =
    configured && process.env.ENABLE_CLERK_CHECKOUT === 'true'
  return (
    <main className="game-page">
      <section className="game-panel mx-auto max-w-3xl space-y-5">
        <Link href="/" className="underline">
          Back to home
        </Link>
        <h1 className="text-3xl font-bold">Word packs</h1>
        <p>
          Base hosting and guest play are free. Subscription access lets the
          host share eligible packs with everyone in a round while their plan
          grants access.
        </p>
        <AccountControl />
        <ul>
          {publicCatalog().map((pack) => (
            <li key={pack.id} className="my-3">
              <strong>{pack.name}</strong> — {pack.description}
            </li>
          ))}
        </ul>
        {checkoutEnabled ? (
          <PricingTable for="user" />
        ) : (
          <p>
            Subscriptions are not available for purchase here yet. Base play
            remains free.
          </p>
        )}
      </section>
    </main>
  )
}
