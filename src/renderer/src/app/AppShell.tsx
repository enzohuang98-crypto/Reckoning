import type { ReactNode } from 'react'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import { Icon, type IconName } from '../components/ui/Icon'

export type AppTab = 'analyze' | 'settings' | 'mistakes' | 'misunderstood'

interface NavigationItem {
  id: AppTab
  label: string
  icon: IconName
}

const navigation: NavigationItem[] = [
  { id: 'analyze', label: '分析', icon: 'board' },
  { id: 'mistakes', label: '錯題本', icon: 'archive' },
  { id: 'misunderstood', label: '待理解', icon: 'brain' },
  { id: 'settings', label: '設定', icon: 'settings' }
]

/**
 * 只有「有新版可下載」與「已下載待安裝」需要主動提示；其餘狀態
 * （檢查中、已是最新、錯誤）留在設定頁即可，不打擾使用者。
 */
function updatePrompt(
  status: AppUpdateStatus | null
): { label: string; title: string } | null {
  if (status?.phase === 'available') {
    return {
      label: `有新版 ${status.availableVersion ?? ''}`.trim(),
      title: `${status.message} 點此前往設定頁下載。`
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
          <b className="app-title">象棋 AI 分析講解</b>
        </button>

        <nav className="app-nav" aria-label="主要功能">
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={'nav-btn' + (activeTab === item.id ? ' active' : '')}
              aria-label={item.label}
              aria-current={activeTab === item.id ? 'page' : undefined}
              title={item.label}
              onClick={() => onTabChange(item.id)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
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
