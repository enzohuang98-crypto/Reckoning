import type {
  AiErrorAction,
  AiErrorPresentation
} from '@shared/logic/ai/aiErrorPresentation'

const ACTION_LABELS: Record<AiErrorAction, string> = {
  open_settings: '前往設定',
  retry: '重試',
  change_model: '更換模型',
  reanalyze: '重新分析'
}

interface Props {
  presentation: AiErrorPresentation
  onAction: (action: AiErrorAction) => void
  onCopyDiagnostics: () => void
}

/** 一句人話＋明確下一步；診斷資訊只含分類欄位。 */
export function AiErrorCard({
  presentation,
  onAction,
  onCopyDiagnostics
}: Props): JSX.Element {
  return (
    <div className="error-text ai-error-card" role="alert">
      <b className="ai-error-title">{presentation.title}</b>
      <span className="ai-error-detail">{presentation.detail}</span>
      <div className="ai-error-actions">
        {presentation.actions.map((action) => (
          <button
            key={action}
            type="button"
            className="btn ghost small"
            onClick={() => onAction(action)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
        <button type="button" className="btn ghost small" onClick={onCopyDiagnostics}>
          複製診斷資訊
        </button>
      </div>
    </div>
  )
}
