import { START_FEN } from '../src/shared/types/BoardState'
import type {
  EngineAnalysis,
  EngineScore
} from '../src/shared/types/EngineAnalysis'
import {
  annotateVariation,
  buildDualEngineComparison,
  dualEngineDisagreementReasons
} from '../src/shared/logic/DualEngineComparison'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  }
}

function score(value: number): EngineScore {
  return {
    type: 'cp',
    cp: Math.round(value * 100),
    value,
    comparableValue: value,
    raw: `score cp ${Math.round(value * 100)}`,
    displayText: `${value >= 0 ? '+' : ''}${value.toFixed(2)}`,
    wasInverted: false,
    source: 'root_analysis'
  }
}

function analysis(
  engineName: string,
  bestMove: string,
  displayBestMove: string,
  value: number,
  pv: string[]
): EngineAnalysis {
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    bestMove,
    displayBestMove,
    scoreAfterUserMove: null,
    scoreAfterBestMove: score(value),
    evaluationAfterUserMove: null,
    evaluationAfterBestMove: value,
    userMoveEvaluationSource: 'unavailable',
    depth: 22,
    candidateMoves: [
      {
        move: bestMove,
        displayMove: displayBestMove,
        score: score(value),
        evaluation: value,
        depth: 22,
        principalVariation: pv,
        displayPrincipalVariation: pv
      }
    ],
    principalVariation: pv,
    displayPrincipalVariation: pv,
    incomplete: false,
    warnings: [],
    engineId: engineName.toLowerCase().replaceAll(' ', '-'),
    engineName
  }
}

console.log('\n## 雙引擎分歧與人類可控性')
const primary = analysis(
  'Primary',
  'b2e2',
  '炮二平五',
  0.8,
  ['b2e2', 'b7e7', 'h0g2', 'h9g7']
)
const close = analysis(
  'Verifier',
  'b2e2',
  '炮二平五',
  0.1,
  ['b2e2', 'b7e7', 'h0g2']
)
check(
  '同最佳著且分差小時判定一致',
  dualEngineDisagreementReasons(primary, close).length === 0
)

const gap = analysis(
  'Gap verifier',
  'b2e2',
  '炮二平五',
  -0.7,
  ['b2e2', 'b7e7']
)
check(
  '1.5 兵分差會被抓出，防止誤用 150 兵門檻',
  dualEngineDisagreementReasons(primary, gap).some(
    (reason) => reason.code === 'score_gap'
  )
)

const verifier = analysis(
  'Verifier',
  'h0g2',
  '馬二進三',
  -0.2,
  ['h0g2', 'h9g7', 'b2e2', 'b7e7']
)
const comparison = buildDualEngineComparison(primary, verifier)
check('不同最佳著判定為 disagreement', comparison?.status === 'disagreement')
check(
  '兩條候選線分開保存，沒有平均分數欄位',
  comparison?.candidateLines.length === 2 && !('averageScore' in comparison)
)
check(
  '每條線都有按引擎分開的評估',
  comparison?.candidateLines.every((line) => line.engineViews.length === 2) ===
    true
)
check(
  '人類可控性含可驗證步數與精準度需求',
  comparison?.candidateLines.every(
    (line) =>
      line.humanControl.legalPlies > 0 &&
      line.humanControl.precisionDemand !== 'unknown'
  ) === true
)

const facts = annotateVariation(START_FEN, ['b2e2', 'b7e7', 'h0g2'])
check('主線逐手轉成客觀盤面事實', facts.length === 3)
check(
  '盤面事實標示棋子與目的區域',
  facts.every(
    (fact) => fact.piece.length > 0 && fact.destinationZone.length > 0
  )
)

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
