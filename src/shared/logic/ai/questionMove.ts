/**
 * 從棋手打字的問題裡找出目前局面的一步合法著法（純函式）。
 * 棋手常直接在問題裡寫「為什麼要走炮二平五？」而沒有在「你的走法」選棋步；
 * 找到的著法會當成要分析的那一步，讓引擎替它算後續、事實表才有內容可講。
 *
 * 只比對輪走方的合法著法，數字照記譜慣例：紅方用中文數字（炮二平五）、黑方用阿拉伯數字（馬8進7），
 * 避免把「黑馬2進3」誤認成紅方的馬二進三。繁簡、異體字與紅黑兵種寫法（相／象、仕／士、兵／卒）視為相同。
 */

import type { BoardState } from '../../types/BoardState'
import { formatChineseMove } from '../board/ChineseNotation'
import { formatUciMove, legalMoveCheck } from '../board/moves'
import { extractMentionedMoves, normalizeMoveText } from './AnswerCheck'

const PIECE_FOLD: Record<string, string> = { 相: '象', 仕: '士', 帥: '將', 卒: '兵' }

function foldPieces(move: string): string {
  return [...normalizeMoveText(move)].map((char) => PIECE_FOLD[char] ?? char).join('')
}

/** 問題裡第一個符合目前局面合法著法的中文記譜，回傳 UCI；沒有就回傳 undefined。 */
export function findQuestionMove(board: BoardState, question: string): string | undefined {
  const mentioned = extractMentionedMoves(question)
  if (mentioned.length === 0) return undefined
  const legalByNotation = new Map<string, string>()
  for (let fromRow = 0; fromRow < board.grid.length; fromRow++) {
    for (let fromCol = 0; fromCol < board.grid[fromRow].length; fromCol++) {
      if (board.grid[fromRow][fromCol]?.color !== board.sideToMove) continue
      for (let toRow = 0; toRow < board.grid.length; toRow++) {
        for (let toCol = 0; toCol < board.grid[toRow].length; toCol++) {
          const move = formatUciMove({ fromRow, fromCol, toRow, toCol })
          if (!move || !legalMoveCheck(board.grid, board.sideToMove, move).ok) continue
          const notation = formatChineseMove(board, move)
          if (notation) legalByNotation.set(foldPieces(notation), move)
        }
      }
    }
  }
  for (const { move } of mentioned) {
    const found = legalByNotation.get(foldPieces(move))
    if (found) return found
  }
  return undefined
}
