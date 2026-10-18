/**
 * 解說事實表 (ExplanationFacts) — v2 解說管線的事實來源（純函式）。
 *
 * 由程式逐手重播引擎主線，算出「誰走、哪個子、吃了什麼、是否將軍、走後威脅與有無保護、
 * 線末是否將死／困斃、兩條線的關鍵差異」。AI 只負責把這些事實講成人話，
 * 不再自己從 FEN 推棋盤（免費模型在這一步最常出錯）。
 *
 * 只產生客觀描述，不做戰略判斷；分數只取 comparableValue（兵）或殺棋的 displayText，絕不使用 EngineScore.raw。
 *
 * 模組結構（外部一律從本檔匯入：`analysis/ExplanationFacts`）：
 * - types.ts      事實表型別與上限常數
 * - lineFacts.ts  逐手重播一條主線（吃子、將軍、新威脅／吃回、唯一合法著法、將死／困斃）
 * - buildFacts.ts 組出整張事實表（兩線、評估、差距、候選、兩線差異、關鍵著法檢查、殘局棋子清單）
 * - score.ts      引擎分數 → 事實表評估（兵／殺 N）
 * - queries.ts    給 AnswerCheck／AnswerTidy 的查詢（著法集合、唯一著法、吃子／將軍事件）
 * - labels.ts     zh-TW／zh-CN／en 字串表
 * - format.ts     事實表文字（formatFactsForPrompt）與單線摘要（summarizeLine）
 * - common.ts     模組內共用的小工具
 */

export {
  MAX_FACT_LINE_PLIES,
  MAX_FACT_THREATS,
  MAX_FACT_DIFFERENCES,
  MAX_FACTS_PROMPT_CHARS,
  MAX_INVENTORY_PIECES,
  type PlyDescriptor,
  type ThreatFact,
  type PlyFact,
  type LineFacts,
  type FactScore,
  type MoveFact,
  type FactDifference,
  type IdeaKind,
  type IdeaFact,
  type ExplanationFacts
} from './types'
export { buildLineFacts } from './lineFacts'
export { buildExplanationFacts } from './buildFacts'
export { factMoveSet, factOnlyLegalMoves, factMoveEvents } from './queries'
export { formatFactsForPrompt, summarizeLine, formatDifference as formatFactDifference } from './format'
export { LABELS as FACT_LABELS } from './labels'
