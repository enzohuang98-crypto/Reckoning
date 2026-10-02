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

const CHINESE_PIECE_NAMES: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帥', advisor: '仕', elephant: '相', horse: '馬', rook: '車', cannon: '炮', pawn: '兵' },
  black: { king: '將', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '炮', pawn: '卒' }
}
const chineseSide = (side: PieceColor): string => side === 'red' ? '紅方' : '黑方'
const chinesePiece = (side: PieceColor, piece: PieceType): string =>
  `${chineseSide(side)}${CHINESE_PIECE_NAMES[side][piece]}`
const PIECE_TYPES = Object.keys(CHINESE_PIECE_NAMES.red) as PieceType[]
type PieceCounts = Record<PieceType, number>
const emptyPieceCounts = (): PieceCounts =>
  ({ king: 0, advisor: 0, elephant: 0, horse: 0, rook: 0, cannon: 0, pawn: 0 })

/** Counts only: no exchange values, score, strategy, or unprovided future moves. */
export interface VariationCaptureLedger {
  throughPly: number
  initialCounts: Record<PieceColor, PieceCounts>
  currentCounts: Record<PieceColor, PieceCounts>
  captured: Record<PieceColor, PieceCounts>
  lost: Record<PieceColor, PieceCounts>
  netCaptureChange: Record<PieceColor, PieceCounts>
  currentCountDifference: Record<PieceColor, PieceCounts>
  immediateRecaptures: { capturePly: number; recapturePly: number; square: string }[]
  warning: string | null
}

function captureLedger(positionFen: string, steps: readonly VariationStepFact[], warning: string | null): VariationCaptureLedger | null {
  const parsed = parseFen(positionFen)
  if (!parsed.valid) return null
  const initialCounts = { red: emptyPieceCounts(), black: emptyPieceCounts() }
  for (const row of parsed.board.grid) {
    for (const piece of row) if (piece) initialCounts[piece.color][piece.type] += 1
  }
  const currentCounts = { red: { ...initialCounts.red }, black: { ...initialCounts.black } }
  const captured = { red: emptyPieceCounts(), black: emptyPieceCounts() }
  const lost = { red: emptyPieceCounts(), black: emptyPieceCounts() }
  const immediateRecaptures: VariationCaptureLedger['immediateRecaptures'] = []
  for (const [index, step] of steps.entries()) {
    if (!step.captured) continue
    captured[step.side][step.captured.piece] += 1
    lost[step.captured.side][step.captured.piece] += 1
    currentCounts[step.captured.side][step.captured.piece] -= 1
    const previous = steps[index - 1]
    if (previous?.captured && previous.toSquare === step.toSquare &&
      step.captured.side === previous.side && step.captured.piece === previous.piece) {
      immediateRecaptures.push({ capturePly: previous.ply, recapturePly: step.ply, square: step.toSquare })
    }
  }
  const netCaptureChange = { red: emptyPieceCounts(), black: emptyPieceCounts() }
  const currentCountDifference = { red: emptyPieceCounts(), black: emptyPieceCounts() }
  for (const side of ['red', 'black'] as const) {
    const opponent = side === 'red' ? 'black' : 'red'
    for (const piece of PIECE_TYPES) {
      netCaptureChange[side][piece] = captured[side][piece] - lost[side][piece]
      currentCountDifference[side][piece] = currentCounts[side][piece] - currentCounts[opponent][piece]
    }
  }
  return { throughPly: steps.at(-1)?.ply ?? 0, initialCounts, currentCounts, captured, lost,
    netCaptureChange, currentCountDifference, immediateRecaptures, warning }
}

/** An explicit ply can inspect a verified prefix even if the supplied tail fails replay. */
export function buildVariationCaptureLedger(evidence: HarnessEvidence, throughPly?: number): VariationCaptureLedger | null {
  const facts = buildVariationBoardFacts(evidence)
  if (throughPly !== undefined && (!Number.isInteger(throughPly) || throughPly < 1 || throughPly > facts.steps.length)) return null
  return captureLedger(evidence.positionFen, facts.steps.slice(0, throughPly), facts.warning)
}

// Canonical decimal/Chinese counts only; do not interpret rounds, side-relative
// move numbers, omitted units such as 一百二, or financial/colloquial shorthand.
function explicitBoardCount(token: string): number | null {
  if (/^[0-9]+$/.test(token)) {
    const value = Number(token)
    return Number.isSafeInteger(value) && value <= VARIATION_BOARD_FACT_MAX_PLIES ? value : null
  }
  const digits = '零一二三四五六七八九'
  const number = /^(?:([一二三四五六七八九])百(?:零([一二三四五六七八九])|([一二三四五六七八九])十([一二三四五六七八九])?)?|([一二三四五六七八九])?十([一二三四五六七八九])?|([零一二三四五六七八九]))$/.exec(token)
  if (!number) return null
  const digit = (value: string | undefined): number => value ? digits.indexOf(value) : 0
  const value = number[1] ? digit(number[1]) * 100 + digit(number[2]) + digit(number[3]) * 10 + digit(number[4])
    : number[7] ? digit(number[7]) : (number[5] ? digit(number[5]) : 1) * 10 + digit(number[6])
  return value <= VARIATION_BOARD_FACT_MAX_PLIES ? value : null
}

/**
 * A pure per-step prompt projection; replay and validation retain typed facts.
 * The caller describes the fixed-board, hypothetical next-own-turn opportunity
 * scope once in the prompt, rather than repeating it for every step.
 */
export function modelFacingVariationStep(step: VariationStepFact):
  Omit<VariationStepFact, 'captured' | 'givesCheck' | 'movedPieceCaptureTargets'> & {
    actualCapture: string
    actualCheck: string
    captureOpportunities: { square: string; piece: string }[]
  } {
  const { captured, givesCheck, movedPieceCaptureTargets, ...identity } = step
  return {
    ...identity,
    actualCapture: captured ? `本手吃掉${chinesePiece(captured.side, captured.piece)}。` : '本手未吃子。',
    actualCheck: givesCheck ? '本手已將軍。' : '本手未將軍。',
    captureOpportunities: movedPieceCaptureTargets.map((target) => ({
      square: target.square, piece: chinesePiece(target.side, target.piece)
    }))
  }
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
 * Capture and same-type count observations for prompt input, never weighted
 * material values or a strategic verdict.
 * Shared categories mean the same captured side/type, not the same piece.
 * Only verified prefixes from exactly the same starting FEN are compared.
 */
export function summarizeVariationCaptures(evidence: readonly HarnessEvidence[]): string[] {
  if (evidence.length === 0) return []
  const summaries = [
    `吃子摘要只涵蓋各變例最多前 ${VARIATION_BOARD_FACT_MAX_PLIES} 手的已重播前綴，不是終局子力或優劣判定。第N手僅指本變例從起始FEN起算的一基手序，不是棋譜回合或某方第N步。共同事件只比較被吃方與棋子類別，不表示同一枚棋子。`
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
    const ledger = facts.steps.length > 0 ? captureLedger(item.positionFen, facts.steps, facts.warning) : null
    if (ledger) {
      const counts = (tally: PieceCounts, side: PieceColor, includeZero = false): string =>
        PIECE_TYPES.filter((piece) => includeZero || tally[piece] !== 0)
          .map((piece) => `${CHINESE_PIECE_NAMES[side][piece]}${tally[piece]}枚`).join('、') || '0枚'
      for (const side of ['red', 'black'] as const) {
        const opponent = side === 'red' ? 'black' : 'red'
        summaries.push(`${item.id} 截至第 ${ledger.throughPly} 手${chineseSide(side)}棋子帳本：起始${counts(ledger.initialCounts[side], side, true)}；目前${counts(ledger.currentCounts[side], side, true)}；吃到${chineseSide(opponent)}${counts(ledger.captured[side], opponent)}；己方損失${counts(ledger.lost[side], side)}；目前同類子數差（己方減對方）${counts(ledger.currentCountDifference[side], side, true)}。數差不是棋子價值或整體優劣，不能把吃到數當成淨多數。`)
      }
      for (const pair of ledger.immediateRecaptures) {
        const first = facts.steps[pair.capturePly - 1]!
        const reply = facts.steps[pair.recapturePly - 1]!
        summaries.push(`${item.id} 第 ${pair.capturePly}、${pair.recapturePly} 手在 ${pair.square} 立即吃回：${chinesePiece(first.side, first.piece)}先吃${chinesePiece(first.captured!.side, first.captured!.piece)}，${chinesePiece(reply.side, reply.piece)}隨即吃掉剛到該格的${chinesePiece(first.side, first.piece)}。雙方損失已計入帳本，不能單看後一手吃子。`)
      }
    }
    for (const step of captures) {
      const captured = step.captured!
      summaries.push(`${item.id} 第 ${step.ply} 手：${chinesePiece(step.side, step.piece)}走${step.move}，吃掉${chinesePiece(captured.side, captured.piece)}。`)
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
      summaries.push(`相同起始局面的已重播前綴共同出現被吃${chinesePiece(captured.side, captured.piece)}：${locations}。不能據此稱為某一條變例獨有的損失，也不能據此判定走法優劣。`)
    }
  }
  return summaries
}

/**
 * A bounded check for explicit capture/check statements attached to a literal
 * PV move, and numerical same-type counts scoped to a verified replay prefix.
 * This does not certify strategy, threats, or arbitrary natural language.
 * Only this claim's cited variations are replayed; ambiguous move identities
 * cannot establish a capture/check or numerical material-count statement.
 */
export function validateVariationBoardStatements(
  text: string,
  evidence: HarnessEvidence[]
): string[] {
  return inspectVariationBoardStatements(text, evidence).issues
}

/**
 * True only for an affirmative capture, check, or current capture opportunity
 * explicitly matched to this claim's cited replay. Capture relations must name
 * a target piece or square; denials, deployment, and strategy are not proofs of
 * a concrete relation. Any detected board-statement error vetoes the result.
 * This establishes the relation's concreteness, never the rest of the prose's
 * strategic conclusions or facts outside the bounded literal-move parser.
 */
export function hasAffirmedConcreteVariationRelation(
  text: string,
  evidence: HarnessEvidence[]
): boolean {
  const inspection = inspectVariationBoardStatements(text, evidence)
  return inspection.affirmations > 0 && inspection.issues.length === 0 && !inspection.unboundPredicates
}

function inspectVariationBoardStatements(
  text: string,
  evidence: HarnessEvidence[]
): { issues: string[]; affirmations: number; unboundPredicates: boolean } {
  const issues: string[] = []
  let affirmations = 0
  let unboundPredicates = false
  const capturePattern = /((?:(?:沒有|没有|未|不|非)(?:是)?(?:直接|立即|立刻)?)?(?:吃掉|吃去|吃子|吃))(?:了)?(?:一[個枚]?|一顆)?(?:(紅方|红方|黑方|紅|红|黑))?([a-i][0-9])?([兵卒車车炮砲馬马象相士仕將将帥帅])?/g
  const checkPattern = /((?:(?:沒有|没有|未|不|非)(?:是)?(?:直接|立即|立刻)?)?)(?:形成|構成|构成)?(?:將軍|将军)/g
  // Discover assertions before looking up their evidence. A whitelist matcher
  // would silently discard invented moves, rather than reject unbound facts.
  // Keep each replay separate: temporally related moves must share this variation
  // and its starting FEN, never borrow their neighbours from another line.
  const replays = evidence.map((item) => ({ item, ...buildVariationBoardFacts(item) }))
  const textMentions = chineseMoveMentions(text)
  const mentionIndices = new Map(textMentions.map((mention, index) => [mention.index, index]))
  const moveBindings = new Map<number, { replay: typeof replays[number]; step: VariationStepFact }[]>()
  const movePredicatePrefixes = new Map<number, string>()
  // Parse each explicit cutoff once, independently of intervening predicates.
  // It remains active through the sentence, until another clause-leading
  // cutoff replaces it. A malformed/unsupported declaration remains invalid;
  // neither move binding nor count validation may fall back past it.
  const snapshots: { start: number; end: number; ply: number | null; valid: boolean }[] = []
  let sentenceOffset = 0
  for (const sentence of text.split(/(?<=[。！？；.!?;\r\n])/)) {
    for (const marker of sentence.matchAll(/截至|到\s*第/g)) {
      const declaration = /^(?:截至|到)\s*第\s*([0-9零一二三四五六七八九十百]+)\s*(手|步|回合)(?:後|后)?/.exec(sentence.slice(marker.index))
      const ply = declaration ? explicitBoardCount(declaration[1]!) : null
      const clauseStart = Math.max(sentence.lastIndexOf('，', marker.index), sentence.lastIndexOf(',', marker.index)) + 1
      const remainder = declaration ? sentence.slice(marker.index! + declaration[0].length).trimStart() : ''
      const valid = Boolean(declaration && declaration[2] === '手' && ply !== null && ply > 0 &&
        !/^(?:之前|以前|前)/.test(remainder) && !/\S/.test(sentence.slice(clauseStart, marker.index)) &&
        replays.length > 0 && replays.every((replay) => replay.steps[ply! - 1]) &&
        new Set(replays.map((replay) => replay.item.positionFen)).size === 1)
      snapshots.push({ start: sentenceOffset + marker.index!, end: sentenceOffset + sentence.length, ply, valid })
    }
    sentenceOffset += sentence.length
  }
  const snapshotAt = (index: number): typeof snapshots[number] | undefined =>
    snapshots.filter((snapshot) => snapshot.start <= index && index < snapshot.end).at(-1)
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
  const isHedged = (prefix: string): boolean =>
    /未必|不一定|或許|或许|也許|也许|似乎|大概/.test(predicateScope(prefix))
  const literalListGap = /^\s*[」』”"'’]?\s*、\s*[「『“"'‘]?\s*$/
  // 後/然後/接著 establish order, not adjacency. Only an explicit immediate
  // connector requires the next replay ply. 前 reverses the order. The entire
  // local gap must match; comparisons and remote narrative supply no anchor.
  const temporalGap = /^\s*[」』”"'’]?\s*(?:(之?[後后前])\s*[，,]?\s*(隨即|随即|下一手|緊接著|紧接着|緊接|紧接|接著|接着|然後|然后)?|[，,]?\s*(隨即|随即|下一手|緊接著|紧接着|緊接|紧接|接著|接着|然後|然后))\s*((?:第\s*[0-9零一二三四五六七八九十百]+\s*(?:手|步|回合)\s*)?(?:(?:紅方|红方|黑方|紅|红|黑)(?:以|走|先走|再走|接著走|接着走|選擇|选择)?)?\s*[「『“"'‘]?\s*)$/
  const temporalRelation = (gap: string): { before: boolean; immediate: boolean; prefix: string; valid: boolean } | null => {
    if (/[。！？；.!?;\r\n]/.test(gap)) return null
    const match = temporalGap.exec(gap)
    if (!match) return null
    const before = match[1]?.endsWith('前') ?? false
    const connector = match[2] ?? match[3] ?? ''
    return { before, immediate: /隨即|随即|下一手|緊接|紧接/.test(connector), prefix: match[4]!, valid: !(before && connector) }
  }
  const links = textMentions.slice(1).flatMap((right, index) => {
    const left = textMentions[index]!
    const gap = text.slice(left.index + left.move.length, right.index)
    let relation = temporalRelation(gap)
    // A capture/check predicate stays attached to the earlier move. Its next
    // comma clause can still state chronology, without using that predicate
    // or its target to choose a replay occurrence.
    if (!relation && !/[。！？；.!?;\r\n]/.test(gap)) {
      const comma = gap.search(/[，,]/)
      if (comma >= 0 && ([...gap.slice(0, comma).matchAll(capturePattern)].length > 0 ||
        [...gap.slice(0, comma).matchAll(checkPattern)].length > 0)) relation = temporalRelation(gap.slice(comma))
    }
    return relation ? [{ left: index, right: index + 1, ...relation }] : []
  })
  const localPrefixes = textMentions.map((mention, index) => {
    const previous = textMentions[index - 1]
    const clauseStart = text.slice(0, mention.index).search(/[^。！？；，,.!?;\r\n]*$/)
    const start = Math.max(previous ? previous.index + previous.move.length : 0, clauseStart)
    return links.find((link) => link.right === index)?.prefix ?? text.slice(start, mention.index)
  })
  // Resolve identity before inspecting predicates: ordinals, cutoffs and actor
  // declarations constrain temporal anchors as well as the asserted move.
  const temporalBindings = textMentions.map((mention, index) => {
    const prefix = localPrefixes[index]!
    const ordinal = /^\s*(?:在|本變例(?:的)?)?第\s*([0-9零一二三四五六七八九十百]+)\s*手\s*(?:(?:紅方|红方|黑方|紅|红|黑)(?:以|走)?)?\s*[「『“"'‘]?\s*$/.exec(prefix)
    const qualified = /^\s*(?:在|本變例(?:的)?|紅方|红方|黑方|紅|红|黑)?第/.test(prefix)
    const ply = ordinal ? explicitBoardCount(ordinal[1]!) : null
    const snapshot = snapshotAt(mention.index)
    return replays.flatMap((replay) => replay.steps.flatMap((step) =>
      canonicalChineseMoveNotation(step.move) === canonicalChineseMoveNotation(mention.move) &&
      (!snapshot || (snapshot.valid && step.ply <= snapshot.ply!)) &&
      (!qualified || (ply !== null && ply > 0 && step.ply === ply)) ? [{ replay, step }] : []))
  })
  const temporalActors = localPrefixes.map((prefix) =>
    /(紅方|红方|黑方|紅|红|黑)(?:以|走|先走|再走|接著走|接着走|選擇|选择)?\s*[「『“"'‘]?\s*$/.exec(prefix)?.[1])
  // The local links form a chain. Pruning in both directions preserves every
  // compatible occurrence, so a repeated name remains ambiguous when order
  // alone cannot resolve it. No capture outcome participates in this choice.
  let changed = true
  while (changed) {
    changed = false
    for (const link of links) {
      const compatible = (left: typeof temporalBindings[number][number], right: typeof left): boolean => {
        const distance = link.before ? left.step.ply - right.step.ply : right.step.ply - left.step.ply
        return link.valid && left.replay === right.replay && distance > 0 && (!link.immediate || distance === 1) &&
          (!temporalActors[link.left] || sideOf(temporalActors[link.left]!) === left.step.side) &&
          (!temporalActors[link.right] || sideOf(temporalActors[link.right]!) === right.step.side)
      }
      const left = temporalBindings[link.left]!.filter((candidate) => temporalBindings[link.right]!.some((other) => compatible(candidate, other)))
      const right = temporalBindings[link.right]!.filter((candidate) => left.some((other) => compatible(other, candidate)))
      if (left.length !== temporalBindings[link.left]!.length || right.length !== temporalBindings[link.right]!.length) changed = true
      temporalBindings[link.left] = left
      temporalBindings[link.right] = right
    }
  }
  let segmentStart = 0
  for (const segment of text.split(/(?<=[。！？；，,.!?;\n])/)) {
    const clauseStart = segmentStart
    segmentStart += segment.length
    const clause = segment.replace(/[。！？；，,.!?;\n]+$/, '')
    const affirmativeClause = !/[？?]/.test(segment) &&
      !/可否|會不會|会不会|有沒有|有没有|嗎|吗/.test(clause)
    const mentions = chineseMoveMentions(clause)
    // A proven predicate elsewhere cannot certify an omitted-move assertion.
    // Keep validation's existing scope, but fail the concreteness helper closed
    // rather than inventing which prior move a separate clause refers to.
    if (mentions.length === 0 &&
      ([...clause.matchAll(capturePattern)].length > 0 || [...clause.matchAll(checkPattern)].length > 0)) {
      unboundPredicates = true
    }
    let listActor: { side: PieceColor; prefix: string } | null = null
    for (const [index, mention] of mentions.entries()) {
      const move = mention.move
      const before = clause.slice(index === 0 ? 0 : mentions[index - 1]!.index + mentions[index - 1]!.move.length, mention.index)
      const after = clause.slice(mention.index + move.length, mentions[index + 1]?.index ?? clause.length)
      const textIndex = mentionIndices.get(clauseStart + mention.index)!
      const previousMention = textMentions[textIndex - 1]
      const precedingLink = links.find((link) => link.right === textIndex)
      const temporalContext = precedingLink || links.some((link) => link.left === textIndex)
      // Chronology also carries a local conditional/hedge: "if A, then B"
      // cannot turn B into an affirmative fact just because a comma intervenes.
      const predicateBefore = precedingLink
        ? (text.slice(0, previousMention!.index).split(/[。！？；，,.!?;\n]/).at(-1) ?? '') + before
        : before
      const explicitActor = /(紅方|红方|黑方|紅|红|黑)(?:以|走|先走|再走|接著走|接着走|選擇|选择)?\s*[「『“"'‘]?\s*$/.exec(before)
      // Only adjacent literal list members inherit an actor. Narrative and
      // comparison words break the list; a named next actor starts a new one.
      const isListMember = index > 0 && literalListGap.test(before)
      let lastMember = index
      while (mentions[lastMember + 1] && literalListGap.test(clause.slice(
        mentions[lastMember]!.index + mentions[lastMember]!.move.length,
        mentions[lastMember + 1]!.index))) lastMember += 1
      const listTail = clause.slice(mentions[lastMember]!.index + mentions[lastMember]!.move.length)
      const comparisonObjects = /^[」』”"'’]?\s*(?:作|做|進行|进行)?(?:比較|比较|對照|对照)/.test(listTail)
      listActor = comparisonObjects ? null : explicitActor
        ? { side: sideOf(explicitActor[1]!), prefix: before }
        : isListMember ? listActor : null
      const side = listActor?.side
      // A local denial may govern a literal predicate list: 未發生吃子或將軍.
      // Resolve its scope across both event kinds, then still compare each
      // denied event with the replay. A new assertion cannot borrow the denial.
      const predicateDenials = new Map<number, boolean>()
      let previousPredicateEnd = 0
      let previousPredicateDenied = false
      const eventPredicates = [...after.matchAll(capturePattern), ...after.matchAll(checkPattern)]
        .sort((a, b) => a.index! - b.index!)
      for (const predicate of eventPredicates) {
        const gap = after.slice(previousPredicateEnd, predicate.index)
        const denied: boolean = /^(?:沒有|没有|未|不|非)/.test(predicate[0])
          || /(?:沒有|没有|未|不|非)\s*(?:發生|发生|形成|構成|构成)\s*$/.test(gap)
          || (previousPredicateDenied && /^(?:\s*(?:或(?:者|是)?|和|與|与|及|、)\s*)+$/.test(gap))
        predicateDenials.set(predicate.index!, denied)
        previousPredicateEnd = predicate.index! + predicate[0].length
        previousPredicateDenied = denied
      }
      const captures = [...after.matchAll(capturePattern)]
        .flatMap((match) => {
          const prefix = predicateBefore + after.slice(0, match.index)
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
            : predicateDenials.get(match.index!) === true
          return [{ match, opportunity, denied }]
        })
      const checks = [...after.matchAll(checkPattern)]
        .filter((match) => !isHypothetical(predicateBefore + after.slice(0, match.index)))
      const bindings = temporalBindings[textIndex]!
      moveBindings.set(clauseStart + mention.index, bindings)
      movePredicatePrefixes.set(clauseStart + mention.index, predicateBefore)
      if (!side && captures.length === 0 && checks.length === 0 && !temporalContext) continue
      const candidates = bindings.map((binding) => binding.step)
      const fact = candidates[0]
      if (!fact) {
        if (captures.length > 0 || checks.length > 0 || (!isHypothetical(predicateBefore) && (side || temporalContext))) {
          issues.push(`棋盤事實：${move} 的引用缺少可重播或無歧義的吃子／將軍事實。`)
        }
        continue
      }
      if (side && candidates.some((candidate) => side !== candidate.side)) {
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
        } else if (affirmativeClause && !denied && (capture[3] || capture[4]) &&
          !isHedged(predicateBefore + after.slice(0, capture.index))) {
          affirmations += 1
        }
      }
      for (const check of checks) {
        const denied = predicateDenials.get(check.index!) === true
        if (new Set(candidates.map((candidate) => candidate.givesCheck)).size !== 1) {
          issues.push(`棋盤事實：${move} 在引用變例的不同步數有不同將軍結果，必須指明所述步數。`)
        } else if (denied ? fact.givesCheck : !fact.givesCheck) {
          issues.push(`棋盤事實：${move} 的將軍斷言與逐手棋盤不一致。`)
        } else if (affirmativeClause && !denied && !isHedged(predicateBefore + after.slice(0, check.index))) {
          affirmations += 1
        }
      }
    }
  }
  // Numerical same-type material statements use the current board count, not
  // capture totals or weighted values. A local literal move scopes the count
  // through that exact ply; otherwise require an explicit prefix or one fully
  // replayed cited line. Never pick whichever line matches the claimed number.
  const netCountPattern = /(?:(紅方|红方|黑方|紅|红|黑)\s*)?(淨多|净多|淨少|净少|淨賺|净赚)\s*([0-9零一二三四五六七八九十百]+)\s*(?:枚|個|个|顆|颗)?\s*([兵卒車车炮砲馬马象相士仕將将帥帅])/g
  for (const net of text.matchAll(netCountPattern)) {
    const sentencePrefix = text.slice(0, net.index).split(/[。！？；.!?;\r\n]/).at(-1) ?? ''
    const clausePrefix = sentencePrefix.split(/[，,]/).at(-1) ?? ''
    const sentenceStart = net.index! - sentencePrefix.length
    const priorMove = textMentions.filter((mention) => mention.index >= sentenceStart && mention.index < net.index!).at(-1)
    const localMovePrefix = priorMove && text.slice(priorMove.index + priorMove.move.length, net.index).split(/[，,]/).length <= 2
      ? movePredicatePrefixes.get(priorMove.index) ?? '' : ''
    if (isHypothetical(localMovePrefix + clausePrefix)) continue
    // "Cannot count X as [a net gain]" mentions a rejected interpretation;
    // it does not assert either that number or its arithmetic inverse. Keep
    // this frame local: a contrast or new coordinated assertion ends it.
    const interpretationPrefix = predicateScope(clausePrefix)
    if (/(?:不能|不可|不應|不应|不要|無法|无法)(?:只|僅|仅)?(?:(?:把|將|将)(?:(?!並|并|而且)[^，,。！？；.!?;\r\n])*)?(?:算成|視為|视为|稱為|称为)\s*[「『“"'‘]?\s*$/.test(interpretationPrefix)) continue
    if (/淨賺|净赚/.test(net[2]!)) {
      issues.push('棋盤事實：數量收益須明示目前同類棋子數差，不能以淨賺替代棋子帳本。')
      continue
    }
    const count = explicitBoardCount(net[3]!)
    const explicitSide = net[1] ?? /(紅方|红方|黑方|紅|红|黑)\s*(?:並非|并非|不是|沒有|没有|未|不)\s*$/.exec(clausePrefix)?.[1]
    const snapshot = snapshotAt(net.index!)
    const priorBindings = priorMove ? moveBindings.get(priorMove.index) ?? [] : []
    const scopes = snapshot
      ? snapshot.valid ? replays.map((replay) => ({ replay, step: replay.steps[snapshot.ply! - 1]! })) : []
      : priorMove ? priorBindings
        : replays.length === 1 && explicitSide && replays[0]!.warning === null && replays[0]!.steps.length > 0
          ? [{ replay: replays[0]!, step: replays[0]!.steps.at(-1)! }] : []
    const sides = explicitSide ? new Set([sideOf(explicitSide)]) : new Set(priorBindings.map((binding) => binding.step.side))
    const fens = new Set(scopes.map((scope) => scope.replay.item.positionFen))
    if (count === null || scopes.length === 0 || (!explicitSide && !priorMove) || sides.size !== 1 || fens.size !== 1 ||
      (snapshot && (!snapshot.valid || scopes.length !== replays.length))) {
      issues.push('棋盤事實：淨多／淨少數量缺少同一起始局面、明確方別及可重播的步數範圍。')
      continue
    }
    const side = [...sides][0]!
    const piece = pieceTypes[net[4]!]!
    const balances = new Set(scopes.map(({ replay, step }) => {
      const ledger = captureLedger(replay.item.positionFen, replay.steps.slice(0, step.ply), replay.warning)!
      return ledger.currentCountDifference[side][piece]
    }))
    const expected = /淨少|净少/.test(net[2]!) ? -count : count
    const denied = /(?:並非|并非|不是|沒有|没有|未|不)\s*$/.test(clausePrefix)
    if (balances.size !== 1) {
      issues.push('棋盤事實：引用變例在所述範圍的同類棋子數差不同，不能合併為一個淨多／淨少數量。')
    } else if (denied ? [...balances][0] === expected : [...balances][0] !== expected) {
      issues.push(`棋盤事實：${net[0]} 與所述重播範圍目前紅黑同類棋子數差不一致。`)
    }
  }
  return { issues: [...new Set(issues)], affirmations, unboundPredicates }
}
