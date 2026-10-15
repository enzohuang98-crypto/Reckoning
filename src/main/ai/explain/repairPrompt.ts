import type { ExplanationLanguage } from '@shared/types/AIExplanationTypes'
import type { AnswerIssue, HardErrorCode } from '@shared/logic/ai/AnswerCheck'

export const MAX_PREVIOUS_ANSWER_CHARS = 2_000

export interface RepairPromptInput {
  language: ExplanationLanguage
  errors: readonly AnswerIssue<HardErrorCode>[]
  factsText: string
  previousAnswer: string
}

/**
 * 修正 prompt：附上逐條錯誤、事實表與上一次的回答，請模型輸出完整、精簡的修正版。
 * 與原本的 system prompt 搭配使用（規則不變）。
 */
export function buildRepairPrompt(input: RepairPromptInput): string {
  const previous =
    input.previousAnswer.length > MAX_PREVIOUS_ANSWER_CHARS
      ? `${input.previousAnswer.slice(0, MAX_PREVIOUS_ANSWER_CHARS)}…`
      : input.previousAnswer
  const errors = input.errors.map((error) => `- ${error.message}`).join('\n')
  if (input.language === 'en') {
    return [
      'Your previous answer had the problems below. Fix them and output the complete answer again (same format, keep it concise):',
      errors,
      '[Facts]',
      input.factsText,
      '[Your previous answer]',
      previous
    ].join('\n')
  }
  const cn = input.language === 'zh-CN'
  return [
    cn
      ? '你上一次的回答有以下问题，请修正后重新输出完整回答（格式不变、保持精简）：'
      : '你上一次的回答有以下問題，請修正後重新輸出完整回答（格式不變、保持精簡）：',
    errors,
    cn ? '【事实表】' : '【事實表】',
    input.factsText,
    cn ? '【你上一次的回答】' : '【你上一次的回答】',
    previous
  ].join('\n')
}
