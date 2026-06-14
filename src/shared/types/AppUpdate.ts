export type AppUpdatePhase =
  | 'unsupported'
  | 'unconfigured'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateStatus {
  phase: AppUpdatePhase
  currentVersion: string
  availableVersion?: string
  downloadPercent?: number
  automaticChecksEnabled: boolean
  message: string
}
