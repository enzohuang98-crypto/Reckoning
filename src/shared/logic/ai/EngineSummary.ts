/**
 * 引擎重點摘要（非 AI 生成）。
 *
 * AI 回答兩次都沒通過客觀檢查、或模型無法回應時的退路：完全由事實表產生，
 * 明確標示「非 AI 生成」與原因，讓棋手仍拿到可用的引擎結論，而不是空白畫面。
 */

import type { ExplanationLanguage } from '../../types/AIExplanationTypes'
import { MISTAKE_LEVEL_LABELS } from '../../types/MoveComparisonResult'
import {
  formatFactDifference,
  FACT_LABELS,
  summarizeLine,
  type ExplanationFacts,
  type IdeaFact,
  type LineFacts
} from '../analysis/ExplanationFacts'

export const ENGINE_SUMMARY_MARKER: Record<ExplanationLanguage, string> = {
  'zh-TW': '引擎重點摘要（非 AI 生成）',
  'zh-CN': '引擎重点摘要（非 AI 生成）',
  en: 'Engine summary (not AI-generated)'
}

function lineText(line: LineFacts, language: ExplanationLanguage): string {
  const { moves, events } = summarizeLine(line, language)
  if (moves.length === 0) return language === 'en' ? 'not available' : '無'
  const eventText =
    events.length === 0
      ? ''
      : language === 'en'
        ? ` (${events.join('; ')})`
        : `（${events.join('；')}）`
  return `${moves.join(' ')}${eventText}`
}

/** 關鍵著法檢查的一條：「如果…」走到關鍵那一手為止，並點名那一手。 */
function ideaText(idea: IdeaFact, facts: ExplanationFacts, language: ExplanationLanguage): string {
  const labels = FACT_LABELS[language]
  const other = facts.sideToMove === 'red' ? 'black' : 'red'
  const title = labels.ideaTitle[idea.kind](labels.side[facts.sideToMove], labels.side[other], idea.reply ?? '')
  const moves = idea.line.plies.slice(0, idea.keyPly).map((ply) => ply.move).join(' ')
  const key = idea.line.plies[idea.keyPly - 1]?.move ?? ''
  if (language === 'en') return `${title}: ${moves} (key: ${key})`
  return `${title}：${moves}（${language === 'zh-CN' ? '关键' : '關鍵'}：${key}）`
}

export function buildEngineSummary(
  facts: ExplanationFacts,
  reason: string,
  language: ExplanationLanguage = 'zh-TW'
): string {
  const labels = FACT_LABELS[language]
  const gap = facts.mistakeLevel
    ? language === 'en'
      ? facts.mistakeLevel.replace(/_/g, ' ')
      : MISTAKE_LEVEL_LABELS[facts.mistakeLevel]
    : null
  const pawns = facts.scoreGapPawns
  const firstDifference = facts.differences[0]
    ? formatFactDifference(facts.differences[0], labels)
    : null
  if (language === 'en') {
    return [
      `⚠ The AI explanation did not pass the checks this time (reason: ${reason}). Below is the engine summary (not AI-generated):`,
      facts.userMove
        ? `• Your move: ${facts.userMove.move}; engine best move: ${facts.bestMove.move}${gap ? `; gap: ${gap}${pawns !== undefined ? ` (about ${pawns} pawns)` : ''}` : ''}`
        : `• Engine best move: ${facts.bestMove.move}`,
      `• Line after the best move: ${lineText(facts.bestLine, language)}`,
      ...(facts.userLine ? [`• Line after your move: ${lineText(facts.userLine, language)}`] : []),
      ...(facts.userIsBest ? ["• Your move is the engine's best move."] : []),
      ...(firstDifference ? [`• Key difference: ${firstDifference}`] : []),
      ...(facts.ideas ?? []).map((idea) => `• ${ideaText(idea, facts, language)}`),
      'You can press "Retry AI" or choose another model in Settings.'
    ].join('\n')
  }
  const cn = language === 'zh-CN'
  return [
    cn
      ? `⚠ AI 解说这次没有通过检查（原因：${reason}）。以下是${ENGINE_SUMMARY_MARKER['zh-CN']}：`
      : `⚠ AI 解說這次沒有通過檢查（原因：${reason}）。以下是${ENGINE_SUMMARY_MARKER['zh-TW']}：`,
    facts.userMove
      ? `‧ ${cn ? '你的着法' : '你的著法'}：${facts.userMove.move}；${cn ? '引擎首选' : '引擎首選'}：${facts.bestMove.move}${
          gap ? `；差距：${gap}${pawns !== undefined ? `（約 ${pawns} 兵）` : ''}` : ''
        }`
      : `‧ ${cn ? '引擎首选' : '引擎首選'}：${facts.bestMove.move}`,
    `‧ ${cn ? '首选之后的主线' : '首選之後的主線'}：${lineText(facts.bestLine, language)}`,
    ...(facts.userLine
      ? [`‧ ${cn ? '你的着法之后的主线' : '你的著法之後的主線'}：${lineText(facts.userLine, language)}`]
      : []),
    ...(facts.userIsBest ? [cn ? '‧ 你的着法就是引擎首选。' : '‧ 你的著法就是引擎首選。'] : []),
    ...(firstDifference ? [`‧ ${cn ? '关键差异' : '關鍵差異'}：${firstDifference}`] : []),
    ...(facts.ideas ?? []).map((idea) => `‧ ${ideaText(idea, facts, language)}`),
    cn
      ? '可以按“重试 AI”再试一次，或到设定更换模型。'
      : '可以按「重試 AI」再試一次，或到設定更換模型。'
  ].join('\n')
}
