export interface UpdatePolicyAdapter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
}

/**
 * 新版本自动下载，但永远不会因为一般关闭程式就静默安装。
 * 安装只允许由明确的「重新启动并安装」IPC 动作触发。
 */
export function configureUpdatePolicy(updater: UpdatePolicyAdapter): void {
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = false
}
