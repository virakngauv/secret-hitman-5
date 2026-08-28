import { describe, expect, it } from 'vitest'

import { applyTargets, createPlayerBoard } from './secret-hitman'

describe('fixed board roles', () => {
  it('assigns distinct fixed roles and eight editable words across seeds and seats', () => {
    const layouts = new Set<string>()
    for (let seed = 0; seed < 50; seed++) {
      for (let seat = 0; seat < 12; seat++) {
        const board = createPlayerBoard(`seed-${seed}`, seat)
        expect(board).toHaveLength(12)
        expect(new Set(board.map(({ word }) => word)).size).toBe(12)
        expect(new Set(board.map(({ id }) => id)).size).toBe(12)
        const locked = board.filter(({ locked }) => locked)
        expect(locked.map(({ kind }) => kind).sort()).toEqual([
          'assassin',
          'civilian',
          'civilian',
          'target',
        ])
        expect(board.filter(({ locked }) => !locked)).toHaveLength(8)
        expect(board).toEqual(createPlayerBoard(`seed-${seed}`, seat))
        layouts.add(locked.map(({ id, kind }) => `${id}:${kind}`).join(','))
      }
    }
    expect(layouts.size).toBeGreaterThan(50)
  })

  it('preserves every fixed role even when applying a conflicting target list', () => {
    const board = createPlayerBoard('fixed', 0)
    const fixed = structuredClone(board.filter(({ locked }) => locked))
    applyTargets(
      board,
      board.map(({ id }) => id),
    )
    expect(board.filter(({ locked }) => locked)).toEqual(fixed)
    expect(board.filter(({ kind }) => kind === 'target')).toHaveLength(9)
    applyTargets(board, [])
    expect(board.filter(({ locked }) => locked)).toEqual(fixed)
    expect(board.filter(({ kind }) => kind === 'target')).toHaveLength(1)
  })
})
