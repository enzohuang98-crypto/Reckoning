import type { BoardState } from '@shared/types/BoardState'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import { validateMoveInput } from '@shared/logic/validation/ValidationUtils'
import type { ActualMoveSelection } from './types'

export interface CoachRequestInput {
  board: BoardState
  draftMove: string
  draftReason: string
  draftQuestion: string
  submittedGuess: SubmittedGuess | null
  actualMove: ActualMoveSelection | null
  submissionId: string
  now: number
}

export type CoachRequest =
  /** 有著法：建立一次請求，引擎比較這步與首選，AI 回應想法與問題。 */
  | { kind: 'submit'; guess: SubmittedGuess }
  /** 沒有著法、有問題：直接就目前局面發問。 */
  | { kind: 'question'; question: string }
  /** 什麼都沒填：解說目前局面。 */
  | { kind: 'explain' }
  | { kind: 'invalid'; message: string }

/**
 * 「請 AI 解說」要送出什麼。著法的優先順序：已送出的 → 自己在棋盤選的 → 棋譜點的實戰步。
 * 已送出時沿用原本的想法（欄位已鎖住），只換這次的問題。
 */
export function buildCoachRequest(input: CoachRequestInput): CoachRequest {
  const question = input.draftQuestion.trim() || undefined
  const pickedMove = input.draftMove.trim().toLowerCase()
  const submitted = input.submittedGuess
  const move = submitted?.move ?? (pickedMove || input.actualMove?.move || '')

  if (!move) return question ? { kind: 'question', question } : { kind: 'explain' }

  if (!submitted && pickedMove) {
    const check = validateMoveInput(input.board, pickedMove)
    if (!check.ok) return { kind: 'invalid', message: `這步不合法：${check.message}` }
  }
  const fromGame = submitted ? submitted.fromGame === true : !pickedMove && input.actualMove !== null
  const reason = submitted ? submitted.reason : input.draftReason.trim() || undefined
  return {
    kind: 'submit',
    guess: {
      submissionId: input.submissionId,
      move,
      ...(reason ? { reason } : {}),
      ...(question ? { question } : {}),
      ...(fromGame ? { fromGame: true } : {}),
      submittedAt: input.now
    }
  }
}
