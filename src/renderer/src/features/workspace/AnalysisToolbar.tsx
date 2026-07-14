import type { AnalysisPanelStatus, AnalysisView } from '../analysis/types'
import { Icon, type IconName } from '../../components/ui/Icon'
import { ToolbarMenu } from '../../components/ui/ToolbarMenu'

interface Props {
  importOpen: boolean
  onToggleImport: () => void
  boardToolsOpen: boolean
  onToggleBoardTools: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onRestoreOriginal: () => void
  boardCompact: boolean
  onToggleBoardSize: () => void
  detailsOpen: boolean
  onToggleDetails: () => void
  activeView: AnalysisView
  onViewChange: (view: AnalysisView) => void
  status: AnalysisPanelStatus
  onStartAnalysis: () => void
  onStopAnalysis: () => void
  onRequestExplanation: () => void
}

function ToolbarButton({
  buttonId,
  icon,
  label,
  title,
  active,
  variant,
  disabled,
  ariaExpanded,
  ariaControls,
  onClick
}: {
  buttonId?: string
  icon: IconName
  label: string
  title: string
  active?: boolean
  variant?: 'primary' | 'danger'
  disabled?: boolean
  ariaExpanded?: boolean
  ariaControls?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      id={buttonId}
      type="button"
      className={`toolbar-btn${active ? ' active' : ''}${variant ? ` ${variant}` : ''}`}
      title={title}
      aria-label={title}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} className="toolbar-icon" />
      <span className="toolbar-label">{label}</span>
    </button>
  )
}

export function AnalysisToolbar({
  importOpen,
  onToggleImport,
  boardToolsOpen,
  onToggleBoardTools,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRestoreOriginal,
  boardCompact,
  onToggleBoardSize,
  detailsOpen,
  onToggleDetails,
  activeView,
  onViewChange,
  status,
  onStartAnalysis,
  onStopAnalysis,
  onRequestExplanation
}: Props): JSX.Element {
  const analysisRunning = status.analysisBusy || status.aiBusy
  const stopCancelling = status.analysisCancelling || status.aiCancelling

  return (
    <div className="app-toolbar" role="toolbar" aria-label="分析工具列">
      <div className="toolbar-group">
        <ToolbarMenu
          icon="board"
          label="局面工具"
          active={importOpen || boardToolsOpen}
          items={[
            {
              id: 'import',
              icon: 'archive',
              label: importOpen ? '收起匯入工具' : '匯入棋局',
              description: '載入 FEN 或逐手棋譜',
              active: importOpen,
              onSelect: onToggleImport
            },
            {
              id: 'board',
              icon: 'board',
              label: boardToolsOpen ? '收起擺棋工具' : '擺棋與保存局面',
              description: '替換棋子、設定輪走方與保存局面',
              active: boardToolsOpen,
              onSelect: onToggleBoardTools
            },
            {
              id: 'reset',
              icon: 'reset',
              label: '還原原始棋盤',
              description: '回到標準象棋開局',
              onSelect: onRestoreOriginal
            }
          ]}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="undo"
          label="悔棋"
          title="回到上一個棋盤狀態"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <ToolbarButton
          icon="redo"
          label="下一步"
          title="回到下一個棋盤狀態"
          disabled={!canRedo}
          onClick={onRedo}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group toolbar-primary-actions">
        <ToolbarButton
          icon="play"
          label={status.analysisBusy ? '分析中' : status.hasResult ? '重新分析' : '開始分析'}
          title={status.analysisBlockedReason ?? '使用完整設定重新分析目前局面'}
          variant="primary"
          disabled={!status.canAnalyze}
          onClick={onStartAnalysis}
        />
        <ToolbarButton
          icon="stop"
          label={stopCancelling ? '停止中' : '停止'}
          title={analysisRunning ? '停止目前的引擎分析或 AI 生成' : '目前沒有進行中的工作'}
          variant="danger"
          disabled={!analysisRunning || stopCancelling}
          onClick={onStopAnalysis}
        />
        <ToolbarButton
          icon="sparkles"
          label={status.aiBusy ? '解說中' : status.hasExplanation ? '重新解說' : 'AI 解說'}
          title={status.aiBlockedReason ?? '請 AI 依照設定語言解說目前局面'}
          active={activeView === 'coach'}
          disabled={Boolean(status.aiBlockedReason)}
          onClick={() => {
            onViewChange('coach')
            onRequestExplanation()
          }}
        />
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="board"
          label={boardCompact ? '放大棋盤' : '縮小棋盤'}
          title={boardCompact ? '放大棋盤工作區' : '縮小棋盤，騰出更多教練空間'}
          active={boardCompact}
          onClick={onToggleBoardSize}
        />
        <ToolbarButton
          buttonId="analysis-details-toggle"
          icon="details"
          label="分析資料"
          title="在工具列下方展開當前局面的分析資料"
          active={detailsOpen}
          ariaExpanded={detailsOpen}
          ariaControls="analysis-data-drawer"
          onClick={onToggleDetails}
        />
        <ToolbarButton
          icon="target"
          label="猜著模式"
          title="先選擇你的著法，再與引擎比較"
          active={activeView === 'guess'}
          onClick={() => onViewChange('guess')}
        />
      </div>
    </div>
  )
}
