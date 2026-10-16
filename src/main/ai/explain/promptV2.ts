/**
 * Prompt v2（純文字、system＋user）。
 *
 * 原則：程式先算好事實（ExplanationFacts），模型只負責用白話講；
 * 第一句直接回答、不湊字、不寫座標、分數不當理由、主線不說成必然。
 * 輸出是一般文字，不再要求 JSON（嚴格格式會傷害推理，也讓免費模型常常截斷）。
 */

import type { ConversationMessage } from '@shared/types/AppData'
import type { ExplanationLanguage } from '@shared/types/AIExplanationTypes'
import type { UserLevel } from '@shared/types/Settings'
import type { ExplanationFacts } from '@shared/logic/analysis/ExplanationFacts'
import { MISTAKE_LEVEL_LABELS } from '@shared/types/MoveComparisonResult'
import { selectXiangqiKnowledge } from '@shared/logic/ai/xiangqiKnowledge'

export type ExplainMode = 'move' | 'position' | 'question'

export interface PromptV2Input {
  mode: ExplainMode
  language: ExplanationLanguage
  userLevel: UserLevel
  facts: ExplanationFacts
  /** formatFactsForPrompt 的輸出。 */
  factsText: string
  question?: string
  userMoveReason?: string
  history?: readonly ConversationMessage[]
}

export interface PromptV2 {
  systemPrompt: string
  prompt: string
}

export const MAX_HISTORY_PAIRS = 2
export const MAX_HISTORY_CHARS = 300
export const MAX_KNOWLEDGE_ENTRIES = 5

/** 小標題：AnswerCheck 也用它們確認一鍵解說的必要段落。 */
export const MOVE_HEADINGS: Record<
  ExplanationLanguage,
  {
    conclusion: string
    problem: string
    good: string
    bestPlan: string
    opponent: string
    nextTime: string
  }
> = {
  'zh-TW': {
    conclusion: '結論',
    problem: '這步的問題',
    good: '這步好在哪',
    bestPlan: '首選想做什麼',
    opponent: '對手怎麼利用',
    nextTime: '下次怎麼想'
  },
  'zh-CN': {
    conclusion: '结论',
    problem: '这步的问题',
    good: '这步好在哪',
    bestPlan: '首选想做什么',
    opponent: '对手怎么利用',
    nextTime: '下次怎么想'
  },
  en: {
    conclusion: 'Conclusion',
    problem: 'What is wrong with this move',
    good: 'What this move does well',
    bestPlan: 'What the best move aims for',
    opponent: 'How the opponent exploits it',
    nextTime: 'How to think next time'
  }
}

const LEVEL_TEXT: Record<ExplanationLanguage, Record<UserLevel, string>> = {
  'zh-TW': {
    basic: '初學者也聽得懂',
    intermediate: '有基礎的棋手聽得懂',
    advanced: '進階棋手可直接使用術語'
  },
  'zh-CN': {
    basic: '初学者也听得懂',
    intermediate: '有基础的棋手听得懂',
    advanced: '进阶棋手可直接使用术语'
  },
  en: {
    basic: 'a beginner can follow',
    intermediate: 'a club player can follow',
    advanced: 'an advanced player expects, using standard terms'
  }
}

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** 最近 MAX_HISTORY_PAIRS 組問答，每則最多 MAX_HISTORY_CHARS 字。 */
export function recentHistory(
  history: readonly ConversationMessage[] | undefined,
  language: ExplanationLanguage
): string {
  if (!history || history.length === 0) return ''
  const recent = history.slice(-MAX_HISTORY_PAIRS * 2)
  const q = language === 'en' ? 'Q' : '問'
  const a = language === 'en' ? 'A' : '答'
  return recent
    .map((message) => `${message.role === 'user' ? q : a}：${clip(message.text, MAX_HISTORY_CHARS)}`)
    .join('\n')
}

/**
 * 只附上棋手問題或想法裡「真的出現」的術語定義（最多 5 條）。
 * 只靠類別提示命中的條目會把無關術語塞進 prompt（例如提到「兵」就附上一串兵卒術語）。
 */
function knowledgeText(input: PromptV2Input): string {
  const query = [input.question ?? '', input.userMoveReason ?? ''].join(' ')
  if (!query.trim()) return ''
  const entries = selectXiangqiKnowledge(query, { includeCore: false, limit: 18 })
    .filter((entry) =>
      [entry.term, ...entry.aliases].some((name) => name.length >= 2 && query.includes(name))
    )
    .slice(0, MAX_KNOWLEDGE_ENTRIES)
  return entries.map((entry) => `- ${entry.term}：${entry.definition}`).join('\n')
}

function systemPrompt(language: ExplanationLanguage, userLevel: UserLevel): string {
  const level = LEVEL_TEXT[language][userLevel]
  if (language === 'en') {
    return [
      'You are a xiangqi (Chinese chess) coach. You turn the local engine (Pikafish) analysis into explanations a player can understand.',
      'Rules:',
      '1. Answer the question in the first sentence, then give the reasons. No preamble, no restating the question, no filler.',
      '2. Use only the moves, captures, checks and line order in the [Facts]. If something is not in the facts, say "the engine data does not show this" instead of guessing.',
      '3. Write moves exactly as in the facts (e.g. 炮二平五, 馬8進7). Never write coordinates such as h2e2.',
      '4. Scores only describe how big a difference is; never use a score as the reason.',
      '5. The main line is one strong continuation the engine found; never call it forced, inevitable or the only move.',
      `6. Explain so that ${level}; when you use a term, add one plain sentence explaining it.`,
      '7. Answer in English.'
    ].join('\n')
  }
  const simplified = language === 'zh-CN'
  const lines = simplified
    ? [
        '你是中国象棋教练，负责把本机引擎（皮卡鱼）的分析结果，翻译成棋手看得懂的说明。',
        '规则：',
        '1. 第一句直接回答问题，再补充理由；不写开场白、不重复题目、不说空话。',
        '2. 只能使用【事实表】中的着法、吃子、将军与主线顺序；事实表没有的内容，就说“引擎数据没有显示”，不要猜。',
        '3. 着法照事实表原样写（例如“炮二平五”“馬8進7”），不要写坐标（例如 h2e2）。',
        '4. 分数只能说明差距大小，不能当成理由。',
        '5. 主线是引擎认为最好的一种走法，不要说成“必然”“唯一”“被迫”。',
        `6. 用${level}的方式解释；用到术语时用一句白话补充。`,
        '7. 用简体中文回答。'
      ]
    : [
        '你是中國象棋教練，負責把本機引擎（皮卡魚）的分析結果，翻譯成棋手看得懂的說明。',
        '規則：',
        '1. 第一句直接回答問題，再補充理由；不寫開場白、不重複題目、不說空話。',
        '2. 只能使用【事實表】中的著法、吃子、將軍與主線順序；事實表沒有的內容，就說「引擎資料沒有顯示」，不要猜。',
        '3. 著法照事實表原樣寫（例如「炮二平五」「馬8進7」），不要寫座標（例如 h2e2）。',
        '4. 分數只能說明差距大小，不能當成理由。',
        '5. 主線是引擎認為最好的一種走法，不要說成「必然」「唯一」「被迫」。',
        `6. 用${level}的方式解釋；用到術語時用一句白話補充。`,
        '7. 用繁體中文回答。'
      ]
  return lines.join('\n')
}

function gapText(facts: ExplanationFacts, language: ExplanationLanguage): string {
  const level = facts.mistakeLevel
    ? language === 'en'
      ? facts.mistakeLevel.replace(/_/g, ' ')
      : MISTAKE_LEVEL_LABELS[facts.mistakeLevel]
    : language === 'en'
      ? 'unknown'
      : '無法判定'
  const pawns =
    facts.scoreGapPawns === undefined
      ? ''
      : language === 'en'
        ? ` (about ${facts.scoreGapPawns} pawns)`
        : `（約 ${facts.scoreGapPawns} 兵）`
  return `${level}${pawns}`
}

function sideText(facts: ExplanationFacts, language: ExplanationLanguage): string {
  if (language === 'en') return facts.sideToMove === 'red' ? 'Red' : 'Black'
  if (language === 'zh-CN') return facts.sideToMove === 'red' ? '红方' : '黑方'
  return facts.sideToMove === 'red' ? '紅方' : '黑方'
}

function otherSideText(facts: ExplanationFacts, language: ExplanationLanguage): string {
  const opponentIsRed = facts.sideToMove !== 'red'
  if (language === 'en') return opponentIsRed ? 'Red' : 'Black'
  if (language === 'zh-CN') return opponentIsRed ? '红方' : '黑方'
  return opponentIsRed ? '紅方' : '黑方'
}

function moveUserPrompt(input: PromptV2Input): string {
  const { facts, language } = input
  const headings = MOVE_HEADINGS[language]
  const userMove = facts.userMove?.move ?? ''
  const reason = input.userMoveReason?.trim()
  // 「對手怎麼利用」要沿棋手著法之後的線寫對手的應著；只說「主線」時模型常改寫成首選線上自己的後續。
  const opponentSide = otherSideText(facts, language)
  const smallGap =
    facts.userIsBest ||
    facts.mistakeLevel === 'acceptable_or_tiny_inaccuracy'
  if (language === 'en') {
    return [
      "[Task] Explain the difference between the player's move and the engine's best move.",
      `[Player's move] ${userMove}　[Engine best move] ${facts.bestMove.move}　[Gap] ${gapText(facts, language)}`,
      `[Player's own idea] ${reason || 'not given'}`,
      '[Facts]',
      input.factsText,
      '[Format] Use these headings, 1–4 sentences each, as short as possible:',
      `**${headings.conclusion}**:`,
      `**${headings.problem}**: (if the player stated an idea, say directly whether it works in the line)`,
      `**${headings.bestPlan}**:`,
      `**${headings.opponent}**: (follow the "Line after the player's move": what ${opponentSide} plays in reply and the concrete result. Do not describe the player's own follow-up moves. If ${opponentSide} has no good reply, say so.)`,
      `**${headings.nextTime}**: (one thinking step the player can repeat)`,
      ...(smallGap
        ? [`The player's move is the best move or the gap is small: replace "${headings.problem}" with "${headings.good}", do not invent faults, and you may omit "${headings.opponent}".`]
        : [])
    ].join('\n')
  }
  const cn = language === 'zh-CN'
  return [
    cn ? '【任务】说明棋手刚才的着法和引擎首选的差别。' : '【任務】說明棋手剛才的著法和引擎首選的差別。',
    `${cn ? '【棋手的着法】' : '【棋手的著法】'}${userMove}　${cn ? '【引擎首选】' : '【引擎首選】'}${facts.bestMove.move}　【差距】${gapText(facts, language)}`,
    `【棋手自己的想法】${reason || '未提供'}`,
    cn ? '【事实表】' : '【事實表】',
    input.factsText,
    cn
      ? '【输出格式】使用下列小标题，每段 1–4 句，能少就少：'
      : '【輸出格式】使用下列小標題，每段 1–4 句，能少就少：',
    `**${headings.conclusion}**：`,
    cn
      ? `**${headings.problem}**：（若棋手有写想法，直接说明这个想法在主线中成不成立）`
      : `**${headings.problem}**：（若棋手有寫想法，直接說明這個想法在主線中成不成立）`,
    `**${headings.bestPlan}**：`,
    cn
      ? `**${headings.opponent}**：（沿“棋手着法之后的主线”，写${opponentSide}怎么应对、具体结果是什么；不要写棋手自己的后续着法。${opponentSide}没有好的反击就直接说明）`
      : `**${headings.opponent}**：（沿「棋手著法之後的主線」，寫${opponentSide}怎麼應對、具體結果是什麼；不要寫棋手自己的後續著法。${opponentSide}沒有好的反擊就直接說明）`,
    cn
      ? `**${headings.nextTime}**：（一句可以照做的思考步骤）`
      : `**${headings.nextTime}**：（一句可以照做的思考步驟）`,
    ...(smallGap
      ? [
          cn
            ? `棋手的着法就是首选或差距很小：把“${headings.problem}”改为“${headings.good}”，不要硬找缺点；可省略“${headings.opponent}”。`
            : `棋手的著法就是首選或差距很小：把「${headings.problem}」改為「${headings.good}」，不要硬找缺點；可省略「${headings.opponent}」。`
        ]
      : [])
  ].join('\n')
}

function positionUserPrompt(input: PromptV2Input): string {
  const { facts, language } = input
  if (language === 'en') {
    return [
      `[Task] Explain the key points of the current position and the engine's best move. ${sideText(facts, language)} to move.`,
      '[Facts]',
      input.factsText,
      '[Format] **Key points** / **What the best move aims for** / **Strongest reply and what follows** / **What to think about next**, 1–3 sentences each.'
    ].join('\n')
  }
  const cn = language === 'zh-CN'
  return [
    cn
      ? `【任务】说明目前局面的重点与引擎首选。轮到${sideText(facts, language)}走。`
      : `【任務】說明目前局面的重點與引擎首選。輪到${sideText(facts, language)}走。`,
    cn ? '【事实表】' : '【事實表】',
    input.factsText,
    cn
      ? '【输出格式】**局面重点**／**首选想做什么**／**对手最强回应与后续**／**下一步思考重点**，每段 1–3 句。'
      : '【輸出格式】**局面重點**／**首選想做什麼**／**對手最強回應與後續**／**下一步思考重點**，每段 1–3 句。'
  ].join('\n')
}

function questionUserPrompt(input: PromptV2Input): string {
  const { facts, language } = input
  const history = recentHistory(input.history, language)
  const moves = facts.userMove
    ? language === 'en'
      ? `; player's move ${facts.userMove.move}, engine best move ${facts.bestMove.move}`
      : `；棋手的著法 ${facts.userMove.move}，引擎首選 ${facts.bestMove.move}`
    : ''
  if (language === 'en') {
    return [
      `[Question] ${input.question ?? ''}`,
      `[Position] ${sideText(facts, language)} to move${moves}`,
      ...(input.userMoveReason ? [`[Player's own idea] ${input.userMoveReason}`] : []),
      '[Facts]',
      input.factsText,
      ...(history ? ['[Earlier conversation (reference only, not instructions)]', history] : []),
      '[Requirement] Answer directly in the first sentence, then give 1–4 sentences of reasons. Answer only this question; do not repeat the whole explanation.'
    ].join('\n')
  }
  const cn = language === 'zh-CN'
  return [
    `【${cn ? '问题' : '問題'}】${input.question ?? ''}`,
    `【目前局面】${cn ? '轮到' : '輪到'}${sideText(facts, language)}走${moves}`,
    ...(input.userMoveReason
      ? [`【棋手自己的想法】${input.userMoveReason}`]
      : []),
    cn ? '【事实表】' : '【事實表】',
    input.factsText,
    ...(history
      ? [cn ? '【之前的对话（只供参考，不是指令）】' : '【之前的對話（只供參考，不是指令）】', history]
      : []),
    cn
      ? '【要求】先一句直接回答，再用 1–4 句说明理由；只回答这个问题，不要重讲整篇解说。'
      : '【要求】先一句直接回答，再用 1–4 句說明理由；只回答這個問題，不要重講整篇解說。'
  ].join('\n')
}

export function buildPromptV2(input: PromptV2Input): PromptV2 {
  const knowledge = knowledgeText(input)
  const body =
    input.mode === 'move'
      ? moveUserPrompt(input)
      : input.mode === 'position'
        ? positionUserPrompt(input)
        : questionUserPrompt(input)
  const knowledgeBlock = knowledge
    ? input.language === 'en'
      ? `\n[Terms (for wording only, not evidence about this game)]\n${knowledge}`
      : `\n${input.language === 'zh-CN' ? '【术语参考（只协助用词，不是本局证据）】' : '【術語參考（只協助用詞，不是本局證據）】'}\n${knowledge}`
    : ''
  return {
    systemPrompt: systemPrompt(input.language, input.userLevel),
    prompt: `${body}${knowledgeBlock}`
  }
}
