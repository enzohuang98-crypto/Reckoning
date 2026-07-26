import type { ReactNode } from 'react'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import { Icon, type IconName } from '../components/ui/Icon'
import { ToolbarMenu } from '../components/ui/ToolbarMenu'

export type AppTab = 'analyze' | 'settings' | 'mistakes' | 'misunderstood'

interface ToolNavItem {
  id: AppTab
  label: string
  description: string
  icon: IconName
}

/**
 * 分析是固定首頁，永遠是獨立分頁；其餘目的地收進同一個「工具」選單，
 * 避免四個等重分頁攤平在同一列（窄視窗更會直接消失，見 responsive.css）。
 */
const toolNavItems: ToolNavItem[] = [
  { id: 'mistakes', label: '錯題本', description: '搜尋、篩選並追蹤走錯的局面', icon: 'archive' },
  { id: 'misunderstood', label: '待理解', description: '收藏尚未想通的關鍵局面', icon: 'brain' },
  { id: 'settings', label: '設定', description: 'AI、本機引擎、解說品質與系統', icon: 'settings' }
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

          <ToolbarMenu
            icon="grid"
            label="工具"
            active={activeTab !== 'analyze'}
            items={toolNavItems.map((item) => ({
              id: item.id,
              icon: item.icon,
              label: item.label,
              description: item.description,
              active: activeTab === item.id,
              onSelect: () => onTabChange(item.id)
            }))}
          />
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
