import type { ReactNode } from 'react'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import { Icon } from '../components/ui/Icon'

export type AppTab = 'analyze' | 'settings'

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
  children
}: Props): JSX.Element {
  const prompt = updatePrompt(updateStatus)
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

      <main className={`app-main app-main-${activeTab}`}>{children}</main>
    </div>
  )
}
