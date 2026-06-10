/**
 * 應用程式一般設定型別 (General app settings)
 *
 * 重要：一般設定儲存於 localStorage，絕對不包含 API 金鑰。
 * API 金鑰一律經由 SecretStore（主行程 safeStorage 加密）儲存。
 */

import type { AIProviderId, ExplanationLanguage } from './index'

/** 一般設定（可安全存入 localStorage） */
export interface AppSettings {
  /** 目前使用的 Provider */
  activeProvider: AIProviderId
  /** 各 Provider 選用模型 */
  selectedModels: Record<AIProviderId, string>
  /** 解釋語言 */
  language: ExplanationLanguage
  /** 引擎預設搜尋深度 */
  engineDepth: number
  /** 引擎 multipv 候選線數量 */
  engineMultiPv: number
  /** schema 版本 */
  version: number
}

/** 預設一般設定 */
export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'anthropic',
  selectedModels: {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    gemini: 'gemini-1.5-pro'
  },
  language: 'zh-TW',
  engineDepth: 15,
  engineMultiPv: 3,
  version: 1
}
