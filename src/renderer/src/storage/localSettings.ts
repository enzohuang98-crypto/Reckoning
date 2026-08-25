/**
 * Renderer 本機儲存 (localStorage)
 *
 * 一般設定仍存於 localStorage。
 * 重要：此處絕不存放 API 金鑰，金鑰一律走 window.api.secret（SecretStore）。
 */

import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/Settings'
import { ALL_PROVIDER_IDS, type AIProviderId } from '@shared/types/AIProviderTypes'
import { normalizeSettings } from '@shared/logic/validation/ValidationUtils'

const SETTINGS_KEY = 'xiangqi.settings'
/** 初始設定嚮導完成旗標（'1' = 不再顯示嚮導） */
const SETUP_COMPLETED_KEY = 'setup_completed'

export function isSetupCompleted(): boolean {
  try {
    return localStorage.getItem(SETUP_COMPLETED_KEY) === '1'
  } catch {
    return false
  }
}

export interface LocalStorageWriteResult {
  ok: boolean
  message?: string
}

function safeSetItem(key: string, value: string): LocalStorageWriteResult {
  try {
    localStorage.setItem(key, value)
    return { ok: true }
  } catch {
    return {
      ok: false,
      message: '本機設定儲存失敗，畫面內容仍保留；請稍後重試。'
    }
  }
}

export function markSetupCompleted(): LocalStorageWriteResult {
  return safeSetItem(SETUP_COMPLETED_KEY, '1')
}

/** v1 設定形狀（SDS v0.2 之前），僅供遷移 */
interface LegacySettingsV1 {
  activeProvider?: AIProviderId
  selectedModels?: Partial<Record<AIProviderId, string>>
  language?: AppSettings['language']
  engineMultiPv?: number
  version?: number
}

/** 將 v1 設定遷移為 v2（SDS v0.2 形狀）；無法對應的欄位用預設值 */
function migrateSettings(raw: Record<string, unknown>): AppSettings {
  const legacy = raw as LegacySettingsV1
  const aiProvider =
    legacy.activeProvider && ALL_PROVIDER_IDS.includes(legacy.activeProvider)
      ? legacy.activeProvider
      : DEFAULT_SETTINGS.aiProvider
  const migrated: AppSettings = {
    ...DEFAULT_SETTINGS,
    aiProvider,
    aiModel: legacy.selectedModels?.[aiProvider] ?? DEFAULT_SETTINGS.aiModel,
    multiPv: typeof legacy.engineMultiPv === 'number' ? legacy.engineMultiPv : DEFAULT_SETTINGS.multiPv,
    language: legacy.language ?? DEFAULT_SETTINGS.language
  }
  void saveSettings(migrated)
  return migrated
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.version !== DEFAULT_SETTINGS.version) return migrateSettings(parsed)
    return normalizeSettings(parsed, DEFAULT_SETTINGS)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): LocalStorageWriteResult {
  return safeSetItem(SETTINGS_KEY, JSON.stringify(settings))
}
