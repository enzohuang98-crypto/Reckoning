import type { MoveComparisonResult } from '../../types/MoveComparisonResult'
import { chineseMoveMentions } from '../board/ChineseNotation'

export type MoveComparisonEvidenceState =
  | 'same_move'
  | 'near_equivalent'
  | 'evidence_backed_difference'
  | 'insufficient'

/** One comparison-verdict policy shared by the formal validator and scorer. */
export function hasAssertedMoveCriticism(text: string, moveNames: string[]): boolean {
  const subjects = [...moveNames, '實戰步', '实战步', '實戰著法', '实战着法', '這步', '这步', '你的著法', '你的着法']
    .filter(Boolean).map((move) => move.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const subjectPattern = new RegExp(subjects.join('|'), 'g')
  // Commas can continue the same subject, but a different move/opponent
  // changes it. Negation belongs to each verdict, never the whole paragraph.
  return text.split(/[。！？；]/).some((sentence) => {
    let concernsUserMove = false
    for (const clause of sentence.split(/[，,]|但(?:是)?|然而|可是|卻|却/)) {
      const references = [
        ...Array.from(clause.matchAll(subjectPattern), (match) => ({ index: match.index!, user: true })),
        ...chineseMoveMentions(clause).filter(({ move }) => !moveNames.includes(move))
          .map(({ index }) => ({ index, user: false })),
        ...Array.from(clause.matchAll(/對手(?:的)?(?:著法|着法|這步|这步)|黑方(?:的)?(?:著法|着法)|紅方(?:的)?(?:著法|着法)/g),
          (match) => ({ index: match.index!, user: false }))
      ].sort((a, b) => a.index - b.index)
      for (const verdict of clause.matchAll(/較差|较差|更差|失誤|失误|敗著|败着|錯失|错失|不好|懲罰|惩罚/g)) {
        for (const reference of references.filter(({ index }) => index <= verdict.index!)) {
          concernsUserMove = reference.user
        }
        const prefix = clause.slice(0, verdict.index)
        const negatedOrConditional = /(?:不是|並非|并非|沒有|没有|不能說|不能说|不得|不應|不应|無法說|无法说)[^，,。！？；]{0,8}$/.test(prefix)
          || /(?:如果|假如|若)/.test(prefix)
        if (concernsUserMove && !negatedOrConditional) return true
      }
      if (references.length > 0) concernsUserMove = references.at(-1)!.user
    }
    return false
  })
}

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
