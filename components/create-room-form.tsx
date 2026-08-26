'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { useGameSocket } from '@/components/game-socket-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CreateRoomForm() {
  const { createRoom, connectionStatus } = useGameSocket()
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim()

    if (!normalizedName) {
      setError('Enter your name to create a room.')
      return
    }

    setError(null)
    setIsCreating(true)

    try {
      const result = await createRoom(normalizedName)
      if (result.status !== 'success') {
        setError(result.message)
        setIsCreating(false)
        return
      }
      router.push(`/${result.roomCode}`)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'The room could not be created. Please try again.',
      )
      setIsCreating(false)
    }
  }

  return (
    <form className="mt-7" onSubmit={handleSubmit}>
      <label className="text-sm font-semibold" htmlFor="name">
        Name
      </label>
      <Input
        id="name"
        name="name"
        className="mt-2"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Your name"
        autoComplete="name"
        maxLength={50}
        autoFocus
        required
        disabled={isCreating}
      />
      <p
        className="text-accent mt-3 min-h-5 text-sm"
        role={error ? 'alert' : 'status'}
      >
        {error ??
          (connectionStatus === 'connected'
            ? null
            : 'Connecting to the game server…')}
      </p>
      <Button
        className="mt-2 h-12 w-full text-base"
        disabled={isCreating || connectionStatus !== 'connected'}
      >
        {isCreating
          ? 'Creating…'
          : connectionStatus === 'connected'
            ? 'Create'
            : 'Connecting…'}
      </Button>
    </form>
  )
}
