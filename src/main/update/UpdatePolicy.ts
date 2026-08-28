export interface UpdatePolicyAdapter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
}

/**
 * 自动检查只负责发现新版本。使用者确认一次后才下载，并在下载完成后
 * 直接安装与重新启动，避免在未询问时占用频宽或改变本机版本。
 */
export function configureUpdatePolicy(updater: UpdatePolicyAdapter): void {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
}
