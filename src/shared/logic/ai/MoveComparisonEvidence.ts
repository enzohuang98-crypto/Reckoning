import type { MoveComparisonResult } from '../../types/MoveComparisonResult'

export type MoveComparisonEvidenceState =
  | 'same_move'
  | 'near_equivalent'
  | 'evidence_backed_difference'
  | 'insufficient'

/**
 * Classify only from the existing, tested move-comparison contract. This does
 * not invent a second score threshold: the established mistake level and
 * confidence calculation remain the source of truth.
 */
export function moveComparisonEvidenceState(
  comparison: MoveComparisonResult
): MoveComparisonEvidenceState {
  if (
    comparison.userMove &&
    comparison.engineBestMove &&
    comparison.userMove === comparison.engineBestMove
  ) {
    return 'same_move'
  }
  if (
    !comparison.userMove ||
    !comparison.engineBestMove ||
    comparison.scoreDifference === null ||
    comparison.mistakeLevel === 'unknown' ||
    comparison.confidence === 'low'
  ) {
    return 'insufficient'
  }
  return comparison.mistakeLevel === 'acceptable_or_tiny_inaccuracy'
    ? 'near_equivalent'
    : 'evidence_backed_difference'
}
