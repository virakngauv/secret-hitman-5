'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

export function LeaveRoomControl({
  busy,
  confirmationRequired = true,
  disabled = false,
  error,
  gameInProgress,
  isHost,
  onConfirm,
}: {
  busy: boolean
  confirmationRequired?: boolean
  disabled?: boolean
  error?: string | null
  gameInProgress: boolean
  isHost: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="mt-3 w-full"
        disabled={disabled || busy}
        onClick={() => {
          if (!confirmationRequired) {
            onConfirm()
            return
          }
          setAttempted(false)
          setOpen(true)
        }}
      >
        {busy ? 'Leaving…' : 'Leave room'}
      </Button>
      <ConfirmationDialog
        open={open && confirmationRequired}
        eyebrow="Room action"
        title={isHost ? 'Leave as host?' : 'Leave this room?'}
        description={
          isHost
            ? gameInProgress
              ? 'You’ll return home and another room member will become host. Your current participation will end, but completed scores and game history will remain.'
              : 'You’ll return home and another room member will become host. The room will stay open for everyone else.'
            : gameInProgress
              ? 'You’ll return home and leave the current game. Your completed scores and game history will remain.'
              : 'You’ll return home and leave the lobby. The room will stay open for everyone else.'
        }
        cancelLabel="Cancel"
        confirmLabel="Leave room"
        busy={busy}
        error={attempted ? error : null}
        onCancel={() => {
          setAttempted(false)
          setOpen(false)
        }}
        onConfirm={() => {
          setAttempted(true)
          onConfirm()
        }}
      />
    </>
  )
}
