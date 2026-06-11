/**
 * AI Provider 型別與介面 (AI provider types & interface) — SDS v0.2 §2.17
 *
 * 設計原則：引擎負責棋力判斷，LLM 只負責「解釋」結構化引擎資料，
 * 不得自行發明不在引擎資料中的戰術。
 *
 * Provider 為無狀態 adapter（§2.17.8 getAIProvider 合約）：
 * API key 與 prompt 由 AIExplanationRequest 帶入，不存於 provider 實例。
 */

import type { AIExplanationRequest, AIExplanationResponse } from './AIExplanationTypes'

/** 支援的 Provider 識別碼 */
export type AIProviderId = 'anthropic' | 'openai' | 'gemini'

/** 所有 Provider 識別碼（UI 列舉用） */
export const ALL_PROVIDER_IDS: AIProviderId[] = ['anthropic', 'openai', 'gemini']

/** Provider 顯示名稱 */
export const PROVIDER_LABEL: Record<AIProviderId, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini'
}

/** Token 用量 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

/** 模型資訊（UI 下拉用；定價與完整資料於 SDS Stage 7 移交 ModelRegistry） */
export interface AIModelInfo {
  /** 真實 API model id，不得用 "default"（§2.19.4） */
  id: string
  /** 顯示名稱 */
  label: string
  /** 是否為該 Provider 預設模型 */
  isDefault?: boolean
}

/**
 * Streaming chunk（§2.17.4）。
 * done chunk 不含 finalText；完整文字由 main process 以 accumulatedText 累積。
 */
export type AIExplanationStreamChunk =
  | { type: 'text_delta'; deltaText: string }
  | {
      type: 'done'
      usage?: TokenUsage
      estimatedCostUsd?: number | null
    }

/**
 * AI Provider 介面（§2.17.4）。
 * generateExplanationStream 必須接收 AbortSignal 以支援取消；
 * SDK 不支援 signal 時，adapter 至少要在每次 yield 前檢查 signal.aborted。
 * 尚未支援真 streaming 的 provider 仍須包裝成相同介面
 * （先等完整回應，再以單一 text_delta chunk 回傳，最後送 done；§2.17.1）。
 */
export interface AIProvider {
  readonly id: AIProviderId
  readonly displayName: string
  /** 單次模式：根據已組裝的 prompt 產生解釋；request 含 apiKey 與 model */
  generateExplanation(
    request: AIExplanationRequest,
    signal?: AbortSignal
  ): Promise<AIExplanationResponse>
  /** Streaming 模式（§2.17.4）；IPC 層唯一使用的入口 */
  generateExplanationStream(
    request: AIExplanationRequest,
    signal: AbortSignal
  ): AsyncIterable<AIExplanationStreamChunk>
}

/** 各 Provider 預設模型清單（依 SDS §2.19.2 模型表） */
export const PROVIDER_DEFAULT_MODELS: Record<AIProviderId, AIModelInfo[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', isDefault: true },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
  ],
  openai: [
    { id: 'gpt-5.4', label: 'GPT-5.4', isDefault: true },
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' }
  ],
  gemini: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', isDefault: true },
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' }
  ]
}
