/**
 * Renderer 本機儲存 (localStorage)
 *
 * 依 Q2，一般設定與錯題本存於 localStorage。
 * 重要：此處絕不存放 API 金鑰，金鑰一律走 window.api.secret（SecretStore）。
 */

import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/Settings'
import type { MistakeBook, MistakeBookEntry } from '@shared/types/MistakeBookEntry'
import { ALL_PROVIDER_IDS, type AIProviderId } from '@shared/types/AIProviderTypes'

const SETTINGS_KEY = 'xiangqi.settings'
const MISTAKE_BOOK_KEY = 'xiangqi.mistakeBook'
/** 初始設定嚮導完成旗標（'1' = 不再顯示嚮導） */
const SETUP_COMPLETED_KEY = 'setup_completed'

export function isSetupCompleted(): boolean {
  return localStorage.getItem(SETUP_COMPLETED_KEY) === '1'
}

export function markSetupCompleted(): void {
  localStorage.setItem(SETUP_COMPLETED_KEY, '1')
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
  saveSettings(migrated)
  return migrated
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.version !== DEFAULT_SETTINGS.version) return migrateSettings(parsed)
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<AppSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

const EMPTY_BOOK: MistakeBook = { entries: [], version: 2 }

/**
 * 載入錯題本。v1 條目（開發期資料，缺 mistakeLevel 等欄位）無法對應
 * SDS v0.2 形狀，載入時過濾並警告。
 */
export function loadMistakeBook(): MistakeBook {
  try {
    const raw = localStorage.getItem(MISTAKE_BOOK_KEY)
    if (!raw) return EMPTY_BOOK
    const parsed = JSON.parse(raw) as { entries?: unknown[]; version?: number }
    const entries = (parsed.entries ?? []).filter(
      (e): e is MistakeBookEntry =>
        typeof e === 'object' &&
        e !== null &&
        'mistakeLevel' in e &&
        'engineBestMove' in e
    )
    if (entries.length !== (parsed.entries ?? []).length) {
      console.warn('錯題本含舊版（v1）條目，已略過無法遷移的項目。')
    }
    return { entries, version: 2 }
  } catch {
    return EMPTY_BOOK
  }
}

export function saveMistakeBook(book: MistakeBook): void {
  localStorage.setItem(MISTAKE_BOOK_KEY, JSON.stringify(book))
}

export function addMistakeEntry(entry: MistakeBookEntry): MistakeBook {
  const book = loadMistakeBook()
  book.entries.unshift(entry)
  saveMistakeBook(book)
  return book
}

/** 更新單筆錯題（筆記、理解狀態等） */
export function updateMistakeEntry(
  id: string,
  patch: Partial<MistakeBookEntry>
): MistakeBook {
  const book = loadMistakeBook()
  book.entries = book.entries.map((e) =>
    e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e
  )
  saveMistakeBook(book)
  return book
}
