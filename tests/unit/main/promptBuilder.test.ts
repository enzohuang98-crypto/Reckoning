import { buildExplanationPrompt } from '../../../src/main/ai/promptBuilder'
import type { EngineAnalysis } from '../../../src/shared/types/EngineAnalysis'
import type { MoveComparisonResult } from '../../../src/shared/types/MoveComparisonResult'

let passed = 0
let failed = 0
function check(name: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

const analysis: EngineAnalysis = {
  positionFen: 'fixture', sideToMove: 'red', userMove: 'b0c2', displayUserMove: '馬八進七',
  bestMove: 'h2e2', displayBestMove: '炮二平五',
  scoreAfterUserMove: null, scoreAfterBestMove: null,
  evaluationAfterUserMove: 2, evaluationAfterBestMove: 4,
  userMoveEvaluationSource: 'candidate_move',
  principalVariation: ['h2e2', 'h9g7', 'b0c2'],
  displayPrincipalVariation: ['炮二平五', '馬8進7', '馬八進七'],
  userMovePrincipalVariation: ['b0c2', 'h9g7', 'h2e2'],
  displayUserMovePrincipalVariation: ['馬八進七', '馬8進7', '炮二平五'],
  depth: 18, candidateMoves: [], incomplete: false, warnings: [], engineName: 'Pikafish'
}
const comparison: MoveComparisonResult = {
  positionFen: 'fixture', sideToMove: 'red', userMove: 'b0c2', engineBestMove: 'h2e2',
  evaluationAfterUserMove: 2, evaluationAfterBestMove: 4,
  scoreDifference: 2, mistakeLevel: 'mistake', depth: 18,
  confidence: 'high', uncertaintyReasons: []
}
const prompt = buildExplanationPrompt({
  engineAnalysis: analysis, moveComparison: comparison,
  userLevel: 'intermediate', explanationStyle: 'long_analytical', language: 'zh-TW'
})
check('既有數值分級的差異狀態保留，但首句不把分差說成已證棋理機制',
  prompt.includes('比較證據狀態：evidence_backed_difference') &&
  /分差.{0,12}數值觀測/.test(prompt) && /不預判.{0,15}失誤/.test(prompt) &&
  !prompt.includes('第一句直接說兩步有證據支持的實質差異'))
check('數值差異分支要求具體評價與合理應對，機制不明時保留已知內容並指出缺項',
  prompt.includes('actual_move_problem／實戰步評價') &&
  prompt.includes('opponent_exploitation／對手合理應對') &&
  /兩條主線.{0,15}證據支持/.test(prompt) &&
  /機制差異無法確認/.test(prompt) &&
  /保留.{0,10}具體走法、盤面事實與合理應對/.test(prompt) &&
  prompt.includes('缺少哪些') && prompt.includes('不要把整篇改成證據不足'))
check('數值分類的顯示不宣稱已證明具體失誤，仍保留禁止分數代替原因的規則',
  prompt.includes('既有分差分級：明顯錯誤（數值比較分類，不證明具體失誤機制）') &&
  prompt.includes('禁止用分數高低、評估差距或可信度代替棋理與盤面因果'))
check('數值差異分支保持五段、篇幅目標與兩步具體後果契約',
  ['direct_conclusion', 'actual_move_problem', 'best_move_plan', 'opponent_exploitation', 'practical_principle']
    .every(id => prompt.includes(id)) && prompt.includes('500–900') && prompt.includes('至少兩步真實主線'))
const sameMovePrompt = buildExplanationPrompt({
  engineAnalysis: { ...analysis, userMove: 'h2e2', displayUserMove: '炮二平五' },
  moveComparison: { ...comparison, userMove: 'h2e2', scoreDifference: 0,
    evaluationAfterUserMove: 4, mistakeLevel: 'acceptable_or_tiny_inaccuracy' },
  userLevel: 'intermediate', explanationStyle: 'long_analytical', language: 'zh-TW'
})
check('同一著法仍明說一致與合理應對，不催寫錯失或懲罰',
  sameMovePrompt.includes('第一句明說實戰步與引擎首選是同一著法') &&
  sameMovePrompt.includes('不得硬寫錯失、失誤、較差或懲罰') &&
  sameMovePrompt.includes('opponent_exploitation／對手合理應對'))

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
