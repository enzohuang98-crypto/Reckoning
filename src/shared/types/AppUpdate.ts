export type AppUpdatePhase =
  | 'unsupported'
  | 'unconfigured'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdatePreferences {
  backgroundPreparationEnabled: boolean
  skippedVersion: string | null
  snoozedVersion: string | null
  snoozeUntil: number | null
}

export interface LegacyUpdatePreferences {
  skippedVersion: string | null
  snoozedVersion: string | null
  snoozeUntil: number | null
}

export interface AppUpdateStatus {
  phase: AppUpdatePhase
  currentVersion: string
  availableVersion?: string
  downloadPercent?: number
  automaticChecksEnabled: boolean
  preferences: UpdatePreferences
  promptSuppressed: boolean
  message: string
}
