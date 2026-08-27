import type * as React from 'react'

import { cn } from '@/lib/utils'

function Input({
  className,
  type = 'text',
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-border bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/35 h-11 w-full rounded-xl border px-4 text-base transition-shadow outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
