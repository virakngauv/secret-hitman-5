export function getDenseRanks(scores: readonly (number | null)[]): number[] {
  const normalizedScores = scores.map((score) => score ?? 0)
  const distinctScores = [...new Set(normalizedScores)].sort(
    (left, right) => right - left,
  )
  return normalizedScores.map((score) => distinctScores.indexOf(score) + 1)
}
