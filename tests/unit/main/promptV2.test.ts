import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { buildPromptV2, recentHistory } from '../../../src/main/ai/explain/promptV2'
import {
  buildExplanationFacts,
  formatFactsForPrompt
} from '../../../src/shared/logic/analysis/ExplanationFacts'
import type { ExplanationLanguage } from '../../../src/shared/types/AIExplanationTypes'
import { openingAnalysis, openingComparison } from '../../support/explainFixtures'

const SNAPSHOT = new URL('../../fixtures/explain-v2/prompt-snapshots.json', import.meta.url)

const analysis = openingAnalysis()
const facts = buildExplanationFacts(analysis, openingComparison(analysis))
const outputs: Record<string, { systemPrompt: string; prompt: string }> = {}
for (const language of ['zh-TW', 'zh-CN', 'en'] as ExplanationLanguage[]) {
  const factsText = formatFactsForPrompt(facts, language)
  outputs[`move-${language}`] = buildPromptV2({ mode: 'move', language, userLevel: 'basic', facts, factsText, userMoveReason: '我想先出馬保護中兵' })
  outputs[`position-${language}`] = buildPromptV2({ mode: 'position', language, userLevel: 'intermediate', facts, factsText })
  outputs[`question-${language}`] = buildPromptV2({
    mode: 'question', language, userLevel: 'advanced', facts, factsText,
    question: '為什麼不能先走馬八進七？',
    history: [
      { id: '1', role: 'user', text: '舊問題一', createdAt: 't' },
      { id: '2', role: 'assistant', text: '舊答案一', createdAt: 't' },
      { id: '3', role: 'user', text: '舊問題二', createdAt: 't' },
      { id: '4', role: 'assistant', text: '長'.repeat(500), createdAt: 't' },
      { id: '5', role: 'user', text: '最新問題', createdAt: 't' },
      { id: '6', role: 'assistant', text: '最新答案', createdAt: 't' }
    ]
  })
}

if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(SNAPSHOT)) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(outputs, null, 2)}\n`)
  console.log('promptV2 snapshot written')
}
assert.deepEqual(outputs, JSON.parse(readFileSync(SNAPSHOT, 'utf8')), 'prompt v2 snapshot changed; review and run with UPDATE_SNAPSHOTS=1')

const move = outputs['move-zh-TW']
assert.match(move.systemPrompt, /第一句直接回答/)
assert.match(move.systemPrompt, /不要說成「必然」「唯一」「被迫」/)
assert.match(move.prompt, /【棋手自己的想法】我想先出馬保護中兵/)
assert.match(move.prompt, /\*\*結論\*\*/)
assert.match(move.prompt, /\*\*這步的問題\*\*/)
assert.equal(/JSON|json/.test(move.prompt + move.systemPrompt), false, 'v2 asks for plain text')
assert.equal(/score cp/.test(move.prompt), false, 'raw scores never reach the prompt')
assert.ok(move.prompt.length < 3_500, `prompt stays short: ${move.prompt.length}`)
// 「對手怎麼利用」指向棋手著法之後的線與對手（紅方走 → 黑方應對），不再只說「主線」。
assert.match(move.prompt, /\*\*對手怎麼利用\*\*：（沿「棋手著法之後的主線」，寫黑方怎麼應對/)
assert.match(move.prompt, /不要寫棋手自己的後續著法/)
assert.equal(move.prompt.includes('沿主線說到具體結果為止'), false)
assert.match(outputs['move-zh-CN'].prompt, /沿“棋手着法之后的主线”，写黑方怎么应对/)
assert.match(outputs['move-en'].prompt, /follow the "Line after the player's move": what Black plays in reply/)
// 沒寫想法時不出現「未提供」（模型會照抄成「棋手未提供想法」）；系統規則禁止提示標籤與自行判斷子力價值。
const noReason = buildPromptV2({ mode: 'move', language: 'zh-TW', userLevel: 'basic', facts, factsText: formatFactsForPrompt(facts) })
assert.equal(/棋手自己的想法|未提供】|】未提供/.test(noReason.prompt), false)
assert.equal(buildPromptV2({ mode: 'move', language: 'en', userLevel: 'basic', facts, factsText: formatFactsForPrompt(facts, 'en') }).prompt.includes("[Player's own idea]"), false)
assert.match(move.systemPrompt, /不要提到【事實表】「未提供」等提示裡的標籤/)
assert.match(move.systemPrompt, /不要用子力換算/)
// 不再要求模型說「引擎資料沒有說明」（P3-9 live：事實表其實有寫原因時也照抄這句），改為先從事實表找、找不到就不猜。
assert.equal(move.systemPrompt.includes('就說引擎資料沒有說明原因'), false)
assert.match(move.systemPrompt, /不要寫「根據引擎資料」「引擎資料沒有說明」這類套話/)
assert.match(move.systemPrompt, /能不能吃回」的變化/)
assert.match(move.systemPrompt, /不要夾雜簡體字/)
// 棋手要的是下法上的理由，不是分數（實測：回答一直寫「+0.76 兵」「低 0.58 兵」）；沒有吃子／威脅差別時改比兩條線的計畫。
assert.match(move.systemPrompt, /回答裡不要寫評估或差距的數字/)
assert.equal(move.systemPrompt.includes('要提就連數字一起寫'), false)
assert.match(move.systemPrompt, /就比較兩條線的計畫：各自動了哪些子、走到哪裡/)
assert.match(move.systemPrompt, /只能說線上真的走到的子和位置/)
assert.match(outputs['move-zh-CN'].systemPrompt, /回答里不要写评估或差距的数字/)
assert.match(outputs['move-en'].systemPrompt, /compare the plans instead/)
assert.match(outputs['move-zh-CN'].systemPrompt, /用简体中文回答/)
assert.match(outputs['move-en'].systemPrompt, /Answer in English/)

const question = outputs['question-zh-TW']
assert.match(question.prompt, /只回答這個問題/)
assert.equal(question.prompt.includes('舊問題一'), false, 'only the last two Q&A pairs are kept')
assert.match(question.prompt, /舊問題二/)
assert.ok(question.prompt.includes(`${'長'.repeat(300)}…`), 'history messages are clipped to 300 chars')

// 走對時不硬找缺點。
const correct = buildExplanationFacts(openingAnalysis({ userMove: 'h2e2', displayUserMove: '炮二平五' }))
const correctPrompt = buildPromptV2({ mode: 'move', language: 'zh-TW', userLevel: 'basic', facts: correct, factsText: formatFactsForPrompt(correct) })
assert.match(correctPrompt.prompt, /不要硬找缺點/)
assert.equal(outputs['move-zh-TW'].prompt.includes('不要硬找缺點'), false)
assert.equal(recentHistory(undefined, 'zh-TW'), '')

// 沒附棋手著法時，不能拿候選著法當成「你走的那步」（實測：猜著選了著法卻沒提交）。
assert.equal(question.prompt.includes('【注意】'), false, 'a question with the player move attached has no no-move note')
const noMoveFacts = buildExplanationFacts(openingAnalysis({ userMove: undefined, displayUserMove: undefined }))
assert.equal(noMoveFacts.userMove, undefined)
const noMoveQuestion = buildPromptV2({
  mode: 'question', language: 'zh-TW', userLevel: 'basic', facts: noMoveFacts,
  factsText: formatFactsForPrompt(noMoveFacts), question: '我的走法為什麼比正著差？'
})
assert.match(noMoveQuestion.prompt, /【注意】這次提問沒有附上棋手自己走的著法/)
assert.match(noMoveQuestion.prompt, /不要猜是哪一步，也不要拿候選著法代替/)
assert.match(
  buildPromptV2({ mode: 'question', language: 'en', userLevel: 'basic', facts: noMoveFacts, factsText: formatFactsForPrompt(noMoveFacts, 'en'), question: 'Why is my move worse?' }).prompt,
  /Do not guess which move they meant/
)

// 術語只附問題裡真的出現的；無關的兵卒術語不會因為提到「兵」就塞進來。
const termQuestion = buildPromptV2({
  mode: 'question', language: 'zh-TW', userLevel: 'basic', facts, factsText: formatFactsForPrompt(facts),
  question: '炮二平五之後中卒是不是無根？會不會被困斃？'
})
assert.match(termQuestion.prompt, /- 無根子：/)
assert.match(termQuestion.prompt, /- 困斃：.*判負/)
assert.equal(outputs['move-zh-TW'].prompt.includes('術語參考'), false)
console.log('promptV2 tests passed')
