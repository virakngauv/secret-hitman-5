import type { Metadata } from 'next'
import Link from 'next/link'

import { CreateRoomForm } from '@/components/create-room-form'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Create a Room — Secret Hitman',
}

export default function CreateRoomPage() {
  return (
    <main className="flex min-h-screen items-center px-5 py-10 sm:px-8">
      <section className="bg-card mx-auto w-full max-w-lg rounded-[2rem] border p-7 shadow-sm sm:p-10">
        <h1 className="text-center text-4xl leading-[1.05] font-bold tracking-[-0.04em] text-balance sm:text-5xl">
          create a room<span className="text-accent">.</span>
        </h1>
        <CreateRoomForm />
        <Button asChild variant="outline" className="mt-3 w-full">
          <Link href="/home">Back to home</Link>
        </Button>
      </section>
    </main>
  )
}
