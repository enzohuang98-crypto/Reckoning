import type { BoardState, Piece, PieceColor, PieceType } from '../../types/BoardState'
import type {
  DualEngineComparison,
  DualEngineDisagreementReason,
  DualEngineMoveAssessment,
  EngineMoveView,
  HumanControlIndicators,
  VariationPlyFact
} from '../../types/DualEngine'
import type {
  EngineAnalysis,
  EngineCandidateMove,
  EngineScore
} from '../../types/EngineAnalysis'
import { parseFen } from '../board/fen'
import { applyUciMove, isKingInCheck, parseUciMove } from '../board/moves'

/** EngineScore.comparableValue 的單位是兵，不是 centipawn。 */
export const DUAL_ENGINE_SCORE_GAP_PAWNS = 1.5
export const DUAL_ENGINE_SIGN_CONFLICT_MIN_PAWNS = 0.5
const NEAR_BEST_WINDOW_PAWNS = 0.3

const PIECE_LABEL: Record<PieceType, string> = {
  king: '將帥',
  advisor: '士仕',
  elephant: '象相',
  horse: '馬',
  rook: '車',
  cannon: '炮',
  pawn: '兵卒'
}

function scoreValue(score: EngineScore | null): number | null {
  return score && Number.isFinite(score.comparableValue)
    ? score.comparableValue
    : null
}

function candidateForMove(
  analysis: EngineAnalysis,
  move: string
): EngineCandidateMove | undefined {
  return analysis.candidateMoves.find((candidate) => candidate.move === move)
}

function moveView(analysis: EngineAnalysis, move: string): EngineMoveView {
  if (analysis.bestMove === move) {
    return {
      engineId: analysis.engineId ?? analysis.engineName,
      engineName: analysis.engineName,
      rank: 1,
      score: analysis.scoreAfterBestMove,
      displayPrincipalVariation:
        analysis.displayPrincipalVariation ?? analysis.principalVariation
    }
  }
  const candidate = candidateForMove(analysis, move)
  return {
    engineId: analysis.engineId ?? analysis.engineName,
    engineName: analysis.engineName,
    rank: candidate
      ? analysis.candidateMoves.findIndex((item) => item.move === move) + 1
      : null,
    score: candidate?.score ?? null,
    displayPrincipalVariation:
      candidate?.displayPrincipalVariation ?? candidate?.principalVariation ?? []
  }
}

function destinationZone(row: number, col: number): string {
  if (col >= 3 && col <= 5 && (row <= 2 || row >= 7)) return '九宮'
  if (col === 4) return '中路'
  if (col === 3 || col === 5) return '肋道'
  if (col === 0 || col === 8) return '邊線'
  if (row === 4 || row === 5) return '河界'
  if (row === 0 || row === 9) return '底線'
  return '一般區域'
}

function hasCrossedRiver(color: PieceColor, row: number): boolean {
  return color === 'red' ? row <= 4 : row >= 5
}

function positionalTerms(
  piece: Piece,
  row: number,
  col: number,
  givesCheck: boolean,
  captured: Piece | null
): string[] {
  const terms = new Set<string>()
  if (givesCheck) terms.add('將軍')
  if (captured) terms.add('吃子')
  if (col === 4) terms.add('中路')
  if (col === 3 || col === 5) terms.add('肋道')
  if (row === 4 || row === 5) terms.add('巡河／騎河')
  if (piece.type === 'pawn' && hasCrossedRiver(piece.color, row)) {
    terms.add('過河兵')
  }
  if (piece.type === 'rook') {
    const enemyBackRank = piece.color === 'red' ? 0 : 9
    if (row === enemyBackRank) terms.add('沉底車')
    else terms.add('車線活動')
  }
  if (piece.type === 'cannon') {
    if (col === 4) terms.add('中炮')
    if (captured) terms.add('炮架')
  }
  if (piece.type === 'horse') {
    const enemyGrooveRow = piece.color === 'red' ? 1 : 8
    if (row === enemyGrooveRow && (col === 2 || col === 6)) {
      terms.add('臥槽馬')
    } else {
      terms.add('馬路')
    }
  }
  return [...terms]
}

export function annotateVariation(
  positionFen: string,
  moves: readonly string[],
  displayMoves: readonly string[] = []
): VariationPlyFact[] {
  const parsed = parseFen(positionFen)
  if (!parsed.valid) return []
  let board: BoardState = parsed.board
  const facts: VariationPlyFact[] = []
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index]
    const coords = parseUciMove(move)
    if (!coords) break
    const piece = board.grid[coords.fromRow]?.[coords.fromCol]
    if (!piece) break
    const side = board.sideToMove
    const result = applyUciMove(board, move)
    if (!result.valid) break
    const givesCheck = isKingInCheck(result.board.grid, result.board.sideToMove)
    facts.push({
      ply: index + 1,
      move,
      displayMove: displayMoves[index] ?? move,
      side,
      piece: PIECE_LABEL[piece.type],
      capturedPiece: result.captured
        ? PIECE_LABEL[result.captured.type]
        : undefined,
      givesCheck,
      destinationZone: destinationZone(coords.toRow, coords.toCol),
      terms: positionalTerms(
        piece,
        coords.toRow,
        coords.toCol,
        givesCheck,
        result.captured
      )
    })
    board = result.board
  }
  return facts
}

function nearBestAlternatives(analysis: EngineAnalysis): number | null {
  const best = scoreValue(analysis.scoreAfterBestMove)
  if (best === null) return null
  return analysis.candidateMoves.filter((candidate) => {
    const value = scoreValue(candidate.score)
    return value !== null && best - value <= NEAR_BEST_WINDOW_PAWNS
  }).length
}

function humanControlIndicators(
  proposer: EngineAnalysis,
  lineFacts: VariationPlyFact[],
  views: readonly EngineMoveView[]
): HumanControlIndicators {
  const captures = lineFacts.filter((item) => item.capturedPiece).length
  const checks = lineFacts.filter((item) => item.givesCheck).length
  const forcingPlies = lineFacts.filter(
    (item) => item.givesCheck || item.capturedPiece
  ).length
  const legalPlies = lineFacts.length
  const support = views.filter((view) => view.rank !== null && view.rank <= 3).length
  const alternatives = nearBestAlternatives(proposer)
  let precisionDemand: HumanControlIndicators['precisionDemand'] = 'unknown'
  if (legalPlies > 0) {
    const tacticalDensity = forcingPlies / legalPlies
    precisionDemand =
      tacticalDensity >= 0.5 || support === 0
        ? 'higher'
        : tacticalDensity <= 0.2 && support >= 2
          ? 'lower'
          : 'medium'
  }
  const summary =
    legalPlies === 0
      ? '主線不足，無法估計人類執行難度。'
      : `可驗證 ${legalPlies} 個半回合，其中 ${forcingPlies} 手為將軍或吃子；${support} 個引擎把此著列入前三候選。這只描述執行風險，不直接代表棋力優劣。`
  return {
    legalPlies,
    forcingPlies,
    captures,
    checks,
    nearBestAlternatives: alternatives,
    crossEngineSupport: support,
    precisionDemand,
    summary
  }
}

function moveAssessment(
  move: string,
  primary: EngineAnalysis,
  verification: EngineAnalysis
): DualEngineMoveAssessment {
  const proposedBy = [primary, verification]
    .filter((analysis) => analysis.bestMove === move)
    .map((analysis) => analysis.engineName)
  const proposer = primary.bestMove === move ? primary : verification
  const candidate = candidateForMove(proposer, move)
  const rawLine =
    proposer.bestMove === move
      ? proposer.principalVariation
      : candidate?.principalVariation ?? []
  const displayLine =
    proposer.bestMove === move
      ? proposer.displayPrincipalVariation ?? proposer.principalVariation
      : candidate?.displayPrincipalVariation ?? candidate?.principalVariation ?? []
  const views = [moveView(primary, move), moveView(verification, move)]
  const facts = annotateVariation(proposer.positionFen, rawLine, displayLine)
  return {
    move,
    displayMove:
      proposer.bestMove === move
        ? proposer.displayBestMove ?? move
        : candidate?.displayMove ?? move,
    proposedBy,
    engineViews: views,
    lineFacts: facts,
    humanControl: humanControlIndicators(proposer, facts, views)
  }
}

export function dualEngineDisagreementReasons(
  primary: EngineAnalysis,
  verification: EngineAnalysis
): DualEngineDisagreementReason[] {
  const reasons: DualEngineDisagreementReason[] = []
  if (primary.bestMove !== verification.bestMove) {
    reasons.push({
      code: 'best_move',
      message: `${primary.engineName} 建議 ${primary.displayBestMove ?? primary.bestMove}，${verification.engineName} 建議 ${verification.displayBestMove ?? verification.bestMove}。`
    })
  }
  const a = scoreValue(primary.scoreAfterBestMove)
  const b = scoreValue(verification.scoreAfterBestMove)
  if (a === null || b === null) {
    reasons.push({
      code: 'missing_score',
      message: '至少一個引擎沒有可比較的正式分數。'
    })
    return reasons
  }
  if (
    Math.sign(a) !== Math.sign(b) &&
    Math.abs(a) + Math.abs(b) >= DUAL_ENGINE_SIGN_CONFLICT_MIN_PAWNS
  ) {
    reasons.push({
      code: 'score_sign',
      message: '兩個引擎對局面優劣方向的判斷相反。'
    })
  }
  if (Math.abs(a - b) >= DUAL_ENGINE_SCORE_GAP_PAWNS) {
    reasons.push({
      code: 'score_gap',
      message: `兩個引擎的正式評估相差至少 ${DUAL_ENGINE_SCORE_GAP_PAWNS.toFixed(1)} 兵。`
    })
  }
  return reasons
}

export function buildDualEngineComparison(
  primary: EngineAnalysis,
  verification?: EngineAnalysis
): DualEngineComparison | null {
  if (!verification) return null
  const reasons = dualEngineDisagreementReasons(primary, verification)
  const moves = [...new Set([primary.bestMove, verification.bestMove])].filter(Boolean)
  return {
    status:
      reasons.some((reason) => reason.code !== 'missing_score')
        ? 'disagreement'
        : reasons.length > 0
          ? 'insufficient'
          : 'agreement',
    primaryEngineName: primary.engineName,
    verificationEngineName: verification.engineName,
    reasons,
    candidateLines: moves.map((move) =>
      moveAssessment(move, primary, verification)
    ),
    adjudicationRules: [
      '不得平均兩個引擎分數，也不得只用分數高低決定答案。',
      '逐條比較雙方推薦線的強迫程度、戰術密度、王區風險、子力活動、長期部署與跨引擎支持。',
      '人類可控性要考慮容錯、容易走歪的分支、局面可逆性與是否需要連續唯一著。',
      '證據不足時必須回覆暫時無法判定，並指出還需要哪一條交叉分析。'
    ]
  }
}
