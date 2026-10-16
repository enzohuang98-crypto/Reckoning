/**
 * 用 P3-9 live 驗收的 10 個局面檢查事實表：live 回答的錯誤多半來自事實表沒寫清楚的地方，
 * 這裡逐項釘住程式算出的事實（著法與結果都用規則引擎重播，不靠手寫）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildExplanationFacts, formatFactsForPrompt } from '../../../src/shared/logic/analysis/ExplanationFacts'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import type { EngineAnalysis } from '../../../src/shared/types/EngineAnalysis'

const cases = JSON.parse(
  readFileSync(new URL('../../fixtures/explain-v2/cases.json', import.meta.url), 'utf8')
) as Array<{ id: string; analysis: EngineAnalysis }>

function factsText(id: string, language: 'zh-TW' | 'zh-CN' | 'en' = 'zh-TW'): string {
  const analysis = cases.find((item) => item.id === id)!.analysis
  const facts = buildExplanationFacts(analysis, analysis.userMove ? compareMove(analysis) : undefined)
  return formatFactsForPrompt(facts, language)
}

// 1. 評估用兵、標明視角：黑方走時 +0.10 是「以黑方來看」，不是原始的「10」。
const black = factsText('black-to-move')
assert.ok(black.includes('評估都以黑方來看，單位是兵'), black)
assert.ok(black.includes('引擎首選：馬8進7（評估 +0.10 兵）'), black)
assert.ok(black.includes('棋手著法：炮2平5（評估 -1.50 兵）'), black)
assert.equal(/評估 -?\d{2,}[）)]/.test(black), false, '不再出現原始 centipawn')
assert.ok(factsText('endgame-rook').includes('（評估 +20.00 兵）'))
// 殺棋保留「殺 N」，也不需要兵的視角說明。
const mate = factsText('check-mate-line')
assert.ok(mate.includes('（評估 殺 1）'), mate)
assert.equal(mate.includes('單位是兵'), false)
assert.ok(factsText('black-to-move', 'en').includes("All evals are from Black's point of view, in pawns"))

console.log('explanationFacts live-case tests passed')
