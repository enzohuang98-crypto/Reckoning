import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { AIConversation } from '@shared/types/AppData'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type {
  HarnessEvidence,
  HarnessProgressPayload,
  HarnessTrace
} from '@shared/types/Harness'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import { ExplanationView } from '../explanations/ExplanationView'
import { HarnessProgressCard } from './HarnessProgressCard'

interface TokenEstimate {
  input: number
  output: number
  modelCalls: number
}

interface Props {
  settings: AppSettings
  result: EngineAnalysisResultPayload | null
  explanation: AIExplanationResponse | null
  conversation: AIConversation | null
  submittedGuess: SubmittedGuess | null
  aiBusy: boolean
  streamingText: string
  harnessProgress: HarnessProgressPayload | null
  harnessEvidence: HarnessEvidence[]
  harnessWarnings: string[]
  traceId: string | null
  tokenEstimate: TokenEstimate | null
  aiBlockedReason: string | null
  error: string | null
  notice: string | null
  followUp: string
  onFollowUpChange: (value: string) => void
  onGenerate: () => void
  onContinue: () => void
  onCancel: () => void
  onSubmitFollowUp: () => void
  onCopy: () => void
  onFeedback: (feedback: NonNullable<HarnessTrace['feedback']>) => void
}

export function CoachView({
  settings,
  result,
  explanation,
  conversation,
  submittedGuess,
  aiBusy,
  streamingText,
  harnessProgress,
  harnessEvidence,
  harnessWarnings,
  traceId,
  tokenEstimate,
  aiBlockedReason,
  error,
  notice,
  followUp,
  onFollowUpChange,
  onGenerate,
  onContinue,
  onCancel,
  onSubmitFollowUp,
  onCopy,
  onFeedback
}: Props): JSX.Element {
  const engineAnalysis = result?.engineAnalysis
  const latestMessage = conversation?.messages.at(-1)
  const historyMessages = conversation?.messages.slice(0, -1) ?? []
  const modelBadge = conversation
    ? latestMessage?.model ?? '歷史回答'
    : explanation?.model ?? `目前選用：${settings.aiModel}`

  return (
    <div className="analysis-view-content coach-view">
      <div className="view-heading">
        <div>
          <span className="eyebrow">GROUNDED AI COACH</span>
          <h3>有證據的 AI 教練解說</h3>
        </div>
        <span className="badge plain">{modelBadge}</span>
      </div>

      {error && <div className="error-text" role="alert">{error}</div>}
      {notice && <div className="notice-text" role="status">{notice}</div>}

      {aiBusy && harnessProgress && (
        <HarnessProgressCard
          progress={harnessProgress}
          answerMode={settings.harnessAnswerMode}
          onContinue={onContinue}
          onCancel={onCancel}
        />
      )}

      {tokenEstimate && !conversation && !aiBusy && (
        <div className="coach-cost-note">
          AI 研究預算：目前棋局資料約 {tokenEstimate.input} tokens；整輪模型輸出總預算{' '}
          {tokenEstimate.output} tokens，最多 {tokenEstimate.modelCalls} 次模型呼叫。實際輸入會再加入驗證規則與引擎證據。
        </div>
      )}

      {!result && (
        <div className="panel-empty-state">
          <span className="empty-state-mark">AI</span>
          <h3>先完成引擎分析</h3>
          <p>{aiBlockedReason ?? '引擎結果完成後，才能建立有證據的 AI 解說。'}</p>
        </div>
      )}

      {result && !aiBusy && !streamingText && !conversation && !explanation && (
        <div className="coach-ready-card">
          <div>
            <b>引擎證據已準備完成</b>
            <span>AI 會檢查目的、錯失機會、對手利用與具體盤面後果。</span>
          </div>
          <button className="btn" onClick={onGenerate}>產生完整解說</button>
        </div>
      )}

      {(aiBusy || (!explanation && streamingText)) && streamingText && (
        <section className="ai-explanation streaming">
          <div className="section-heading">
            <h4>AI 解說生成中</h4>
            <span className="badge on">證據驗證完成</span>
          </div>
          <ExplanationView text={streamingText} />
        </section>
      )}

      {conversation && latestMessage && (
        <section className="ai-explanation">
          <div className="section-heading">
            <h4>AI 解說</h4>
            {explanation?.usage && (
              <span className="usage">
                輸入 {explanation.usage.inputTokens} / 輸出{' '}
                {explanation.usage.outputTokens} tokens
              </span>
            )}
          </div>

          {latestMessage.role === 'assistant' ? (
            <ExplanationView text={latestMessage.text} />
          ) : (
            <p className="explanation-text">{latestMessage.text}</p>
          )}

          {historyMessages.length > 0 && (
            <details className="conversation-history">
              <summary>先前追問紀錄（{historyMessages.length} 則）</summary>
              {historyMessages.map((message) => (
                <div className="conversation-history-message" key={message.id}>
                  <b>{message.role === 'user' ? '問' : '答'}</b>
                  <span>{message.text}</span>
                </div>
              ))}
            </details>
          )}

          <div className="follow-up-row">
            <input
              className="text-input"
              value={followUp}
              placeholder="針對這個局面繼續追問…"
              disabled={aiBusy}
              onChange={(event) => onFollowUpChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  onSubmitFollowUp()
                }
              }}
            />
            <button
              className="btn small"
              onClick={onSubmitFollowUp}
              disabled={aiBusy || !result || !followUp.trim()}
            >
              追問
            </button>
            <button className="btn ghost small" onClick={onCopy}>複製</button>
          </div>

          {submittedGuess?.move && (
            <div className="muted small">
              追問會附加棋盤上選取的著法：
              {engineAnalysis?.displayUserMove ?? '目前選取著法'}
            </div>
          )}
        </section>
      )}

      {!conversation && explanation && !streamingText && (
        <section className="ai-explanation">
          <ExplanationView text={explanation.text} />
        </section>
      )}

      {harnessWarnings.length > 0 && (
        <div className="engine-status warn">{harnessWarnings.join('；')}</div>
      )}

      {harnessEvidence.length > 0 && (
        <details className="harness-evidence">
          <summary>檢視 AI 解說證據（{harnessEvidence.length} 筆）</summary>
          {harnessEvidence.map((item) => (
            <div className="evidence-card" key={item.id}>
              <b>[{item.id}] {item.engineName} · {item.purpose}</b>
              <div className="muted small">
                深度 {item.depth ?? '—'} · 原始分數 {item.score?.raw ?? '無'}
              </div>
              <div>
                主線：{item.displayPrincipalVariation.slice(0, 8).join('、') || '無'}
              </div>
            </div>
          ))}
        </details>
      )}

      {traceId && (
        <div className="harness-feedback">
          <span className="muted small">這次解說是否有幫助？</span>
          <div className="feedback-segment" role="group" aria-label="解說回饋">
            {(
              [
                ['helpful', '有幫助'],
                ['unclear', '不清楚'],
                ['incorrect', '內容不正確'],
                ['missing_evidence', '證據不足']
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                className="feedback-segment-btn"
                key={value}
                onClick={() => onFeedback(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
