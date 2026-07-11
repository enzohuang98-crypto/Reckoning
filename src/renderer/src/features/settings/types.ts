import type { AppSettings } from '@shared/types/Settings'

export type SettingsCategory = 'ai' | 'engines' | 'harness' | 'system'
export type SettingsUpdater = (patch: Partial<AppSettings>) => void
