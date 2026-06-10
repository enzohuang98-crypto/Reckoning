/**
 * Renderer 本機儲存 (localStorage)
 *
 * 依 Q2，一般設定與錯題本存於 localStorage。
 * 重要：此處絕不存放 API 金鑰，金鑰一律走 window.api.secret（SecretStore）。
 */

import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/Settings'
import type { MistakeBook, MistakeBookEntry } from '@shared/types/MistakeBookEntry'

const SETTINGS_KEY = 'xiangqi.settings'
const MISTAKE_BOOK_KEY = 'xiangqi.mistakeBook'

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadMistakeBook(): MistakeBook {
  try {
    const raw = localStorage.getItem(MISTAKE_BOOK_KEY)
    if (!raw) return { entries: [], version: 1 }
    return JSON.parse(raw) as MistakeBook
  } catch {
    return { entries: [], version: 1 }
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
