/**
 * 應用程式一般設定型別 (App settings) — SDS v0.2 §2.6.7
 *
 * 重要：一般設定儲存於 localStorage，絕對不包含 API 金鑰。
 * API 金鑰一律經由 SecretStore（主行程 safeStorage 加密）儲存。
 */

import type { AIProviderId } from './AIProviderTypes'
import type { ExplanationLanguage } from './AIExplanationTypes'
import type { HarnessAnswerMode } from './Harness'

/** 使用者棋力（§2.6.7），影響 AI 解說深淺 */
export type UserLevel = 'basic' | 'intermediate' | 'advanced'

/** 一般設定（可安全存入 localStorage） */
export interface AppSettings {
  /** root 分析思考時間 (ms)（§2.6.7 預設 3000） */
  rootAnalysisMovetimeMs: number
  /** userMove 二次分析思考時間 (ms)（§2.15.6 預設 1000） */
  userMoveEvalMovetimeMs: number
  /** MultiPV 候選著法數 */
  multiPv: number
  /** AI Provider */
  aiProvider: AIProviderId
  /** 真實 API model id，不得用 "default"（§2.19.4） */
  aiModel: string
  /** 使用者棋力 */
  userLevel: UserLevel
  /** 解說語言（本專案擴充，SDS 未定義） */
  language: ExplanationLanguage
  crossEngineEnabled: boolean
  harnessAnswerMode: HarnessAnswerMode
  harnessAutoRun: boolean
  harnessReuseEvidence: boolean
  harnessEngineTimeMs: number
  harnessMaxEngineRounds: number
  harnessResearchMaxModelCalls: number
  harnessResearchMaxOutputTokens: number
  harnessFocusedMaxModelCalls: number
  harnessFocusedMaxOutputTokens: number
  /** schema 版本 */
  version: number
}

/** 預設一般設定（§2.6.7 DEFAULT_APP_SETTINGS + language） */
export const DEFAULT_SETTINGS: AppSettings = {
  rootAnalysisMovetimeMs: 3000,
  userMoveEvalMovetimeMs: 1000,
  multiPv: 3,
  aiProvider: 'anthropic',
  aiModel: 'claude-sonnet-4-6',
  userLevel: 'intermediate',
  language: 'zh-TW',
  crossEngineEnabled: false,
  harnessAnswerMode: 'research',
  harnessAutoRun: false,
  harnessReuseEvidence: false,
  harnessEngineTimeMs: 20_000,
  harnessMaxEngineRounds: 3,
  harnessResearchMaxModelCalls: 6,
  harnessResearchMaxOutputTokens: 10_000,
  harnessFocusedMaxModelCalls: 4,
  harnessFocusedMaxOutputTokens: 4_000,
  version: 3
}
