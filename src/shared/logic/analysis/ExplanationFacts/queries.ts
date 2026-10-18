/** 給 AnswerCheck／AnswerTidy 用的事實表查詢：哪些著法存在、哪些是唯一合法著法、哪些吃子／將軍。 */

import type { ExplanationFacts, LineFacts } from './types'

/** 主線、實戰線與關鍵著法檢查的假設線：回答可以引用其中任何一手。 */
function allLines(facts: ExplanationFacts): LineFacts[] {
  return [
    facts.bestLine,
    ...(facts.userLine ? [facts.userLine] : []),
    ...(facts.ideas ?? []).map((idea) => idea.line)
  ]
}

/** 事實表中所有可被回答引用的著法（顯示記譜）。 */
export function factMoveSet(facts: ExplanationFacts): Set<string> {
  const moves = new Set<string>([facts.bestMove.move])
  if (facts.userMove) moves.add(facts.userMove.move)
  for (const line of allLines(facts)) {
    for (const ply of line.plies) moves.add(ply.move)
  }
  for (const candidate of facts.candidates) moves.add(candidate.move)
  return moves
}

/** 事實表中標為「唯一合法著法」的著法（顯示記譜）。 */
export function factOnlyLegalMoves(facts: ExplanationFacts): Set<string> {
  const moves = new Set<string>()
  for (const line of allLines(facts)) {
    for (const ply of line.plies) if (ply.onlyLegalMove) moves.add(ply.move)
  }
  return moves
}

/** 著法是否在某條線中吃子／將軍（任何一條線都算）。 */
export function factMoveEvents(
  facts: ExplanationFacts
): Map<string, { captures: boolean; checks: boolean }> {
  const events = new Map<string, { captures: boolean; checks: boolean }>()
  for (const line of allLines(facts)) {
    for (const ply of line.plies) {
      const current = events.get(ply.move) ?? { captures: false, checks: false }
      events.set(ply.move, {
        captures: current.captures || ply.captured !== null,
        checks: current.checks || ply.givesCheck
      })
    }
  }
  return events
}
