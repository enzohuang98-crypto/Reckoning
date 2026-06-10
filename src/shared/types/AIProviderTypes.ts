/**
 * AI Provider 型別與介面 (AI provider types & interface)
 *
 * 設計原則：Pikafish 負責棋力判斷，LLM 只負責「解釋」結構化引擎資料，
 * 不得自行發明不在引擎資料中的戰術。
 *
 * 第一版完整實作 Anthropic；OpenAI、Gemini 保留 interface（可為 stub）。
 */

import type { AIExplanationRequest, AIExplanationResponse } from './AIExplanationTypes'

/** 支援的 Provider 識別碼 */
export type AIProviderId = 'anthropic' | 'openai' | 'gemini'

/** Token 用量 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

/** 模型資訊 */
export interface AIModelInfo {
  /** 模型 ID，例如 'claude-opus-4-8' */
  id: string
  /** 顯示名稱 */
  label: string
  /** 是否為該 Provider 預設模型 */
  isDefault?: boolean
}

/** Provider 設定 */
export interface AIProviderConfig {
  providerId: AIProviderId
  /** API 金鑰（執行時由 SecretStore 安全提供，絕不寫入一般設定） */
  apiKey: string
  /** 選用模型 */
  model: string
  /** 自訂 base URL（選用） */
  baseUrl?: string
  /** 最大輸出 token */
  maxTokens?: number
  /** 取樣溫度 */
  temperature?: number
}

/**
 * AI Provider 介面。
 * 所有 Provider（Anthropic / OpenAI / Gemini）皆實作此介面。
 */
export interface AIProvider {
  /** Provider 識別碼 */
  readonly id: AIProviderId
  /** 顯示名稱 */
  readonly displayName: string
  /** 列出此 Provider 可用模型 */
  listModels(): AIModelInfo[]
  /** 是否已正確設定（有金鑰與模型） */
  isConfigured(): boolean
  /**
   * 根據結構化引擎資料產生解釋。
   * 實作必須以 request.engineAnalysis 為唯一事實來源。
   */
  generateExplanation(request: AIExplanationRequest): Promise<AIExplanationResponse>
}

/** 各 Provider 預設模型清單 */
export const PROVIDER_DEFAULT_MODELS: Record<AIProviderId, AIModelInfo[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', isDefault: true },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }
  ],
  openai: [{ id: 'gpt-4o', label: 'GPT-4o (stub)', isDefault: true }],
  gemini: [{ id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (stub)', isDefault: true }]
}
