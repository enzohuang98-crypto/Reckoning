/**
 * 檢查前對模型回答做「不改變意思」的機械修整（純函式）。
 *
 * P3-9 live 中，兩則內容正確的回答只因用字被擋成引擎摘要：
 * - 把提示標籤「事實表」寫進回答。事實表本來就是由引擎資料算出來的，換成「引擎資料」意思不變；
 * - 黑方著法混用數字（例如「馬8進七」）。象棋記譜紅方用中文數字、黑方用阿拉伯數字，
 *   這種混寫可依第一個數字判斷是哪一方，改回事實表的寫法。
 * 只在換完後「恰好對上事實表裡的一步」時才改寫著法；對不上的照舊交給 AnswerCheck 判 H4。
 */

import type { ExplanationLanguage } from '../../types/AIExplanationTypes'
import { factMoveSet, type ExplanationFacts } from '../analysis/ExplanationFacts'
import { normalizeMoveText } from './AnswerCheck'

const LABEL_REPLACEMENTS: Record<ExplanationLanguage, Array<[RegExp, string]>> = {
  'zh-TW': [[/【?事實表】?/g, '引擎資料'], [/【?事实表】?/g, '引擎資料']],
  'zh-CN': [[/【?事实表】?/g, '引擎数据'], [/【?事實表】?/g, '引擎数据']],
  en: [[/\[Facts\]|\bthe fact table\b|\bfact table\b/gi, 'the engine data']]
}

const CHINESE_DIGITS = '一二三四五六七八九'
const ARABIC_DIGITS = '123456789'
const PIECE_CHARS = '車车俥馬马傌炮砲包相象仕士帥帅將将兵卒'
const DIGIT_CHARS = `${CHINESE_DIGITS}${ARABIC_DIGITS}１-９`
const MIXED_MOVE = new RegExp(
  `(?:[前中後后][${PIECE_CHARS}]|[${PIECE_CHARS}][${DIGIT_CHARS}])[進进退平][${DIGIT_CHARS}]`,
  'g'
)

function toScript(move: string, script: 'chinese' | 'arabic'): string {
  return [...normalizeMoveText(move)]
    .map((char) => {
      const chinese = CHINESE_DIGITS.indexOf(char)
      const arabic = ARABIC_DIGITS.indexOf(char)
      if (script === 'arabic' && chinese >= 0) return ARABIC_DIGITS[chinese]
      if (script === 'chinese' && arabic >= 0) return CHINESE_DIGITS[arabic]
      return char
    })
    .join('')
}

/** 把混用數字的著法改回事實表裡唯一對得上的寫法；對不上或有歧義就不動。 */
function repairMoveNotation(text: string, facts: ExplanationFacts): string {
  const known = new Map<string, string>()
  for (const move of factMoveSet(facts)) known.set(normalizeMoveText(move), move)
  return text.replace(MIXED_MOVE, (raw) => {
    if (known.has(normalizeMoveText(raw))) return raw
    const firstDigit = [...normalizeMoveText(raw)].find(
      (char) => CHINESE_DIGITS.includes(char) || ARABIC_DIGITS.includes(char)
    )
    // 以第一個數字的寫法判斷是紅（中文數字）還是黑（阿拉伯數字）。
    const scripts: Array<'chinese' | 'arabic'> = firstDigit
      ? [CHINESE_DIGITS.includes(firstDigit) ? 'chinese' : 'arabic']
      : ['chinese', 'arabic']
    const matches = [...new Set(scripts.map((script) => known.get(toScript(raw, script))).filter(Boolean))]
    return matches.length === 1 ? (matches[0] as string) : raw
  })
}

export function tidyAnswerText(text: string, facts: ExplanationFacts, language: ExplanationLanguage): string {
  let tidied = text
  for (const [pattern, replacement] of LABEL_REPLACEMENTS[language]) {
    tidied = tidied.replace(pattern, replacement)
  }
  return repairMoveNotation(tidied, facts)
}
