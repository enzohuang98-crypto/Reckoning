import { parseFen } from '@shared/logic/board/fen'
import { applyUciMove, isKingInCheck, parseUciMove } from '@shared/logic/board/moves'
import { formatChineseMove } from '@shared/logic/board/ChineseNotation'
import type { PieceColor, PieceType } from '@shared/types/BoardState'
import type { HarnessEvidence } from '@shared/types/Harness'

export interface VariationStepFact {
  ply: number
  move: string
  side: PieceColor
  piece: PieceType
  fromFile: number
  toFile: number
  captured: { side: PieceColor; piece: PieceType } | null
  givesCheck: boolean
}

/** Board facts only, never a strategic verdict or proof of a model's explanation. */
export function buildVariationBoardFacts(evidence: HarnessEvidence): {
  steps: VariationStepFact[]
  warning: string | null
} {
  const parsed = parseFen(evidence.positionFen)
  if (!parsed.valid) return { steps: [], warning: '證據起始局面無效，不能計算棋盤事實。' }
  const isUserLine = evidence.move !== undefined && evidence.move === evidence.analysis.userMove
  const moves = isUserLine
    ? evidence.analysis.userMovePrincipalVariation ?? []
    : evidence.analysis.principalVariation
  let board = parsed.board
  const steps: VariationStepFact[] = []
  // Match the initial writer's visible PV limit and keep repair input bounded.
  for (const [index, uci] of moves.slice(0, 12).entries()) {
    const coordinates = parseUciMove(uci)
    const display = formatChineseMove(board, uci)
    const applied = applyUciMove(board, uci)
    if (!coordinates || !display || !applied.valid) {
      return { steps, warning: `第 ${index + 1} 手未通過合法性檢查，其後沒有可計算事實。` }
    }
    if (evidence.displayPrincipalVariation[index] !== display) {
      return { steps, warning: `第 ${index + 1} 手中文記譜與本變例棋盤不一致，其後沒有可計算事實。` }
    }
    const piece = board.grid[coordinates.fromRow][coordinates.fromCol]!
    const file = (column: number): number => piece.color === 'red' ? 9 - column : column + 1
    steps.push({
      ply: index + 1,
      move: display,
      side: piece.color,
      piece: piece.type,
      fromFile: file(coordinates.fromCol),
      toFile: file(coordinates.toCol),
      captured: applied.captured
        ? { side: applied.captured.color, piece: applied.captured.type }
        : null,
      givesCheck: isKingInCheck(applied.board.grid, applied.board.sideToMove)
    })
    board = applied.board
  }
  return { steps, warning: moves.length === 0 ? '沒有 UCI 主線，不能計算棋盤事實。' : null }
}

/**
 * A bounded check for explicit statements attached to a literal PV move.
 * This does not certify strategy, threats, or arbitrary natural language.
 * Only this claim's cited variations are replayed; ambiguous move identities
 * cannot establish a capture/check statement.
 */
export function validateVariationBoardStatements(
  text: string,
  evidence: HarnessEvidence[]
): string[] {
  const issues: string[] = []
  const moves = [...new Set(evidence.flatMap((item) => item.displayPrincipalVariation))]
    .filter(Boolean).sort((a, b) => b.length - a.length)
  if (moves.length === 0) return issues
  const escaped = moves.map((move) => move.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const movePattern = new RegExp(escaped.join('|'), 'g')
  const facts = evidence.flatMap((item) => buildVariationBoardFacts(item).steps)
  const pieceTypes: Record<string, PieceType> = {
    帥: 'king', 帅: 'king', 將: 'king', 将: 'king',
    仕: 'advisor', 士: 'advisor', 相: 'elephant', 象: 'elephant',
    馬: 'horse', 马: 'horse', 車: 'rook', 车: 'rook',
    炮: 'cannon', 砲: 'cannon', 兵: 'pawn', 卒: 'pawn'
  }
  const sideOf = (name: string): PieceColor => /紅|红/.test(name) ? 'red' : 'black'
  for (const clause of text.split(/[。！？；，,.!?;\n]/)) {
    const mentions = [...clause.matchAll(movePattern)]
    for (const [index, mention] of mentions.entries()) {
      const move = mention[0]
      const before = clause.slice(index === 0 ? 0 : mentions[index - 1]!.index! + mentions[index - 1]![0].length, mention.index)
      const after = clause.slice(mention.index! + move.length, mentions[index + 1]?.index ?? clause.length)
      const side = /(紅方|红方|黑方)(?:以|走|先走|再走|接著走|接着走|選擇|选择)?\s*$/.exec(before)
      const hypothetical = /如果|假如|若|可能|將來|将来|未來|未来|後續|后续|更遠|更远|是否|能否|無法確認|无法确认/.test(before + after)
      const capture = /((?:沒有|没有|未|不)?(?:吃掉|吃去|吃子|吃))(?:了)?(?:一[個枚]?|一顆)?(?:(紅方|红方|黑方))?([兵卒車车炮砲馬马象相士仕將将帥帅])?/.exec(after)
      const check = /((?:沒有|没有|未|不)?)(?:形成|構成|构成)?將軍|((?:沒有|没有|未|不)?)(?:形成|構成|构成)?将军/.exec(after)
      if (!side && (hypothetical || (!capture && !check))) continue
      const candidates = facts.filter((fact) => fact.move === move)
      const fact = candidates[0]
      if (!fact) {
        if (!hypothetical && (capture || check)) {
          issues.push(`棋盤事實：${move} 的引用缺少可重播或無歧義的吃子／將軍事實。`)
        }
        continue
      }
      if (side && candidates.some((candidate) => sideOf(side[1]!) !== candidate.side)) {
        issues.push(`棋盤事實：${move} 的走子方與所引用變例不一致。`)
      }
      if (hypothetical) continue
      if (capture) {
        const captures = new Set(candidates.map((candidate) => JSON.stringify(candidate.captured)))
        const denied = /^(沒有|没有|未|不)/.test(capture[1]!)
        if (captures.size !== 1) {
          issues.push(`棋盤事實：${move} 在引用變例的不同步數有不同吃子結果，必須指明所述步數。`)
        } else if (denied ? fact.captured !== null : fact.captured === null) {
          issues.push(`棋盤事實：${move} 的吃子斷言與逐手棋盤不一致。`)
        } else if (!denied && fact.captured && (
          (capture[2] && sideOf(capture[2]) !== fact.captured.side) ||
          (capture[3] && pieceTypes[capture[3]] !== fact.captured.piece)
        )) {
          issues.push(`棋盤事實：${move} 所吃棋子的方別或種類不一致。`)
        }
      }
      if (check) {
        const denied = Boolean(check[1] || check[2])
        if (new Set(candidates.map((candidate) => candidate.givesCheck)).size !== 1) {
          issues.push(`棋盤事實：${move} 在引用變例的不同步數有不同將軍結果，必須指明所述步數。`)
        } else if (denied ? fact.givesCheck : !fact.givesCheck) {
          issues.push(`棋盤事實：${move} 的將軍斷言與逐手棋盤不一致。`)
        }
      }
    }
  }
  return [...new Set(issues)]
}
