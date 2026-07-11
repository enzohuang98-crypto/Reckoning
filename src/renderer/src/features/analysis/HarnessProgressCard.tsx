import type { HarnessPhase, HarnessProgressPayload } from '@shared/types/Harness'
import type { AppSettings } from '@shared/types/Settings'

function phaseText(phase: HarnessPhase): string {
  switch (phase) {
    case 'understanding': return '理解問題'
    case 'planning': return '規劃研究任務'
    case 'engine_research': return '引擎加深研究'
    case 'cross_verification': return '交叉驗證'
    case 'consequence_review': return '檢查具體後果'
    case 'waiting_for_user': return '等待你決定'
    case 'writing': return '撰寫說明'
    case 'validating': return '檢查因果鏈與證據'
    case 'quality_check': return '品質檢查'
    case 'repairing': return '重寫未達標區塊'
    case 'provider_retry': return 'AI 服務重試'
    case 'completed': return '完成'
  }
}

interface Props {
  progress: HarnessProgressPayload
  answerMode: AppSettings['harnessAnswerMode']
  onContinue: () => void
  onCancel: () => void
}

export function HarnessProgressCard({
  progress,
  answerMode,
  onContinue,
  onCancel
}: Props): JSX.Element {
  return (
    <section
      className={`harness-progress${progress.awaitingDecision ? ' awaiting' : ''}`}
      aria-live="polite"
    >
      <div className="live-analysis-head">
        <div>
          <span className="eyebrow">AI QUALITY LOOP</span>
          <b>{progress.message}</b>
          <span className="muted small">
            {phaseText(progress.phase)} · 模型 {progress.modelCallsUsed} 次 · 引擎{' '}
            {progress.engineRoundsUsed} 輪 · 證據 {progress.evidenceCount} 筆
            {progress.elapsedMs !== undefined
              ? ` · ${Math.floor(progress.elapsedMs / 1000)} 秒`
              : ''}
            {progress.depth !== undefined ? ` · 深度 ${progress.depth ?? '—'}` : ''}
            {` · 已確認 ${progress.verifiedConsequenceCount ?? 0} 項具體後果`}
          </span>
        </div>
        <span className={`badge ${progress.awaitingDecision ? 'warn' : 'on'}`}>
          {progress.awaitingDecision
            ? '等待你決定'
            : answerMode === 'research'
              ? '完整研究'
              : '聚焦回答'}
        </span>
      </div>

      {(progress.displayPrincipalVariation ?? []).length > 0 && (
        <div className="harness-current-line">
          <span>目前比較主線</span>
          <b>{progress.displayPrincipalVariation?.join('、')}</b>
        </div>
      )}

      {progress.awaitingDecision && (
        <div className="harness-decision">
          <span>120 秒內沒有回應，會自動用目前證據產生保守版分析。</span>
          <div className="row gap">
            <button className="btn" onClick={onContinue}>繼續分析</button>
            <button className="btn ghost" onClick={onCancel}>取消</button>
          </div>
        </div>
      )}
    </section>
  )
}
