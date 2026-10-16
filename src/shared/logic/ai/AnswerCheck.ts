/**
 * v2 回答的客觀檢查（AnswerCheck，純函式）。
 *
 * 只擋「可以客觀判定的硬錯」：太短、被截斷、外洩內部格式、提到不存在的著法、
 * 吃子／將軍與重播事實矛盾、一鍵解說缺必要段落、輪走方說錯。有硬錯才觸發一次自動修正。
 * 策略性敘述無法機器驗證，只記軟警告，不擋答案——避免 PR #76 那種驗證器軍備競賽。
 */

import type { ExplanationLanguage } from '../../types/AIExplanationTypes'
import {
  factMoveEvents,
  factMoveSet,
  factOnlyLegalMoves,
  type ExplanationFacts
} from '../analysis/ExplanationFacts'
import { scoreUsedAsReason, VAGUE_PHRASES } from './ExplanationQualityScorer'

export type AnswerCheckMode = 'move' | 'position' | 'question'

export type HardErrorCode = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'H7'
export type SoftWarningCode = 'S1' | 'S2' | 'S3' | 'S4'

export interface AnswerIssue<Code extends string> {
  code: Code
  /** 給修正 prompt 與診斷紀錄的說明（繁體中文；不含服務原文）。 */
  message: string
}

export interface AnswerCheckInput {
  text: string
  finishReason?: string
  mode: AnswerCheckMode
  language: ExplanationLanguage
  facts: ExplanationFacts
  /** 棋手自己寫的問題與想法；裡面提到的著法可以被回答引用。 */
  userText?: string
}

export interface AnswerCheckResult {
  hardErrors: AnswerIssue<HardErrorCode>[]
  softWarnings: AnswerIssue<SoftWarningCode>[]
}

export const MIN_ANSWER_CHARS = 15
export const SOFT_MAX_CHARS: Record<AnswerCheckMode, number> = {
  move: 900,
  position: 700,
  question: 450
}

const PIECE_CHARS = '車车俥馬马傌炮砲包相象仕士帥帅將将兵卒'
const NUMERAL_CHARS = '一二三四五六七八九1-9１-９'
/** 中文記譜：兵種＋縱線（或前中後＋兵種）＋進退平＋數字。 */
const MOVE_PATTERN = new RegExp(
  `(?:[前中後后][${PIECE_CHARS}]|[${PIECE_CHARS}][${NUMERAL_CHARS}])[進进退平][${NUMERAL_CHARS}]`,
  'g'
)

const CHAR_NORMALIZATION: Record<string, string> = {
  车: '車', 俥: '車', 马: '馬', 傌: '馬', 砲: '炮', 包: '炮', 帅: '帥', 将: '將',
  进: '進', 后: '後',
  '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
}

/** 繁簡、異體字與全形數字正規化，讓簡體回答引用同一步棋時不被誤判。 */
export function normalizeMoveText(text: string): string {
  return [...text].map((char) => CHAR_NORMALIZATION[char] ?? char).join('')
}

export function extractMentionedMoves(text: string): Array<{ move: string; index: number; end: number }> {
  const normalized = normalizeMoveText(text)
  const found: Array<{ move: string; index: number; end: number }> = []
  for (const match of normalized.matchAll(MOVE_PATTERN)) {
    found.push({ move: match[0], index: match.index ?? 0, end: (match.index ?? 0) + match[0].length })
  }
  return found
}

const LEAK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?<![A-Za-z0-9])[a-i][0-9][a-i][0-9](?![A-Za-z0-9])/, label: '座標著法（例如 h2e2）' },
  { pattern: /```/, label: '程式碼區塊' },
  { pattern: /<\/?think>/i, label: '思考標記' },
  { pattern: /(?<![A-Za-z0-9])[EK][0-9]{1,2}(?![A-Za-z0-9])/, label: '內部證據編號（E1、K2）' },
  { pattern: /\b(?:FEN|UCI)\b/, label: 'FEN／UCI 字樣' },
  // 提示裡的標籤不是給棋手看的（P3-9 live 回答曾出現「事實表」「棋手未提供想法」）。
  { pattern: /事實表|事实表|\[Facts\]|fact table/i, label: '提示標籤（事實表）' },
  { pattern: /棋手未提供|未提供想法|棋手自己的想法|player's own idea|not given/i, label: '提示標籤（棋手想法欄）' }
]

/** 著法後面接這些字，代表是可能性或否定，不是「這步吃了／將了」。 */
const HEDGE_PATTERN = /可以|可|能|威脅|威胁|準備|准备|打算|想|沒有|没有|未|不|若|如果|would|could|can|threat|not|no\b/i
const CAPTURE_PATTERN = /吃|captur/i
const CHECK_PATTERN = /將軍|将军|\bcheck/i
const CLAUSE_BREAK = /[，。；,.;！？!?\n]/

const MOVE_HEADINGS = {
  conclusion: ['結論', '结论', 'Conclusion'],
  assessment: [
    '這步的問題', '这步的问题', 'What is wrong with this move',
    '這步好在哪', '这步好在哪', 'What this move does well'
  ]
}

function issue<Code extends string>(code: Code, message: string): AnswerIssue<Code> {
  return { code, message }
}

function visibleLength(text: string): number {
  return text.replace(/\s+/g, '').length
}

const FORCED_PATTERN = /必然|唯一|被迫|forced|only move/gi

/**
 * 「必然／唯一／被迫」只有在事實表標為「唯一合法著法」的那一步才成立：
 * 同一個子句裡提到那一步就不算誤用（P3-9 live：將5進1 是唯一應將，卻被標警告）。
 */
function claimsForcedWithoutFact(text: string, facts: ExplanationFacts): boolean {
  const onlyMoves = new Set([...factOnlyLegalMoves(facts)].map(normalizeMoveText))
  const normalized = normalizeMoveText(text)
  for (const match of normalized.matchAll(FORCED_PATTERN)) {
    const at = match.index ?? 0
    let start = at
    while (start > 0 && !CLAUSE_BREAK.test(normalized[start - 1])) start--
    let end = at
    while (end < normalized.length && !CLAUSE_BREAK.test(normalized[end])) end++
    const clause = normalized.slice(start, end)
    const covered = extractMentionedMoves(clause).some((move) => onlyMoves.has(move.move))
    if (!covered) return true
  }
  return false
}

export function checkAnswer(input: AnswerCheckInput): AnswerCheckResult {
  const text = input.text.trim()
  const hardErrors: AnswerIssue<HardErrorCode>[] = []
  const softWarnings: AnswerIssue<SoftWarningCode>[] = []

  if (visibleLength(text) < MIN_ANSWER_CHARS) {
    hardErrors.push(issue('H1', '回答太短，沒有真正回答問題。'))
  }
  if (input.finishReason === 'length') {
    hardErrors.push(issue('H2', '回答被截斷，請縮短後完整輸出。'))
  }

  const leaks = LEAK_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label)
  if (/^[{[]/.test(text)) leaks.unshift('JSON 或程式格式')
  if (leaks.length > 0) {
    hardErrors.push(issue('H3', `出現不該給棋手看的內部格式：${[...new Set(leaks)].join('、')}。請改用事實表中的中文著法與一般文字。`))
  }

  const known = new Set([...factMoveSet(input.facts)].map(normalizeMoveText))
  for (const mentioned of extractMentionedMoves(input.userText ?? '')) known.add(mentioned.move)
  const mentioned = extractMentionedMoves(text)
  const unknown = [...new Set(mentioned.map((item) => item.move).filter((move) => !known.has(move)))]
  if (unknown.length > 0) {
    hardErrors.push(issue('H4', `提到的著法「${unknown.join('」「')}」不在事實表中；只能使用事實表裡的著法。`))
  }

  const events = new Map<string, { captures: boolean; checks: boolean }>()
  for (const [move, value] of factMoveEvents(input.facts)) events.set(normalizeMoveText(move), value)
  const normalizedText = normalizeMoveText(text)
  const contradictions: string[] = []
  for (let index = 0; index < mentioned.length; index++) {
    const current = mentioned[index]
    const event = events.get(current.move)
    if (!event) continue
    const nextStart = mentioned[index + 1]?.index ?? Number.POSITIVE_INFINITY
    let window = normalizedText.slice(current.end, Math.min(current.end + 8, nextStart))
    const breakAt = window.search(CLAUSE_BREAK)
    if (breakAt >= 0) window = window.slice(0, breakAt)
    if (HEDGE_PATTERN.test(window)) continue
    if (CAPTURE_PATTERN.test(window) && !event.captures) {
      contradictions.push(`「${current.move}」在事實表中沒有吃子，不能說它吃子`)
    }
    if (CHECK_PATTERN.test(window) && !event.checks) {
      contradictions.push(`「${current.move}」在事實表中沒有將軍，不能說它將軍`)
    }
  }
  if (contradictions.length > 0) {
    hardErrors.push(issue('H5', `${[...new Set(contradictions)].join('；')}。`))
  }

  if (input.mode === 'move') {
    const hasConclusion = MOVE_HEADINGS.conclusion.some((heading) => text.includes(heading))
    const hasAssessment = MOVE_HEADINGS.assessment.some((heading) => text.includes(heading))
    if (!hasConclusion || !hasAssessment) {
      hardErrors.push(
        issue('H6', '缺少必要段落：必須有「結論」與「這步的問題」（或走對時的「這步好在哪」）。')
      )
    }
  }

  // 只抓「現在／目前輪到某方」這類描述目前局面的句子；主線敘述中的「之後輪到黑方」不算。
  const wrongColor = input.facts.sideToMove === 'red' ? '黑' : '(?:紅|红)'
  const wrongColorEn = input.facts.sideToMove === 'red' ? 'black' : 'red'
  const wrongSide = new RegExp(
    `(?:現在|现在|目前|此刻|當前|当前)(?:是|應|应)?(?:輪到|轮到)${wrongColor}|(?:now|currently)[^.]{0,12}\\b${wrongColorEn}(?:'s)? (?:to move|turn|move)|it is ${wrongColorEn}'s (?:turn|move)`,
    'i'
  )
  if (wrongSide.test(text)) {
    hardErrors.push(
      issue('H7', `輪走方說錯：目前輪到${input.facts.sideToMove === 'red' ? '紅' : '黑'}方走。`)
    )
  }

  if (scoreUsedAsReason(text)) softWarnings.push(issue('S1', '以分數當理由。'))
  if (visibleLength(text) > SOFT_MAX_CHARS[input.mode]) {
    softWarnings.push(issue('S2', `回答偏長（超過 ${SOFT_MAX_CHARS[input.mode]} 字）。`))
  }
  if (claimsForcedWithoutFact(text, input.facts)) {
    softWarnings.push(issue('S3', '把主線說成必然／唯一／被迫。'))
  }
  if (VAGUE_PHRASES.some((phrase) => text.includes(phrase))) {
    softWarnings.push(issue('S4', '含空泛用語。'))
  }
  return { hardErrors, softWarnings }
}
