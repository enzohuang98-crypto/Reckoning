/**
 * AI 解釋請求/回應型別 — SDS v0.2 §2.17.9
 *
 * AIExplanationRequest 由 main process 的 buildAIExplanationRequest() 組裝：
 * prompt 來自 PromptBuilder（只讀 EngineAnalysis / MoveComparisonResult /
 * userLevel / explanationStyle，禁止使用 EngineScore.raw），
 * apiKey 來自 SecretStore。renderer 永遠接觸不到此型別的實例。
 */

import type { AIProviderId, TokenUsage } from './AIProviderTypes'
import type { UserLevel } from './Settings'

/** 解釋語言（本專案擴充） */
export type ExplanationLanguage = 'zh-TW' | 'zh-CN' | 'en'

/** 解釋風格（§2.17.3；第一版僅長篇分析） */
export type ExplanationStyle = 'long_analytical'

/** AI 解釋請求（§2.17.9；只存在於 main process） */
export interface AIExplanationRequest {
  provider: AIProviderId
  model: string
  /** 由 SecretStore 注入；不得被 log（§2.11） */
  apiKey: string
  /** 只有 openai-compatible 使用；必須先在 main process 通過 URL 安全驗證。 */
  baseUrl?: string
  /** PromptBuilder 產生的完整 prompt（含防幻覺規則與引擎數據） */
  prompt: string
  /** 選填的 system 指令；provider 以各自的 system 欄位送出，未提供時行為不變。 */
  systemPrompt?: string
  /**
   * 推理控制：auto 依模型能力盡量關閉推理；off_strict 用最嚴格的關閉方式
   * （空白／截斷後的重試使用）。只有支援推理參數的 provider 會使用。
   */
  reasoningMode?: 'auto' | 'off_strict'
  /** 本次模型呼叫的輸出上限。 */
  maxOutputTokens?: number
  /** 內部 Harness 需要可解析物件時，要求支援的 Provider 回傳 JSON。 */
  responseFormat?: 'text' | 'json'
  metadata: {
    requestId: string
    analysisId: string
    userLevel: UserLevel
    explanationStyle: ExplanationStyle
  }
}

/** AI 解釋回應（單次模式；streaming 介面見 ipc.ts) */
export interface AIExplanationResponse {
  /** 解釋文字 */
  text: string
  provider: AIProviderId
  model: string
  /** Token 用量（若 Provider 有回報） */
  usage?: TokenUsage
  /** 服務回報的結束原因（stop／length…）。 */
  finishReason?: string
  /** 服務實際回報的模型（可能是所選模型的變體名稱）。 */
  actualModel?: string
  /** provider 內部為了這次回答實際送出的請求數（例如不帶推理參數重送）；未提供視為 1。 */
  providerAttempts?: number
  /** 產生時間 (epoch ms) */
  createdAt: number
  /**
   * 護欄旗標：此解釋僅依據引擎結構化資料產生。
   * 永遠為 true，作為設計契約的明示標記。
   */
  groundedOnEngineData: true
}
