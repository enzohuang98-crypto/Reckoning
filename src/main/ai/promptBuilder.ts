/**
 * AI 解釋 prompt 建構器 (Prompt builder)
 *
 * 將結構化引擎資料轉為提示詞。
 * 設計鐵則：LLM 只能解釋引擎提供的資料，不得發明不在引擎資料中的戰術。
 * 因此 system prompt 明確要求模型「只根據以下引擎數據解釋」。
 */

import { formatScore } from '@shared/types/EngineAnalysis'
import type { AIExplanationRequest, ExplanationLanguage } from '@shared/types/AIExplanationTypes'
import { MOVE_QUALITY_LABELS } from '@shared/types/MoveComparisonResult'

const LANGUAGE_NAME: Record<ExplanationLanguage, string> = {
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  en: 'English'
}

export function buildSystemPrompt(language: ExplanationLanguage): string {
  return [
    `你是一位中國象棋講解助理。請以 ${LANGUAGE_NAME[language]} 回答。`,
    '嚴格規則：',
    '1. 你只能根據下方提供的「引擎分析數據」進行解釋。',
    '2. 不得發明、臆測任何不在引擎數據中的戰術、殺法或變例。',
    '3. 若引擎數據不足以支持某結論，請明說資料不足，不要編造。',
    '4. 引擎（Pikafish）負責棋力判斷；你的工作是把這些結構化數據翻譯成人類易懂的解說。',
    '請用簡潔、條理清楚的方式說明：局面評估、最佳著法的理由、以及（若有）實際著法為何較差。'
  ].join('\n')
}

export function buildUserPrompt(request: AIExplanationRequest): string {
  const { engineAnalysis: ea, comparison } = request
  const lines: string[] = []

  lines.push(`局面 FEN：${request.fen}`)
  lines.push(`輪走方：${request.sideToMove === 'red' ? '紅方' : '黑方'}`)
  lines.push('')
  lines.push(`【引擎分析數據（${ea.engineName}，深度 ${ea.depth}）】`)
  lines.push(`局面評估：${formatScore(ea.score)}（正值對輪走方有利）`)
  lines.push('候選著法（由強到弱）：')
  ea.lines.forEach((line, i) => {
    lines.push(
      `  ${i + 1}. ${line.bestMoveUci}　評估 ${formatScore(line.score)}　變例：${line.pv
        .slice(0, 6)
        .join(' ')}`
    )
  })

  if (comparison) {
    lines.push('')
    lines.push('【實際著法比較】')
    lines.push(`實際著法：${comparison.playedMoveUci}`)
    lines.push(`引擎最佳：${comparison.bestMoveUci}`)
    lines.push(
      `厘子損失：${comparison.centipawnLoss}　等級：${
        MOVE_QUALITY_LABELS[comparison.quality]
      }（信心 ${comparison.confidence}）`
    )
  }

  lines.push('')
  lines.push('請根據上述「引擎分析數據」解說此局面。')
  return lines.join('\n')
}
