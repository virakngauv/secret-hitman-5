'use client'

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from 'react'

import { useGameSocket } from '@/components/game-socket-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const ROOM_CODE_PATTERN = /^[bcdfghkpqrstvz]{4}[2-9y]$/

export type JoinedRoom = { roomCode: string }

export function JoinRoomForm({
  roomCode,
  onJoined,
}: {
  roomCode?: string
  onJoined?: (room: JoinedRoom) => void
}) {
  const roomCodeLocked = roomCode !== undefined
  const { joinRoom, connectionStatus } = useGameSocket()
  const [enteredRoomCode, setEnteredRoomCode] = useState(roomCode ?? '')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isJoining, setIsJoining] = useState(false)
  const roomCodeInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const target = roomCodeLocked
      ? nameInputRef.current
      : roomCodeInputRef.current

    target?.focus({ preventScroll: true })
  }, [roomCodeLocked])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedRoomCode = enteredRoomCode.trim().toLowerCase()
    const normalizedName = name.trim()

    if (!ROOM_CODE_PATTERN.test(normalizedRoomCode)) {
      setError('Enter a valid five-character room code.')
      return
    }

    if (!normalizedName) {
      setError('Enter your name to join the room.')
      return
    }

    setError(null)
    setIsJoining(true)

    try {
      const result = await joinRoom(normalizedRoomCode, normalizedName)

      if (result.status !== 'success') {
        setError(
          result.status === 'room_not_found'
            ? 'We couldn’t find that room. Check the code and try again.'
            : result.status === 'removed_from_room'
              ? 'The host removed you from this room. You can’t rejoin it.'
              : result.message,
        )
        return
      }

      onJoined?.({ roomCode: result.roomCode })
    } catch {
      setError('The room could not be checked. Please try again.')
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <form className="mt-7" onSubmit={handleSubmit}>
      <div className="grid gap-5">
        <Field
          label="Room code"
          id="room-code"
          name="roomCode"
          ref={roomCodeInputRef}
          value={enteredRoomCode}
          onChange={(event) => setEnteredRoomCode(event.target.value)}
          maxLength={5}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono tracking-[0.15em] lowercase"
          readOnly={roomCodeLocked}
          required
          disabled={isJoining}
        />
        <Field
          label="Name"
          id="name"
          name="name"
          placeholder="Your name"
          ref={nameInputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={50}
          required
          disabled={isJoining}
        />
      </div>
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
        disabled={isJoining || connectionStatus !== 'connected'}
      >
        {isJoining
          ? 'Joining…'
          : connectionStatus === 'connected'
            ? 'Join'
            : 'Connecting…'}
      </Button>
    </form>
  )
}

function Field({
  label,
  id,
  className,
  ...props
}: { label: string; id: string } & ComponentProps<typeof Input>) {
  return (
    <div>
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <Input id={id} className={cn('mt-2', className)} {...props} />
    </div>
  )
}
