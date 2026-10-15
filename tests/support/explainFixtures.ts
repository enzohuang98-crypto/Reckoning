import { convertCpScore } from '../../src/main/engine/EngineOutputParser'
import { compareMove } from '../../src/shared/logic/analysis/MoveComparisonService'
import { START_FEN } from '../../src/shared/types/BoardState'
import type { EngineAnalysis } from '../../src/shared/types/EngineAnalysis'

/** 初始局面：首選炮二平五，棋手走馬八進七（差距約 0.35 兵）。 */
export function openingAnalysis(overrides: Partial<EngineAnalysis> = {}): EngineAnalysis {
  const best = convertCpScore(42, 'score cp 42')
  const user = convertCpScore(7, 'score cp 7', 'candidate_move')
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    userMove: 'b0c2',
    displayUserMove: '馬八進七',
    bestMove: 'h2e2',
    displayBestMove: '炮二平五',
    scoreAfterUserMove: user,
    scoreAfterBestMove: best,
    evaluationAfterUserMove: user.comparableValue,
    evaluationAfterBestMove: best.comparableValue,
    userMoveEvaluationSource: 'candidate_move',
    userMovePrincipalVariation: ['b0c2', 'h9g7', 'h2e2', 'b9c7'],
    displayUserMovePrincipalVariation: ['馬八進七', '馬8進7', '炮二平五', '馬2進3'],
    depth: 16,
    candidateMoves: [
      { move: 'h2e2', displayMove: '炮二平五', score: best, evaluation: best.comparableValue, depth: 16, principalVariation: ['h2e2', 'h9g7'] },
      { move: 'b0c2', displayMove: '馬八進七', score: user, evaluation: user.comparableValue, depth: 16, principalVariation: ['b0c2', 'h9g7'] }
    ],
    principalVariation: ['h2e2', 'h9g7'],
    displayPrincipalVariation: ['炮二平五', '馬8進7'],
    incomplete: false,
    warnings: [],
    engineId: 'engine-1',
    engineName: 'Test Engine',
    ...overrides
  }
}

export function openingComparison(analysis = openingAnalysis()) {
  return compareMove(analysis)
}
