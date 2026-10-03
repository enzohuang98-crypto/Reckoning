import type { MoveComparisonResult } from '../../types/MoveComparisonResult'
import { canonicalChineseMoveNotation, chineseMoveMentions } from '../board/ChineseNotation'

export type MoveComparisonEvidenceState =
  | 'same_move'
  | 'near_equivalent'
  | 'evidence_backed_difference'
  | 'insufficient'

/** One comparison-verdict policy shared by the formal validator and scorer. */
export function hasAssertedMoveCriticism(text: string, moveNames: string[]): boolean {
  const subjects = [...moveNames, '實戰步', '实战步', '實戰著法', '实战着法', '這步', '这步', '你的著法', '你的着法', '使用者著法', '用户着法']
    .filter(Boolean).map((move) => move.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const subjectPattern = new RegExp(subjects.join('|'), 'g')
  // Commas can continue the same subject, but a different move/opponent
  // changes it. Negation belongs to each verdict, never the whole paragraph.
  return text.split(/[。！？；]/).some((sentence) => {
    let concernsUserMove = false
    for (const clause of sentence.split(/[，,]|但(?:是)?|然而|可是|卻|却/)) {
      const references = [
        ...Array.from(clause.matchAll(subjectPattern), (match) => ({ index: match.index!, user: true })),
        ...chineseMoveMentions(clause).map(({ move, index }) => ({ index,
          user: moveNames.some(name => canonicalChineseMoveNotation(name) === canonicalChineseMoveNotation(move)) })),
        ...Array.from(clause.matchAll(/對手(?:的)?(?:著法|着法|這步|这步)|黑方(?:的)?(?:著法|着法)|紅方(?:的)?(?:著法|着法)/g),
          (match) => ({ index: match.index!, user: false }))
      ].sort((a, b) => a.index - b.index)
      let previousVerdictEnd = 0
      let previousVerdictNegated = false
      for (const verdict of clause.matchAll(/較差|较差|更差|失誤|失误|敗著|败着|錯失|错失|錯過|错过|失去先手|不好|懲罰|惩罚|必然受罰|必然受罚/g)) {
        for (const reference of references.filter(({ index }) => index <= verdict.index!)) {
          concernsUserMove = reference.user
        }
        const prefix = clause.slice(previousVerdictEnd, verdict.index)
        // A denial can govern coordinated verdicts (不是失誤或敗著),
        // but not a new predicate (不是失誤而是敗著). Condition scope
        // belongs to this clause, so an earlier verdict cannot consume it.
        // A contrast ends the preceding denial even when that predicate was
        // positive (不是好棋而是失誤). Keep the surrounding conditional scope.
        const denialPrefix = prefix.split(/而是|反而/).at(-1) ?? ''
        const negated: boolean = /(?:不是|並非|并非|沒有|没有|不能說|不能说|不得|不應|不应|無法說|无法说)[^，,。！？；]{0,8}$/.test(denialPrefix)
          || (previousVerdictNegated && /^(?:\s*(?:或(?:者|是)?|和|與|与|及|、)\s*)+$/.test(prefix))
        const negatedOrConditional = negated
          || /(?:如果|假如|若)/.test(clause.slice(0, verdict.index))
        if (concernsUserMove && !negatedOrConditional) return true
        previousVerdictEnd = verdict.index! + verdict[0].length
        previousVerdictNegated = negated
      }
      if (references.length > 0) concernsUserMove = references.at(-1)!.user
    }
    return false
  })
}

/**
 * Classify only from the existing, tested move-comparison contract. This does
 * not invent a second score threshold: the established mistake level and
 * confidence calculation remain the source of truth for numerical comparison.
 * The legacy evidence_backed_difference name does not establish a causal
 * mechanism, strategic superiority, or an independently verified mistake.
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
