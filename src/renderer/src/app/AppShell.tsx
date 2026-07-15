import type { ReactNode } from 'react'
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

interface Props {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
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
  dataError,
  dataRecoveryRequired,
  dataRecoveryBusy,
  onRetryLoad,
  onRetrySave,
  onAnalysisCommandMountChange,
  children
}: Props): JSX.Element {
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
          <b className="app-title">象理</b>
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
