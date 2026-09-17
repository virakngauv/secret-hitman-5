import type { ComponentProps } from 'react'

import { Input } from '@/components/ui/input'
import { MAX_PLAYER_NAME_LENGTH } from '@/lib/game-protocol'
import { cn } from '@/lib/utils'

type PlayerNameFieldProps = {
  id: string
  label?: string
  value: string
  onValueChange: (value: string) => void
} & Omit<
  ComponentProps<typeof Input>,
  'id' | 'value' | 'onChange' | 'maxLength' | 'aria-describedby'
>

export function PlayerNameField({
  id,
  label = 'Name',
  value,
  onValueChange,
  className,
  ...props
}: PlayerNameFieldProps) {
  const countId = `${id}-character-count`

  return (
    <div>
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        <Input
          {...props}
          id={id}
          value={value}
          onChange={(event) =>
            onValueChange(event.target.value.slice(0, MAX_PLAYER_NAME_LENGTH))
          }
          maxLength={MAX_PLAYER_NAME_LENGTH}
          aria-describedby={countId}
          className={cn('col-span-2 mt-2', className)}
        />
        <span id={countId} className="hint-character-count" aria-live="polite">
          {value.length}/{MAX_PLAYER_NAME_LENGTH}
        </span>
      </div>
    </div>
  )
}
