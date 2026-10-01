import { parseFen } from '@shared/logic/board/fen'
import { applyUciMove, formatUciMove, isKingInCheck, legalMoveCheck, parseUciMove } from '@shared/logic/board/moves'
import {
  canonicalChineseMoveNotation,
  chineseMoveMentions,
  formatChineseMove
} from '@shared/logic/board/ChineseNotation'
import type { PieceColor, PieceType } from '@shared/types/BoardState'
import type { HarnessEvidence } from '@shared/types/Harness'
import { MAX_PV_MOVES } from '../engine/EngineOutputParser'

// Replay the provided engine line rather than hiding its decisive tail. The
// parser's existing bound still protects against oversized untrusted evidence.
export const VARIATION_BOARD_FACT_MAX_PLIES = MAX_PV_MOVES

export interface VariationStepFact {
  ply: number
  move: string
  side: PieceColor
  piece: PieceType
  fromFile: number
  toFile: number
  /** Absolute UCI squares; independent of the mover's file-number convention. */
  fromSquare: string
  toSquare: string
  /** Fixed resulting board, assuming this side could move again; not a forced threat or an actual extra ply. */
  movedPieceCaptureTargets: { square: string; side: PieceColor; piece: PieceType }[]
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
  // Use the same existing parser bound in prompt projection and validation.
  for (const [index, uci] of moves.slice(0, VARIATION_BOARD_FACT_MAX_PLIES).entries()) {
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
    const movedPieceCaptureTargets: VariationStepFact['movedPieceCaptureTargets'] = []
    for (const [row, cells] of applied.board.grid.entries()) {
      for (const [col, target] of cells.entries()) {
        if (!target || target.color === piece.color || target.type === 'king') continue
        const captureMove = formatUciMove({
          fromRow: coordinates.toRow, fromCol: coordinates.toCol,
          toRow: row, toCol: col
        })
        if (captureMove && legalMoveCheck(applied.board.grid, piece.color, captureMove).ok) {
          movedPieceCaptureTargets.push({ square: captureMove.slice(2), side: target.color, piece: target.type })
        }
      }
    }
    steps.push({
      ply: index + 1,
      move: display,
      side: piece.color,
      piece: piece.type,
      fromFile: file(coordinates.fromCol),
      toFile: file(coordinates.toCol),
      fromSquare: uci.slice(0, 2),
      toSquare: uci.slice(2),
      movedPieceCaptureTargets,
      captured: applied.captured
        ? { side: applied.captured.color, piece: applied.captured.type }
        : null,
      givesCheck: isKingInCheck(applied.board.grid, applied.board.sideToMove)
    })
    board = applied.board
  }
  return { steps, warning: moves.length === 0 ? '沒有 UCI 主線，不能計算棋盤事實。'
    : moves.length > VARIATION_BOARD_FACT_MAX_PLIES
      ? `主線超過引擎解析上限 ${VARIATION_BOARD_FACT_MAX_PLIES} 手，其後沒有可計算事實。`
      : null }
}

/**
 * Capture observations for prompt input, never a material or strategic verdict.
 * Shared categories mean the same captured side/type, not the same piece.
 * Only verified prefixes from exactly the same starting FEN are compared.
 */
export function summarizeVariationCaptures(evidence: readonly HarnessEvidence[]): string[] {
  if (evidence.length === 0) return []
  const names: Record<PieceColor, Record<PieceType, string>> = {
    red: { king: '帥', advisor: '仕', elephant: '相', horse: '馬', rook: '車', cannon: '炮', pawn: '兵' },
    black: { king: '將', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '炮', pawn: '卒' }
  }
  const pieceName = (side: PieceColor, piece: PieceType): string =>
    `${side === 'red' ? '紅方' : '黑方'}${names[side][piece]}`
  const summaries = [
    `吃子摘要只涵蓋各變例最多前 ${VARIATION_BOARD_FACT_MAX_PLIES} 手的已重播前綴，不是終局子力或優劣判定。共同事件只比較被吃方與棋子類別，不表示同一枚棋子。`
  ]
  const sharedByFen = new Map<string, Map<string, {
    captured: NonNullable<VariationStepFact['captured']>
    pliesById: Map<string, number[]>
  }>>()
  for (const item of evidence) {
    const facts = buildVariationBoardFacts(item)
    const captures = facts.steps.filter((step) => step.captured !== null)
    summaries.push(`${item.id}：已重播 ${facts.steps.length} 手${facts.steps.length > 0 && captures.length === 0 ? '，此已重播前綴未觀察到吃子' : ''}。`)
    if (facts.warning) summaries.push(`${item.id}：${facts.warning}`)
    for (const step of captures) {
      const captured = step.captured!
      summaries.push(`${item.id} 第 ${step.ply} 手：${pieceName(step.side, step.piece)}走${step.move}，吃掉${pieceName(captured.side, captured.piece)}。`)
      let categories = sharedByFen.get(item.positionFen)
      if (!categories) {
        categories = new Map()
        sharedByFen.set(item.positionFen, categories)
      }
      const categoryKey = `${captured.side}:${captured.piece}`
      let category = categories.get(categoryKey)
      if (!category) {
        category = { captured, pliesById: new Map() }
        categories.set(categoryKey, category)
      }
      const plies = category.pliesById.get(item.id) ?? []
      if (!plies.includes(step.ply)) plies.push(step.ply)
      category.pliesById.set(item.id, plies)
    }
  }
  for (const categories of sharedByFen.values()) {
    for (const { captured, pliesById } of categories.values()) {
      if (pliesById.size < 2) continue
      const locations = [...pliesById].map(([id, plies]) => `${id} 第 ${plies.join('、')} 手`).join('；')
      summaries.push(`相同起始局面的已重播前綴共同出現被吃${pieceName(captured.side, captured.piece)}：${locations}。不能據此稱為某一條變例獨有的損失，也不能據此判定走法優劣。`)
    }
  }
  return summaries
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
  // Discover assertions before looking up their evidence. A whitelist matcher
  // would silently discard invented moves, rather than reject unbound facts.
  const facts = evidence.flatMap((item) => buildVariationBoardFacts(item).steps)
  const pieceTypes: Record<string, PieceType> = {
    帥: 'king', 帅: 'king', 將: 'king', 将: 'king',
    仕: 'advisor', 士: 'advisor', 相: 'elephant', 象: 'elephant',
    馬: 'horse', 马: 'horse', 車: 'rook', 车: 'rook',
    炮: 'cannon', 砲: 'cannon', 兵: 'pawn', 卒: 'pawn'
  }
  const sideOf = (name: string): PieceColor => /紅|红/.test(name) ? 'red' : 'black'
  // Qualifiers apply to the fact that follows them, never to earlier facts in
  // the same sentence. A contrasting assertion starts a new scope.
  const predicateScope = (prefix: string): string => {
    let scope = prefix.split(/但是|但|然而|卻|却|可是|不過|不过/).at(-1) ?? ''
    // A conditional retains its scope even when its premise says "already".
    // A new coordinated present assertion can instead stand on its own.
    const coordinated = scope.split(/並且|并且|而且|並|并/)
    const last = coordinated.at(-1) ?? ''
    if (coordinated.length > 1 && /這步|这步|此步|本手|已(?:經|经)?|立即|實際|实际|確實|确实/.test(last)) {
      scope = last
    }
    return scope
  }
  const isHypothetical = (prefix: string): boolean =>
    /如果|假如|若|可能|將來|将来|未來|未来|後續|后续|更遠|更远|是否|能否|無法確認|无法确认/.test(predicateScope(prefix))
  for (const clause of text.split(/[。！？；，,.!?;\n]/)) {
    const mentions = chineseMoveMentions(clause)
    for (const [index, mention] of mentions.entries()) {
      const move = mention.move
      const before = clause.slice(index === 0 ? 0 : mentions[index - 1]!.index + mentions[index - 1]!.move.length, mention.index)
      const after = clause.slice(mention.index + move.length, mentions[index + 1]?.index ?? clause.length)
      const side = /(紅方|红方|黑方)(?:以|走|先走|再走|接著走|接着走|選擇|选择)?\s*$/.exec(before)
      const captures = [...after.matchAll(/((?:(?:沒有|没有|未|不|非)(?:是)?(?:直接|立即|立刻)?)?(?:吃掉|吃去|吃子|吃))(?:了)?(?:一[個枚]?|一顆)?(?:(紅方|红方|黑方))?([a-i][0-9])?([兵卒車车炮砲馬马象相士仕將将帥帅])?/g)]
        .flatMap((match) => {
          const prefix = before + after.slice(0, match.index)
          const modal = /((?:(?:沒有|没有|沒|没|未|不|非)(?:是)?)?(?:可(?:以)?|能(?:夠|够)?|可能)|無法|无法|沒有機會|没有机会|沒機會|没机会|有機會|有机会)(?:直接|立即|立刻)?$/.exec(prefix)
          // A bare possibility can concern a later, changed board. An explicit
          // current possibility instead has to match this move's resulting board.
          const opportunity = Boolean(modal && (!modal[1]!.includes('可能') ||
            /當下|当下|此時|此时|目前|當前|当前|現在|现在|走後|走后|這步|这步|此步|本手|固定盤面|固定盘面/.test(predicateScope(prefix))))
          const assertionPrefix = opportunity ? prefix.slice(0, -modal![0].length) : prefix
          if (isHypothetical(assertionPrefix)) return []
          // "Can choose not to capture" makes neither an actual-capture nor a
          // capture-availability assertion. Later predicates are still checked.
          if (opportunity && /^(沒有|没有|未|不|非)/.test(match[1]!)) return []
          const denied = opportunity
            ? /^(沒有|没有|沒|没|未|不|非|無法|无法)/.test(modal![1]!)
            : /^(沒有|没有|未|不|非)/.test(match[1]!)
          return [{ match, opportunity, denied }]
        })
      const checks = [...after.matchAll(/((?:(?:沒有|没有|未|不|非)(?:是)?(?:直接|立即|立刻)?)?)(?:形成|構成|构成)?(?:將軍|将军)/g)]
        .filter((match) => !isHypothetical(before + after.slice(0, match.index)))
      if (!side && captures.length === 0 && checks.length === 0) continue
      const canonicalMove = canonicalChineseMoveNotation(move)
      const candidates = facts.filter((fact) => canonicalChineseMoveNotation(fact.move) === canonicalMove)
      const fact = candidates[0]
      if (!fact) {
        if (captures.length > 0 || checks.length > 0 || (side && !isHypothetical(before))) {
          issues.push(`棋盤事實：${move} 的引用缺少可重播或無歧義的吃子／將軍事實。`)
        }
        continue
      }
      if (side && candidates.some((candidate) => sideOf(side[1]!) !== candidate.side)) {
        issues.push(`棋盤事實：${move} 的走子方與所引用變例不一致。`)
      }
      for (const { match: capture, opportunity, denied } of captures) {
        const matchingCapture = (candidate: VariationStepFact): boolean => opportunity
          ? candidate.movedPieceCaptureTargets.some((target) =>
              (!capture[2] || sideOf(capture[2]) === target.side) &&
              (!capture[3] || capture[3] === target.square) &&
              (!capture[4] || pieceTypes[capture[4]] === target.piece))
          : Boolean(candidate.captured &&
              (!capture[2] || sideOf(capture[2]) === candidate.captured.side) &&
              (!capture[3] || capture[3] === candidate.toSquare) &&
              (!capture[4] || pieceTypes[capture[4]] === candidate.captured.piece))
        const captureOutcomes = new Set(candidates.map(matchingCapture))
        const kind = opportunity ? '可吃目標' : '吃子'
        if (captureOutcomes.size !== 1) {
          issues.push(`棋盤事實：${move} 在引用變例的不同步數有不同${kind}結果，必須指明所述步數。`)
        } else if (denied ? matchingCapture(fact) : !matchingCapture(fact)) {
          issues.push(`棋盤事實：${move} 的${kind}斷言與逐手棋盤不一致。`)
        }
      }
      for (const check of checks) {
        const denied = Boolean(check[1])
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
