import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import { Icon } from '../components/ui/Icon'

export type AppTab = 'analyze' | 'settings'

export const UPDATE_REMINDER_DELAY_MS = 4 * 60 * 60 * 1000
const SKIPPED_UPDATE_KEY = 'xiangqi-analyzer.skipped-update-version'
const UPDATE_REMINDER_KEY = 'xiangqi-analyzer.update-reminder'

interface UpdateReminder {
  version: string
  remindAfter: number
}

export function shouldShowUpdateDialog(
  version: string,
  skippedVersion: string | null,
  reminder: UpdateReminder | null,
  now: number
): boolean {
  if (skippedVersion === version) return false
  return reminder?.version !== version || reminder.remindAfter <= now
}

function loadSkippedVersion(): string | null {
  try {
    return window.localStorage.getItem(SKIPPED_UPDATE_KEY)
  } catch {
    return null
  }
}

function loadUpdateReminder(): UpdateReminder | null {
  try {
    const raw = window.localStorage.getItem(UPDATE_REMINDER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UpdateReminder>
    return typeof parsed.version === 'string' && Number.isFinite(parsed.remindAfter)
      ? { version: parsed.version, remindAfter: parsed.remindAfter as number }
      : null
  } catch {
    return null
  }
}

function saveSkippedVersion(version: string): void {
  try {
    window.localStorage.setItem(SKIPPED_UPDATE_KEY, version)
  } catch {
    // localStorage 不可用時，當次執行仍由 React 狀態記住選擇。
  }
}

function saveUpdateReminder(reminder: UpdateReminder | null): void {
  try {
    if (reminder) {
      window.localStorage.setItem(UPDATE_REMINDER_KEY, JSON.stringify(reminder))
    } else {
      window.localStorage.removeItem(UPDATE_REMINDER_KEY)
    }
  } catch {
    // localStorage 不可用時，提醒排程仍在當次執行有效。
  }
}

/**
 * 只有「发现新版／下载中」与「已下载待安装」需要主动提示；其余状态
 * （檢查中、已是最新、錯誤）留在設定頁即可，不打擾使用者。
 */
function updatePrompt(
  status: AppUpdateStatus | null
): { label: string; title: string } | null {
  if (status?.phase === 'available') {
    return {
      label: `有新版 ${status.availableVersion ?? ''}`.trim(),
      title: `${status.message} 點此前往設定頁查看。`
    }
  }
  if (status?.phase === 'downloading') {
    return {
      label: `下载更新 ${Math.round(status.downloadPercent ?? 0)}%`,
      title: status.message
    }
  }
  if (status?.phase === 'downloaded') {
    return {
      label: '更新待安裝',
      title: `${status.message} 點此前往設定頁安裝。`
    }
  }
  return null
}

interface Props {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
  updateStatus: AppUpdateStatus | null
  dataError: string | null
  dataRecoveryRequired: boolean
  dataRecoveryBusy: boolean
  onRetryLoad: () => void
  onRetrySave: () => void
  onAnalysisCommandMountChange: (element: HTMLDivElement | null) => void
  onDownloadUpdate: () => void
  children: ReactNode
}

export function AppShell({
  activeTab,
  onTabChange,
  updateStatus,
  dataError,
  dataRecoveryRequired,
  dataRecoveryBusy,
  onRetryLoad,
  onRetrySave,
  onAnalysisCommandMountChange,
  onDownloadUpdate,
  children
}: Props): JSX.Element {
  const handledVersion = useRef<string | null>(null)
  const [skippedVersion, setSkippedVersion] = useState(loadSkippedVersion)
  const [reminder, setReminder] = useState(loadUpdateReminder)
  const [dialogVersion, setDialogVersion] = useState<string | null>(null)
  const availablePromptSuppressed = updateStatus?.phase === 'available' &&
    !!updateStatus.availableVersion &&
    !shouldShowUpdateDialog(
      updateStatus.availableVersion,
      skippedVersion,
      reminder,
      Date.now()
    )
  const prompt = availablePromptSuppressed ? null : updatePrompt(updateStatus)

  useEffect(() => {
    if (updateStatus?.phase === 'error') handledVersion.current = null
    const version = updateStatus?.phase === 'available'
      ? updateStatus.availableVersion
      : undefined
    if (!version || handledVersion.current === version) {
      setDialogVersion(null)
      return
    }
    if (!shouldShowUpdateDialog(version, skippedVersion, reminder, Date.now())) {
      setDialogVersion(null)
      if (reminder?.version === version && reminder.remindAfter > Date.now()) {
        const timer = globalThis.setTimeout(
          () => setReminder(null),
          reminder.remindAfter - Date.now()
        )
        return () => globalThis.clearTimeout(timer)
      }
      return
    }
    setDialogVersion(version)
  }, [reminder, skippedVersion, updateStatus])

  const updateNow = (): void => {
    if (!dialogVersion) return
    handledVersion.current = dialogVersion
    setDialogVersion(null)
    setReminder(null)
    saveUpdateReminder(null)
    onDownloadUpdate()
  }

  const remindLater = (): void => {
    if (!dialogVersion) return
    const nextReminder = {
      version: dialogVersion,
      remindAfter: Date.now() + UPDATE_REMINDER_DELAY_MS
    }
    setDialogVersion(null)
    setReminder(nextReminder)
    saveUpdateReminder(nextReminder)
  }

  const skipVersion = (): void => {
    if (!dialogVersion) return
    setSkippedVersion(dialogVersion)
    saveSkippedVersion(dialogVersion)
    setDialogVersion(null)
  }

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="app-brand"
          aria-label="回到分析工作區"
          onClick={() => onTabChange('analyze')}
        >
          <span className="brand-seal" aria-hidden="true">象</span>
          <b className="app-title">Reckoning</b>
        </button>

        <nav className="app-nav" aria-label="主要功能">
          <button
            type="button"
            className={'nav-btn' + (activeTab === 'analyze' ? ' active' : '')}
            aria-label="分析"
            aria-current={activeTab === 'analyze' ? 'page' : undefined}
            title="分析首頁"
            onClick={() => onTabChange('analyze')}
          >
            <Icon name="board" size={16} />
            <span>分析</span>
          </button>

          <button
            type="button"
            className={'nav-btn' + (activeTab === 'settings' ? ' active' : '')}
            aria-label="設定"
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            title="AI、本機引擎、解說品質與系统設定"
            onClick={() => onTabChange('settings')}
          >
            <Icon name="settings" size={16} />
            <span>設定</span>
          </button>
        </nav>

        {prompt && activeTab !== 'settings' && (
          <button
            type="button"
            className="app-update-chip"
            title={prompt.title}
            onClick={() => onTabChange('settings')}
          >
            <span className="app-update-dot" aria-hidden="true" />
            {prompt.label}
          </button>
        )}

        {activeTab === 'analyze' && (
          <div
            className="analysis-command-mount"
            ref={onAnalysisCommandMountChange}
            aria-label="分析命令"
          />
        )}
      </header>

      {dataError && (
        <div className="global-storage-error" role="alert">
          <span>{dataError}</span>
          <button
            className="btn ghost small"
            disabled={dataRecoveryBusy}
            onClick={dataRecoveryRequired ? onRetryLoad : onRetrySave}
          >
            {dataRecoveryRequired
              ? dataRecoveryBusy
                ? '重新讀取中…'
                : '重新讀取資料'
              : '重試儲存'}
          </button>
        </div>
      )}

      {dialogVersion && (
        <div className="app-update-backdrop" role="presentation">
          <section
            className="app-update-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-update-title"
          >
            <span className="eyebrow">APPLICATION UPDATE</span>
            <h2 id="app-update-title">發現新版 {dialogVersion}</h2>
            <p>
              選擇立即更新後會在背景下載；完成時 Reckoning 將自動關閉、安裝並重新開啟。
            </p>
            <div className="app-update-actions">
              <button className="btn" type="button" data-update-action="now" onClick={updateNow}>
                立即更新
              </button>
              <button className="btn ghost" type="button" data-update-action="later" onClick={remindLater}>
                稍後提醒我
              </button>
              <button className="btn ghost" type="button" data-update-action="skip" onClick={skipVersion}>
                跳過此版本
              </button>
            </div>
            <p className="muted small">稍後提醒會在 4 小時後再次詢問；手動更新入口仍保留在設定頁。</p>
          </section>
        </div>
      )}

      <main className={`app-main app-main-${activeTab}`}>{children}</main>
    </div>
  )
}
