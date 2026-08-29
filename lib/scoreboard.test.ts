import { describe, expect, it } from 'vitest'

import { getDenseRanks } from './scoreboard'

describe('getDenseRanks', () => {
  it.each([
    { scores: [100, 90, 80], ranks: [1, 2, 3] },
    { scores: [100, 100, 90], ranks: [1, 1, 2] },
    { scores: [100, 90, 90, 80], ranks: [1, 2, 2, 3] },
    { scores: [100, 100, 100], ranks: [1, 1, 1] },
  ])('densely ranks $scores as $ranks', ({ scores, ranks }) => {
    expect(getDenseRanks(scores)).toEqual(ranks)
  })

  it('ranks unsorted and nullable scores without reordering them', () => {
    expect(getDenseRanks([null, 5, -2, 5])).toEqual([2, 1, 3, 1])
  })
})
