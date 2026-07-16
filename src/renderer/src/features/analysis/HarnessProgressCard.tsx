import type { HarnessPhase, HarnessProgressPayload } from '@shared/types/Harness'

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
  onContinue: () => void
  onCancel: () => void
}

export function HarnessProgressCard({
  progress,
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
          <span className="eyebrow">AI 解說生成中</span>
          <b>正在整理實戰步、AI 首選與對手最強利用</b>
          <span className="muted small">
            {phaseText(progress.phase)}
            {progress.elapsedMs !== undefined
              ? ` · ${Math.floor(progress.elapsedMs / 1000)} 秒`
              : ''}
          </span>
        </div>
        <span className={`badge ${progress.awaitingDecision ? 'warn' : 'on'}`}>
          {progress.awaitingDecision ? '等待你決定' : '處理中'}
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
          <span>一鍵解說不會停在這一步；手動研究可選擇繼續或取消。</span>
          <div className="row gap">
            <button className="btn" onClick={onContinue}>繼續分析</button>
            <button className="btn ghost" onClick={onCancel}>取消</button>
          </div>
        </div>
      )}
    </section>
  )
}
