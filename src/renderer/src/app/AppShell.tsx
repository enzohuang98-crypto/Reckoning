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

function removeLegacySkippedVersion(): void {
  try {
    window.localStorage.removeItem(SKIPPED_UPDATE_KEY)
  } catch {
    // 舊資料清理由下一次啟動再嘗試。
  }
}

function removeLegacyUpdateReminder(): void {
  try {
    window.localStorage.removeItem(UPDATE_REMINDER_KEY)
  } catch {
    // 舊資料清理由下一次啟動再嘗試。
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
  updateError?: string | null
  dataRecoveryRequired: boolean
  dataRecoveryBusy: boolean
  onRetryLoad: () => void
  onRetrySave: () => void
  onAnalysisCommandMountChange: (element: HTMLDivElement | null) => void
  onDownloadUpdate: () => void
  onSkipUpdate?: () => Promise<void>
  onSnoozeUpdate?: () => Promise<void>
  children: ReactNode
}

export function AppShell({
  activeTab,
  onTabChange,
  updateStatus,
  dataError,
  updateError = null,
  dataRecoveryRequired,
  dataRecoveryBusy,
  onRetryLoad,
  onRetrySave,
  onAnalysisCommandMountChange,
  onDownloadUpdate,
  onSkipUpdate = async () => undefined,
  onSnoozeUpdate = async () => undefined,
  children
}: Props): JSX.Element {
  const handledVersion = useRef<string | null>(null)
  const migratedLegacyPreference = useRef<string | null>(null)
  const legacySkippedVersion = useRef(loadSkippedVersion())
  const legacyReminder = useRef(loadUpdateReminder())
  const [dialogVersion, setDialogVersion] = useState<string | null>(null)
  const [, setPreferenceClock] = useState(0)
  const version = updateStatus?.availableVersion
  const preferences = updateStatus?.preferences
  const availablePromptSuppressed = !!version && (
    preferences?.skippedVersion === version ||
    (
      preferences?.snoozedVersion === version &&
      preferences.snoozeUntil !== null &&
      preferences.snoozeUntil > Date.now()
    )
  )
  const prompt = availablePromptSuppressed ? null : updatePrompt(updateStatus)

  useEffect(() => {
    const version = updateStatus?.availableVersion
    if (!version || migratedLegacyPreference.current === version) return
    if (
      legacySkippedVersion.current === version &&
      updateStatus.preferences.skippedVersion !== version
    ) {
      migratedLegacyPreference.current = version
      void onSkipUpdate()
        .then(() => {
          legacySkippedVersion.current = null
          removeLegacySkippedVersion()
        })
        .catch(() => {
          migratedLegacyPreference.current = null
        })
      return
    }
    const reminder = legacyReminder.current
    if (
      reminder?.version === version &&
      reminder.remindAfter > Date.now() &&
      updateStatus.preferences.snoozedVersion !== version
    ) {
      migratedLegacyPreference.current = version
      void onSnoozeUpdate()
        .then(() => {
          legacyReminder.current = null
          removeLegacyUpdateReminder()
        })
        .catch(() => {
          migratedLegacyPreference.current = null
        })
    }
  }, [onSkipUpdate, onSnoozeUpdate, updateStatus])

  useEffect(() => {
    const until = updateStatus?.preferences.snoozeUntil
    if (
      updateStatus?.availableVersion !== updateStatus?.preferences.snoozedVersion ||
      until == null ||
      until <= Date.now()
    ) return
    const timer = globalThis.setTimeout(
      () => setPreferenceClock((current) => current + 1),
      until - Date.now()
    )
    return () => globalThis.clearTimeout(timer)
  }, [updateStatus])

  useEffect(() => {
    if (updateStatus?.phase === 'error') handledVersion.current = null
    const version = updateStatus?.phase === 'available'
      ? updateStatus.availableVersion
      : undefined
    if (!version || handledVersion.current === version || availablePromptSuppressed) {
      setDialogVersion(null)
      return
    }
    setDialogVersion(version)
  }, [availablePromptSuppressed, updateStatus])

  const updateNow = (): void => {
    if (!dialogVersion) return
    handledVersion.current = dialogVersion
    setDialogVersion(null)
    onDownloadUpdate()
  }

  const remindLater = (): void => {
    if (!dialogVersion) return
    setDialogVersion(null)
    void onSnoozeUpdate().catch(() => undefined)
  }

  const skipVersion = (): void => {
    if (!dialogVersion) return
    setDialogVersion(null)
    void onSkipUpdate().catch(() => undefined)
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
            title="AI、本機引擎與系统設定"
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

      {updateError && (
        <div className="global-storage-error" role="alert">
          <span>{updateError}</span>
          <button className="btn ghost small" onClick={() => onTabChange('settings')}>
            前往更新設定
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
              更新會在背景準備，期間可繼續下棋；準備完成後由你明確選擇重新啟動完成更新。
            </p>
            <div className="app-update-actions">
              <button className="btn" type="button" data-update-action="now" onClick={updateNow}>
                立即背景準備
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
