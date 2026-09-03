import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function HostControlCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('game-panel host-control-card', className)}
      aria-label="Host controls"
    >
      <p className="host-control-label">Host control</p>
      {children}
    </section>
  )
}
