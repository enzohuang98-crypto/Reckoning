/**
 * 解說事實表 (ExplanationFacts) — v2 解說管線的事實來源（純函式）。
 *
 * 由程式逐手重播引擎主線，算出「誰走、哪個子、吃了什麼、是否將軍、走後威脅與有無保護、
 * 線末是否將死／困斃、兩條線的關鍵差異」。AI 只負責把這些事實講成人話，
 * 不再自己從 FEN 推棋盤（免費模型在這一步最常出錯）。
 *
 * 只產生客觀描述，不做戰略判斷；分數只取 displayText，絕不使用 EngineScore.raw。
 */

import type { ExplanationLanguage } from '../../types/AIExplanationTypes'
import type { BoardState, PieceColor, PieceType } from '../../types/BoardState'
import type { EngineAnalysis } from '../../types/EngineAnalysis'
import {
  MISTAKE_LEVEL_LABELS,
  type MistakeLevel,
  type MoveComparisonResult
} from '../../types/MoveComparisonResult'
import { formatChineseMove } from '../board/ChineseNotation'
import { parseFen } from '../board/fen'
import {
  applyUciMove,
  formatUciMove,
  hasAnyLegalMove,
  isKingInCheck,
  isSquareAttackedBy,
  legalMoveCheck,
  parseUciMove
} from '../board/moves'

export const MAX_FACT_LINE_PLIES = 10
export const MAX_FACT_THREATS = 3
export const MAX_FACT_DIFFERENCES = 3
export const MAX_FACTS_PROMPT_CHARS = 1_500

export type PlyDescriptor =
  | 'enters_center'
  | 'rook_develops'
  | 'horse_develops'
  | 'pawn_crosses_river'
  | 'king_moves'

export interface ThreatFact {
  piece: PieceType
  side: PieceColor
  /** 假設被吃下後，對方能否在同一格吃回（將/帥一步可及也算；即象棋所說的「有根」）。 */
  protected: boolean
}

export interface PlyFact {
  ply: number
  side: PieceColor
  uci: string
  move: string
  piece: PieceType
  captured: PieceType | null
  givesCheck: boolean
  threats: ThreatFact[]
  /** 這一手新製造的可吃目標（走前已存在的不重複列出），依子力價值排序，最多 3 個。 */
  descriptors: PlyDescriptor[]
}

export interface LineFacts {
  plies: PlyFact[]
  /** 線末輪走方沒有合法著法時：被將軍為將死，否則為困斃（象棋中困斃同樣判負，與西洋棋逼和不同）。 */
  endsWith: 'checkmate' | 'stalemate' | null
  /** 這條線中各方吃掉的子（依順序）。 */
  captures: Record<PieceColor, PieceType[]>
  /** 主線無法重播時的說明（之後的著法已省略）。 */
  warning?: string
}

export interface MoveFact {
  uci: string
  move: string
  scoreText?: string
}

export type FactDifference =
  | { kind: 'no_captures'; plies: number }
  | {
      kind: 'first_capture'
      line: 'best' | 'user'
      ply: number
      side: PieceColor
      piece: PieceType
      captured: PieceType
      otherLineCaptureFirstAt: number | null
    }
  | { kind: 'first_check'; line: 'best' | 'user'; ply: number; side: PieceColor; otherLineCheckAt: number | null }
  | {
      kind: 'material'
      best: Record<PieceColor, PieceType[]>
      user: Record<PieceColor, PieceType[]>
    }

export interface ExplanationFacts {
  positionFen: string
  sideToMove: PieceColor
  bestMove: MoveFact
  userMove?: MoveFact
  /** 棋手的著法就是引擎首選。 */
  userIsBest: boolean
  mistakeLevel?: MistakeLevel
  /** 差距（兵）；只描述大小，不當理由。 */
  scoreGapPawns?: number
  bestLine: LineFacts
  userLine?: LineFacts
  candidates: MoveFact[]
  differences: FactDifference[]
}

/**
 * 只用於排序「走後可吃」的目標，不寫進事實表。採常見參考值：
 * 車 9、炮 4.5、馬 4、仕／相 2、兵 1（過河後約 2）——見 xiangqi.com〈The Value of the Pieces〉。
 */
const PIECE_VALUE: Record<PieceType, number> = {
  king: 100,
  rook: 9,
  cannon: 4.5,
  horse: 4,
  advisor: 2,
  elephant: 2,
  pawn: 1
}

function opponent(color: PieceColor): PieceColor {
  return color === 'red' ? 'black' : 'red'
}

function homeRow(color: PieceColor): number {
  return color === 'red' ? 9 : 0
}

function crossedRiver(color: PieceColor, row: number): boolean {
  return color === 'red' ? row <= 4 : row >= 5
}

function startsWith(line: readonly string[] | undefined, move: string): string[] {
  const moves = [...(line ?? [])]
  return moves[0] === move ? moves : [move, ...moves]
}

interface LocatedThreat extends ThreatFact {
  square: string
  value: number
}

/** 這一手「新製造」的威脅：走前就能吃到的目標不重複列出，只留這步棋帶來的變化。 */
function newThreats(before: BoardState, after: BoardState, attacker: PieceColor): ThreatFact[] {
  const existing = new Set(
    capturableTargets(before.grid, attacker).map((threat) => `${threat.square}:${threat.piece}`)
  )
  return capturableTargets(after.grid, attacker)
    .filter((threat) => !existing.has(`${threat.square}:${threat.piece}`))
    .sort((left, right) => right.value - left.value)
    .slice(0, MAX_FACT_THREATS)
    .map(({ piece, side, protected: isProtected }) => ({ piece, side, protected: isProtected }))
}

/** 行棋方此刻可以合法吃到的敵子（不含將/帥）。 */
function capturableTargets(grid: BoardState['grid'], attacker: PieceColor): LocatedThreat[] {
  const defender = opponent(attacker)
  const found: LocatedThreat[] = []
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const target = grid[row][col]
      if (!target || target.color !== defender || target.type === 'king') continue
      let attackerMove: string | null = null
      for (let fromRow = 0; fromRow < grid.length && !attackerMove; fromRow++) {
        for (let fromCol = 0; fromCol < grid[fromRow].length; fromCol++) {
          if (grid[fromRow][fromCol]?.color !== attacker) continue
          const move = formatUciMove({ fromRow, fromCol, toRow: row, toCol: col })
          if (move && legalMoveCheck(grid, attacker, move).ok) {
            attackerMove = move
            break
          }
        }
      }
      if (!attackerMove) continue
      const coords = parseUciMove(attackerMove)!
      const afterCapture = grid.map((cells) => cells.slice())
      afterCapture[row][col] = afterCapture[coords.fromRow][coords.fromCol]
      afterCapture[coords.fromRow][coords.fromCol] = null
      found.push({
        piece: target.type,
        side: defender,
        protected: isSquareAttackedBy(afterCapture, row, col, defender, true),
        square: `${row},${col}`,
        value: PIECE_VALUE[target.type]
      })
    }
  }
  return found
}

function describePly(
  uci: string,
  piece: PieceType,
  side: PieceColor
): PlyDescriptor[] {
  const coords = parseUciMove(uci)!
  const descriptors: PlyDescriptor[] = []
  if (
    coords.toCol === 4 &&
    coords.fromCol !== 4 &&
    (piece === 'cannon' || piece === 'rook' || piece === 'horse' || piece === 'pawn')
  ) {
    descriptors.push('enters_center')
  }
  if (piece === 'rook' && coords.fromRow === homeRow(side) && coords.toRow !== coords.fromRow) {
    descriptors.push('rook_develops')
  }
  if (piece === 'horse' && coords.fromRow === homeRow(side)) descriptors.push('horse_develops')
  if (
    piece === 'pawn' &&
    !crossedRiver(side, coords.fromRow) &&
    crossedRiver(side, coords.toRow)
  ) {
    descriptors.push('pawn_crosses_river')
  }
  if (piece === 'king') descriptors.push('king_moves')
  return descriptors
}

/** 逐手重播一條主線，最多 MAX_FACT_LINE_PLIES 手；遇到無法重播的著法就停並附說明。 */
export function buildLineFacts(
  startFen: string,
  moves: readonly string[],
  maxPlies = MAX_FACT_LINE_PLIES
): LineFacts {
  const parsed = parseFen(startFen)
  const captures: Record<PieceColor, PieceType[]> = { red: [], black: [] }
  if (!parsed.valid) {
    return { plies: [], endsWith: null, captures, warning: '局面無法解析，無法重播主線。' }
  }
  let board = parsed.board
  const plies: PlyFact[] = []
  let warning: string | undefined
  for (const uci of moves.slice(0, maxPlies)) {
    const coords = parseUciMove(uci)
    const moving = coords ? board.grid[coords.fromRow][coords.fromCol] : null
    const display = formatChineseMove(board, uci)
    const applied = applyUciMove(board, uci)
    if (!coords || !moving || !display || !applied.valid) {
      warning = `主線第 ${plies.length + 1} 手無法在棋盤上重播，之後的著法已省略。`
      break
    }
    const side = board.sideToMove
    const next = applied.board
    if (applied.captured) captures[side].push(applied.captured.type)
    plies.push({
      ply: plies.length + 1,
      side,
      uci,
      move: display,
      piece: moving.type,
      captured: applied.captured?.type ?? null,
      givesCheck: isKingInCheck(next.grid, opponent(side)),
      threats: newThreats(board, next, side),
      descriptors: describePly(uci, moving.type, side)
    })
    board = next
  }
  let endsWith: LineFacts['endsWith'] = null
  if (plies.length > 0 && !warning && !hasAnyLegalMove(board.grid, board.sideToMove)) {
    endsWith = isKingInCheck(board.grid, board.sideToMove) ? 'checkmate' : 'stalemate'
  }
  return { plies, endsWith, captures, ...(warning ? { warning } : {}) }
}

function firstCapture(line: LineFacts): PlyFact | undefined {
  return line.plies.find((ply) => ply.captured !== null)
}

function firstCheck(line: LineFacts): PlyFact | undefined {
  return line.plies.find((ply) => ply.givesCheck)
}

function sameCaptures(left: LineFacts, right: LineFacts): boolean {
  return (['red', 'black'] as const).every(
    (side) => left.captures[side].join(',') === right.captures[side].join(',')
  )
}

function buildDifferences(bestLine: LineFacts, userLine: LineFacts | undefined): FactDifference[] {
  if (!userLine) return []
  const differences: FactDifference[] = []
  const bestCapture = firstCapture(bestLine)
  const userCapture = firstCapture(userLine)
  if (!bestCapture && !userCapture) {
    differences.push({
      kind: 'no_captures',
      plies: Math.min(bestLine.plies.length, userLine.plies.length)
    })
  } else {
    const [line, capture, other] =
      bestCapture && (!userCapture || bestCapture.ply <= userCapture.ply)
        ? (['best', bestCapture, userCapture] as const)
        : (['user', userCapture!, bestCapture] as const)
    differences.push({
      kind: 'first_capture',
      line,
      ply: capture.ply,
      side: capture.side,
      piece: capture.piece,
      captured: capture.captured!,
      otherLineCaptureFirstAt: other?.ply ?? null
    })
  }
  const bestCheck = firstCheck(bestLine)
  const userCheck = firstCheck(userLine)
  if (bestCheck || userCheck) {
    const [line, check, other] =
      bestCheck && (!userCheck || bestCheck.ply <= userCheck.ply)
        ? (['best', bestCheck, userCheck] as const)
        : (['user', userCheck!, bestCheck] as const)
    differences.push({
      kind: 'first_check',
      line,
      ply: check.ply,
      side: check.side,
      otherLineCheckAt: other?.ply ?? null
    })
  }
  if (!sameCaptures(bestLine, userLine)) {
    differences.push({ kind: 'material', best: bestLine.captures, user: userLine.captures })
  }
  return differences.slice(0, MAX_FACT_DIFFERENCES)
}

/** 由引擎分析（與可選的著法比較）建立事實表。 */
export function buildExplanationFacts(
  analysis: EngineAnalysis,
  comparison?: MoveComparisonResult | null
): ExplanationFacts {
  const startFen = analysis.positionFen
  const parsed = parseFen(startFen)
  const displayOf = (uci: string, fallback?: string): string =>
    (parsed.valid ? formatChineseMove(parsed.board, uci) : null) ?? fallback ?? uci
  const bestMove: MoveFact = {
    uci: analysis.bestMove,
    move: displayOf(analysis.bestMove, analysis.displayBestMove),
    ...(analysis.scoreAfterBestMove
      ? { scoreText: analysis.scoreAfterBestMove.displayText }
      : {})
  }
  const bestLine = buildLineFacts(
    startFen,
    startsWith(analysis.principalVariation, analysis.bestMove)
  )
  const hasUserMove = Boolean(analysis.userMove)
  const userIsBest = hasUserMove && analysis.userMove === analysis.bestMove
  const userMove: MoveFact | undefined = analysis.userMove
    ? {
        uci: analysis.userMove,
        move: displayOf(analysis.userMove, analysis.displayUserMove),
        ...(analysis.scoreAfterUserMove
          ? { scoreText: analysis.scoreAfterUserMove.displayText }
          : {})
      }
    : undefined
  const userLine =
    analysis.userMove && !userIsBest
      ? buildLineFacts(
          startFen,
          startsWith(analysis.userMovePrincipalVariation, analysis.userMove)
        )
      : undefined
  // 殺棋分數換算成「兵」沒有意義（例如殺 1 對殺 2 會被算成約 1 兵的差距），
  // 這時只呈現兩邊的評估文字（殺 N），不列錯誤等級與兵數。
  const involvesMate =
    analysis.scoreAfterBestMove?.type === 'mate' ||
    analysis.scoreAfterUserMove?.type === 'mate'
  const comparable =
    !involvesMate &&
    comparison &&
    comparison.positionFen === startFen &&
    comparison.userMove === analysis.userMove
  const gap = comparable ? comparison!.scoreDifference : null
  return {
    positionFen: startFen,
    sideToMove: analysis.sideToMove,
    bestMove,
    ...(userMove ? { userMove } : {}),
    userIsBest,
    ...(comparable && comparison!.mistakeLevel !== 'unknown'
      ? { mistakeLevel: comparison!.mistakeLevel }
      : {}),
    ...(typeof gap === 'number' && Number.isFinite(gap)
      ? { scoreGapPawns: Math.round(gap * 100) / 100 }
      : {}),
    bestLine,
    ...(userLine ? { userLine } : {}),
    candidates: analysis.candidateMoves.slice(0, 3).map((candidate) => ({
      uci: candidate.move,
      move: displayOf(candidate.move, candidate.displayMove),
      ...(candidate.score ? { scoreText: candidate.score.displayText } : {})
    })),
    differences: buildDifferences(bestLine, userLine)
  }
}

/** 事實表中所有可被回答引用的著法（顯示記譜）。 */
export function factMoveSet(facts: ExplanationFacts): Set<string> {
  const moves = new Set<string>([facts.bestMove.move])
  if (facts.userMove) moves.add(facts.userMove.move)
  for (const line of [facts.bestLine, facts.userLine]) {
    for (const ply of line?.plies ?? []) moves.add(ply.move)
  }
  for (const candidate of facts.candidates) moves.add(candidate.move)
  return moves
}

/** 著法是否在某條線中吃子／將軍（任何一條線都算）。 */
export function factMoveEvents(
  facts: ExplanationFacts
): Map<string, { captures: boolean; checks: boolean }> {
  const events = new Map<string, { captures: boolean; checks: boolean }>()
  for (const line of [facts.bestLine, facts.userLine]) {
    for (const ply of line?.plies ?? []) {
      const current = events.get(ply.move) ?? { captures: false, checks: false }
      events.set(ply.move, {
        captures: current.captures || ply.captured !== null,
        checks: current.checks || ply.givesCheck
      })
    }
  }
  return events
}

interface FactLabels {
  side: Record<PieceColor, string>
  /** 「黑卒」「Black pawn」：哪一方的哪個子。 */
  named: (side: string, piece: string) => string
  piece: Record<PieceColor, Record<PieceType, string>>
  descriptor: Record<PlyDescriptor, (piece: string) => string>
  noCapture: string
  noCheck: string
  check: string
  capture: (piece: string) => string
  threats: string
  protectedLabel: string
  unprotectedLabel: string
  toMove: string
  bestMove: string
  userMove: string
  gap: string
  pawns: string
  userIsBest: string
  bestLine: string
  userLine: string
  differences: string
  candidates: string
  evaluation: string
  checkmate: (side: string) => string
  stalemate: (side: string) => string
  noCaptures: (plies: number) => string
  firstCapture: (line: string, ply: number, side: string, piece: string, captured: string, other: string) => string
  otherCapture: (at: number | null) => string
  firstCheck: (line: string, ply: number, side: string, other: string) => string
  otherCheck: (at: number | null) => string
  material: (best: string, user: string) => string
  capturesNone: string
  capturesOf: (side: string, pieces: string) => string
  bestLineName: string
  userLineName: string
  truncatedNote: string
}

const PIECES_TW: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帥', advisor: '仕', elephant: '相', horse: '馬', rook: '車', cannon: '炮', pawn: '兵' },
  black: { king: '將', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '炮', pawn: '卒' }
}
const PIECES_CN: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒' }
}
const PIECES_EN: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: 'king', advisor: 'advisor', elephant: 'elephant', horse: 'horse', rook: 'rook', cannon: 'cannon', pawn: 'pawn' },
  black: { king: 'king', advisor: 'advisor', elephant: 'elephant', horse: 'horse', rook: 'rook', cannon: 'cannon', pawn: 'pawn' }
}

const LABELS: Record<ExplanationLanguage, FactLabels> = {
  'zh-TW': {
    side: { red: '紅', black: '黑' },
    named: (side, piece) => `${side}${piece}`,
    piece: PIECES_TW,
    descriptor: {
      enters_center: (piece) => `${piece}進入中路`,
      rook_develops: () => '出車',
      horse_develops: () => '跳馬出動',
      pawn_crosses_river: (piece) => `${piece}過河`,
      king_moves: (piece) => `${piece}移動`
    },
    noCapture: '未吃子',
    noCheck: '未將軍',
    check: '將軍',
    capture: (piece) => `吃${piece}`,
    threats: '走後可吃',
    protectedLabel: '有保護',
    unprotectedLabel: '無保護',
    toMove: '輪到',
    bestMove: '引擎首選',
    userMove: '棋手著法',
    gap: '差距',
    pawns: '兵',
    userIsBest: '棋手的著法就是引擎首選。',
    bestLine: '首選主線',
    userLine: '棋手著法之後的主線',
    differences: '兩線差異',
    candidates: '其他候選',
    evaluation: '評估',
    checkmate: (side) => `主線結束時${side}方無合法著法且被將軍：將死。`,
    stalemate: (side) => `主線結束時${side}方無子可動：困斃（象棋規則判${side}方負）。`,
    noCaptures: (plies) => `兩線前 ${plies} 手都沒有吃子。`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `${line}第 ${ply} 手${side}${piece}吃${captured}${other}。`,
    otherCapture: (at) => (at === null ? '，另一條線沒有吃子' : `，另一條線第 ${at} 手才有吃子`),
    firstCheck: (line, ply, side, other) => `${line}第 ${ply} 手${side}方先將軍${other}。`,
    otherCheck: (at) => (at === null ? '，另一條線沒有將軍' : `，另一條線第 ${at} 手才將軍`),
    material: (best, user) => `吃子結果：首選線${best}；實戰線${user}。`,
    capturesNone: '雙方都沒有吃子',
    capturesOf: (side, pieces) => `${side}方吃掉${pieces}`,
    bestLineName: '首選線',
    userLineName: '實戰線',
    truncatedNote: '（主線只列出部分手數）'
  },
  'zh-CN': {
    side: { red: '红', black: '黑' },
    named: (side, piece) => `${side}${piece}`,
    piece: PIECES_CN,
    descriptor: {
      enters_center: (piece) => `${piece}进入中路`,
      rook_develops: () => '出车',
      horse_develops: () => '跳马出动',
      pawn_crosses_river: (piece) => `${piece}过河`,
      king_moves: (piece) => `${piece}移动`
    },
    noCapture: '未吃子',
    noCheck: '未将军',
    check: '将军',
    capture: (piece) => `吃${piece}`,
    threats: '走后可吃',
    protectedLabel: '有保护',
    unprotectedLabel: '无保护',
    toMove: '轮到',
    bestMove: '引擎首选',
    userMove: '棋手着法',
    gap: '差距',
    pawns: '兵',
    userIsBest: '棋手的着法就是引擎首选。',
    bestLine: '首选主线',
    userLine: '棋手着法之后的主线',
    differences: '两线差异',
    candidates: '其他候选',
    evaluation: '评估',
    checkmate: (side) => `主线结束时${side}方无合法着法且被将军：将死。`,
    stalemate: (side) => `主线结束时${side}方无子可动：困毙（象棋规则判${side}方负）。`,
    noCaptures: (plies) => `两线前 ${plies} 手都没有吃子。`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `${line}第 ${ply} 手${side}${piece}吃${captured}${other}。`,
    otherCapture: (at) => (at === null ? '，另一条线没有吃子' : `，另一条线第 ${at} 手才有吃子`),
    firstCheck: (line, ply, side, other) => `${line}第 ${ply} 手${side}方先将军${other}。`,
    otherCheck: (at) => (at === null ? '，另一条线没有将军' : `，另一条线第 ${at} 手才将军`),
    material: (best, user) => `吃子结果：首选线${best}；实战线${user}。`,
    capturesNone: '双方都没有吃子',
    capturesOf: (side, pieces) => `${side}方吃掉${pieces}`,
    bestLineName: '首选线',
    userLineName: '实战线',
    truncatedNote: '（主线只列出部分手数）'
  },
  en: {
    side: { red: 'Red', black: 'Black' },
    named: (side, piece) => `${side} ${piece}`,
    piece: PIECES_EN,
    descriptor: {
      enters_center: (piece) => `${piece} moves to the central file`,
      rook_develops: () => 'rook develops',
      horse_develops: () => 'horse develops',
      pawn_crosses_river: (piece) => `${piece} crosses the river`,
      king_moves: (piece) => `${piece} moves`
    },
    noCapture: 'no capture',
    noCheck: 'no check',
    check: 'check',
    capture: (piece) => `captures ${piece}`,
    threats: 'can then capture',
    protectedLabel: 'protected',
    unprotectedLabel: 'unprotected',
    toMove: 'To move',
    bestMove: 'Engine best move',
    userMove: "Player's move",
    gap: 'Gap',
    pawns: 'pawns',
    userIsBest: "The player's move is the engine's best move.",
    bestLine: 'Best line',
    userLine: "Line after the player's move",
    differences: 'Differences',
    candidates: 'Other candidates',
    evaluation: 'eval',
    checkmate: (side) => `At the end of the line ${side} has no legal move and is in check: checkmate.`,
    stalemate: (side) => `At the end of the line ${side} has no legal move: stalemate (a loss for ${side}).`,
    noCaptures: (plies) => `Neither line captures anything in the first ${plies} plies.`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `In the ${line}, ply ${ply}: ${side} ${piece} captures ${captured}${other}.`,
    otherCapture: (at) => (at === null ? '; the other line has no capture' : `; the other line first captures at ply ${at}`),
    firstCheck: (line, ply, side, other) => `In the ${line}, ${side} gives check first at ply ${ply}${other}.`,
    otherCheck: (at) => (at === null ? '; the other line has no check' : `; the other line first checks at ply ${at}`),
    material: (best, user) => `Captures: best line ${best}; player's line ${user}.`,
    capturesNone: 'no captures by either side',
    capturesOf: (side, pieces) => `${side} captured ${pieces}`,
    bestLineName: 'best line',
    userLineName: "player's line",
    truncatedNote: '(only part of the line is listed)'
  }
}

function capturesText(
  captures: Record<PieceColor, PieceType[]>,
  labels: FactLabels
): string {
  const parts = (['red', 'black'] as const)
    .filter((side) => captures[side].length > 0)
    .map((side) =>
      labels.capturesOf(
        labels.side[side],
        captures[side]
          .map((piece) => labels.named(labels.side[opponent(side)], labels.piece[opponent(side)][piece]))
          .join('、')
      )
    )
  return parts.length > 0 ? parts.join('；') : labels.capturesNone
}

function formatPly(ply: PlyFact, labels: FactLabels): string {
  const pieceName = labels.piece[ply.side][ply.piece]
  const parts: string[] = ply.descriptors.map((descriptor) => labels.descriptor[descriptor](pieceName))
  const enemy = opponent(ply.side)
  parts.push(
    ply.captured
      ? labels.capture(labels.named(labels.side[enemy], labels.piece[enemy][ply.captured]))
      : labels.noCapture
  )
  parts.push(ply.givesCheck ? labels.check : labels.noCheck)
  if (ply.threats.length > 0) {
    parts.push(
      `${labels.threats}：${ply.threats
        .map(
          (threat) =>
            `${labels.named(labels.side[threat.side], labels.piece[threat.side][threat.piece])}（${
              threat.protected ? labels.protectedLabel : labels.unprotectedLabel
            }）`
        )
        .join('、')}`
    )
  }
  return ` ${ply.ply}. ${labels.side[ply.side]} ${ply.move}：${parts.join('；')}`
}

function formatLine(
  title: string,
  line: LineFacts,
  labels: FactLabels,
  maxPlies: number
): string[] {
  const lines = [`${title}：`]
  for (const ply of line.plies.slice(0, maxPlies)) lines.push(formatPly(ply, labels))
  if (line.plies.length > maxPlies) lines.push(` ${labels.truncatedNote}`)
  if (line.warning) lines.push(` ${line.warning}`)
  const last = line.plies.at(-1)
  if (last && line.plies.length <= maxPlies) {
    const loser = labels.side[opponent(last.side)]
    if (line.endsWith === 'checkmate') lines.push(` ${labels.checkmate(loser)}`)
    if (line.endsWith === 'stalemate') lines.push(` ${labels.stalemate(loser)}`)
  }
  return lines
}

function formatDifference(difference: FactDifference, labels: FactLabels): string {
  switch (difference.kind) {
    case 'no_captures':
      return labels.noCaptures(difference.plies)
    case 'first_capture': {
      const enemy = opponent(difference.side)
      return labels.firstCapture(
        difference.line === 'best' ? labels.bestLineName : labels.userLineName,
        difference.ply,
        labels.side[difference.side],
        labels.piece[difference.side][difference.piece],
        labels.named(labels.side[enemy], labels.piece[enemy][difference.captured]),
        labels.otherCapture(difference.otherLineCaptureFirstAt)
      )
    }
    case 'first_check':
      return labels.firstCheck(
        difference.line === 'best' ? labels.bestLineName : labels.userLineName,
        difference.ply,
        labels.side[difference.side],
        labels.otherCheck(difference.otherLineCheckAt)
      )
    case 'material':
      return labels.material(capturesText(difference.best, labels), capturesText(difference.user, labels))
  }
}

function render(facts: ExplanationFacts, labels: FactLabels, maxPlies: number, language: ExplanationLanguage): string {
  const out: string[] = []
  out.push(`${labels.toMove}：${labels.side[facts.sideToMove]}${language === 'en' ? '' : '方'}`)
  const score = (move: MoveFact): string =>
    move.scoreText ? `（${labels.evaluation} ${move.scoreText}）` : ''
  const headline = [`${labels.bestMove}：${facts.bestMove.move}${score(facts.bestMove)}`]
  if (facts.userMove) headline.push(`${labels.userMove}：${facts.userMove.move}${score(facts.userMove)}`)
  if (facts.mistakeLevel || facts.scoreGapPawns !== undefined) {
    const level = facts.mistakeLevel
      ? language === 'en'
        ? facts.mistakeLevel.replace(/_/g, ' ')
        : MISTAKE_LEVEL_LABELS[facts.mistakeLevel]
      : ''
    const gap = facts.scoreGapPawns !== undefined ? `${facts.scoreGapPawns} ${labels.pawns}` : ''
    headline.push(`${labels.gap}：${[level, gap ? `（${gap}）` : ''].join('')}`)
  }
  out.push(headline.join('；'))
  if (facts.userIsBest) out.push(labels.userIsBest)
  out.push(...formatLine(labels.bestLine, facts.bestLine, labels, maxPlies))
  if (facts.userLine) out.push(...formatLine(labels.userLine, facts.userLine, labels, maxPlies))
  if (facts.differences.length > 0) {
    out.push(`${labels.differences}：`)
    for (const difference of facts.differences) out.push(` - ${formatDifference(difference, labels)}`)
  }
  const others = facts.candidates.filter(
    (candidate) => candidate.move !== facts.bestMove.move && candidate.move !== facts.userMove?.move
  )
  if (others.length > 0) {
    out.push(`${labels.candidates}：${others.map((candidate) => `${candidate.move}${score(candidate)}`).join('、')}`)
  }
  const text = out.join('\n')
  return language === 'en' ? toAsciiPunctuation(text) : text
}

/** 英文事實表改用半形標點，避免中英混排的全形冒號與括號。 */
function toAsciiPunctuation(text: string): string {
  return text
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/（/g, ' (')
    .replace(/）/g, ')')
    .replace(/、/g, ', ')
    .replace(/ +\n/g, '\n')
}

/** 給模型看的事實表文字；超過上限時逐步減少列出的手數。 */
export function formatFactsForPrompt(
  facts: ExplanationFacts,
  language: ExplanationLanguage = 'zh-TW'
): string {
  const labels = LABELS[language]
  let maxPlies = MAX_FACT_LINE_PLIES
  let text = render(facts, labels, maxPlies, language)
  while (text.length > MAX_FACTS_PROMPT_CHARS && maxPlies > 2) {
    maxPlies -= 2
    text = render(facts, labels, maxPlies, language)
  }
  return text.length > MAX_FACTS_PROMPT_CHARS ? text.slice(0, MAX_FACTS_PROMPT_CHARS) : text
}

/** 顯示用的單條主線（前 N 手）及其關鍵事件，供「引擎重點摘要」使用。 */
export function summarizeLine(
  line: LineFacts,
  language: ExplanationLanguage = 'zh-TW',
  maxPlies = 6
): { moves: string[]; events: string[] } {
  const labels = LABELS[language]
  const events: string[] = []
  for (const ply of line.plies.slice(0, maxPlies)) {
    const side = labels.side[ply.side]
    if (ply.captured) {
      const enemy = opponent(ply.side)
      events.push(
        language === 'en'
          ? `ply ${ply.ply}: ${side} ${labels.piece[ply.side][ply.piece]} captures ${labels.side[enemy]} ${labels.piece[enemy][ply.captured]}`
          : `第 ${ply.ply} 手${side}${labels.piece[ply.side][ply.piece]}吃${labels.side[enemy]}${labels.piece[enemy][ply.captured]}`
      )
    }
    if (ply.givesCheck) {
      events.push(language === 'en' ? `ply ${ply.ply}: ${side} gives check` : `第 ${ply.ply} 手${side}方${labels.check}`)
    }
  }
  if (line.endsWith && line.plies.length <= maxPlies) {
    const last = line.plies.at(-1)
    if (last) {
      const loser = labels.side[opponent(last.side)]
      events.push(line.endsWith === 'checkmate' ? labels.checkmate(loser) : labels.stalemate(loser))
    }
  }
  return { moves: line.plies.slice(0, maxPlies).map((ply) => ply.move), events }
}

export { formatDifference as formatFactDifference, LABELS as FACT_LABELS }
