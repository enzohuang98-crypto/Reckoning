export interface UpdatePolicyAdapter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
}

/**
 * Discovery and background preparation are controlled by AppUpdaterService.
 * Keep the SDK from downloading implicitly or installing when the app quits:
 * only an explicit restart action may call quitAndInstall after data is saved.
 */
export function configureUpdatePolicy(updater: UpdatePolicyAdapter): void {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
}
