export interface UpdatePolicyAdapter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
}

/**
 * 自动检查只负责发现新版本。下载与安装都必须由使用者明确同意，
 * 避免在未询问时占用频宽或改变本机版本。
 */
export function configureUpdatePolicy(updater: UpdatePolicyAdapter): void {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
}
