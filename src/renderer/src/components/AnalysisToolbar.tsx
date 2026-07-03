import type { AnalysisPanelStatus } from './AnalysisPanel'

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
  status: AnalysisPanelStatus
  onStartAnalysis: () => void
  onStopAnalysis: () => void
  onRequestExplanation: () => void
  onOpenSettings: () => void
}

function ToolbarButton({
  icon,
  label,
  title,
  active,
  variant,
  disabled,
  onClick
}: {
  icon: string
  label: string
  title: string
  active?: boolean
  variant?: 'primary' | 'danger'
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`toolbar-btn${active ? ' active' : ''}${variant ? ` ${variant}` : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="toolbar-icon" aria-hidden="true">
        {icon}
      </span>
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
  status,
  onStartAnalysis,
  onStopAnalysis,
  onRequestExplanation,
  onOpenSettings
}: Props): JSX.Element {
  const analysisRunning = status.analysisBusy || status.aiBusy
  const stopCancelling = status.analysisCancelling || status.aiCancelling

  return (
    <div className="app-toolbar" role="toolbar" aria-label="分析工具列">
      <div className="toolbar-group">
        <ToolbarButton
          icon="📥"
          label="匯入"
          title="匯入棋局 / FEN / 棋譜"
          active={importOpen}
          onClick={onToggleImport}
        />
        <ToolbarButton
          icon="♟"
          label="擺棋"
          title="擺棋 / 編輯棋盤"
          active={boardToolsOpen}
          onClick={onToggleBoardTools}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="↶"
          label="悔棋"
          title="悔棋"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <ToolbarButton
          icon="↷"
          label="下一步"
          title="下一步"
          disabled={!canRedo}
          onClick={onRedo}
        />
        <ToolbarButton
          icon="↺"
          label="還原棋盤"
          title="還原原始棋盤"
          onClick={onRestoreOriginal}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="▶"
          label={status.analysisBusy ? '分析中…' : status.hasResult ? '重新分析' : '開始分析'}
          title={status.analysisBlockedReason ?? '開始／重新分析目前局面'}
          variant="primary"
          disabled={!status.canAnalyze}
          onClick={onStartAnalysis}
        />
        <ToolbarButton
          icon="⏹"
          label={stopCancelling ? '停止中…' : '停止分析'}
          title={analysisRunning ? '停止目前的引擎分析或 AI 生成' : '目前沒有進行中的分析'}
          variant="danger"
          disabled={!analysisRunning || stopCancelling}
          onClick={onStopAnalysis}
        />
        <ToolbarButton
          icon="💬"
          label={
            status.aiBusy ? '生成中…' : status.hasExplanation ? '重新生成' : '請 AI 解說'
          }
          title={status.aiBlockedReason ?? '請 AI 用中文解說目前局面'}
          disabled={Boolean(status.aiBlockedReason)}
          onClick={onRequestExplanation}
        />
      </div>

      <div className="toolbar-spacer" />

      <ToolbarButton icon="⚙" label="設定" title="設定" onClick={onOpenSettings} />
    </div>
  )
}
