'use client'

import { useId, useLayoutEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'

export function ConfirmationDialog({
  open,
  title,
  description,
  eyebrow = 'Host action',
  confirmLabel,
  cancelLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  eyebrow?: string
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    ;(cancelRef.current ?? primaryRef.current)?.focus()
    return () => {
      previousFocus?.focus()
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const enabledButton = cancelRef.current ?? primaryRef.current
    if (busy || enabledButton?.disabled) {
      dialogRef.current?.focus()
    } else if (enabledButton && document.activeElement === dialogRef.current) {
      enabledButton.focus()
    }
  }, [busy, open])

  if (!open) return null

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = [
      ...(dialogRef.current?.querySelectorAll('button') ?? []),
    ].filter(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement && !element.disabled,
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div
      className="app-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="app-dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <p className="page-eyebrow">{eyebrow}</p>
        <h2 id={titleId} className="app-dialog-title">
          {title}
        </h2>
        <p id={descriptionId} className="app-dialog-description">
          {description}
        </p>
        {error ? (
          <p className="form-message" role="alert">
            {error}
          </p>
        ) : null}
        <div className="app-dialog-actions">
          {cancelLabel ? (
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              {cancelLabel}
            </Button>
          ) : null}
          <Button
            ref={primaryRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
