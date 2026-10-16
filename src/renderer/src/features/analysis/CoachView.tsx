import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { AIConversation } from '@shared/types/AppData'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { HarnessProgressPayload, HarnessTrace } from '@shared/types/Harness'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import {
  presentAiError,
  type AiErrorAction,
  type AiErrorInput
} from '@shared/logic/ai/aiErrorPresentation'
import type { ActualMoveSelection, AiAnswerMeta } from './types'
import { ExplanationView } from '../explanations/ExplanationView'
import { AiErrorCard } from './AiErrorCard'
import { HarnessProgressCard } from './HarnessProgressCard'

interface Props {
  result: EngineAnalysisResultPayload | null
  explanation: AIExplanationResponse | null
  conversation: AIConversation | null
  submittedGuess: SubmittedGuess | null
  actualMove: ActualMoveSelection | null
  aiBusy: boolean
  streamingText: string
  /** v2：目前串流的是第幾次模型呼叫；大於 1 代表正在修正或改用備援。 */
  streamingAttempt?: number
  /** v2：上一個完成的回答是 AI（由哪個模型）還是引擎重點摘要。 */
  answerMeta?: AiAnswerMeta | null
  onRetryAi?: () => void
  harnessProgress: HarnessProgressPayload | null
  traceId: string | null
  aiBlockedReason: string | null
  error: string | null
  /** 與 error 同一則 AI 錯誤的結構化資訊；有值時改顯示可操作的錯誤卡。 */
  aiErrorInfo?: AiErrorInput | null
  onErrorAction?: (action: AiErrorAction) => void
  onCopyDiagnostics?: () => void
  canChangeModel?: boolean
  onChangeModel?: () => void
  notice: string | null
  followUp: string
  onFollowUpChange: (value: string) => void
  onContinue: () => void
  onCancel: () => void
  onSubmitFollowUp: () => void
  onCopy: () => void
  onFeedback: (feedback: NonNullable<HarnessTrace['feedback']>) => void
}

export function CoachView({
  result,
  explanation,
  conversation,
  submittedGuess,
  actualMove,
  aiBusy,
  streamingText,
  streamingAttempt = 1,
  answerMeta = null,
  onRetryAi,
  harnessProgress,
  traceId,
  aiBlockedReason,
  error,
  aiErrorInfo = null,
  onErrorAction,
  onCopyDiagnostics,
  canChangeModel = false,
  onChangeModel,
  notice,
  followUp,
  onFollowUpChange,
  onContinue,
  onCancel,
  onSubmitFollowUp,
  onCopy,
  onFeedback
}: Props): JSX.Element {
  const engineAnalysis = result?.engineAnalysis
  const latestMessage = conversation?.messages.at(-1)
  const historyMessages = conversation?.messages.slice(0, -1) ?? []
  const errorPresentation =
    error && aiErrorInfo && aiErrorInfo.message === error
      ? presentAiError(aiErrorInfo)
      : null

  return (
    <div className="analysis-view-content coach-view">
      {errorPresentation && (
        <AiErrorCard
          presentation={errorPresentation}
          onAction={(action) => onErrorAction?.(action)}
          onCopyDiagnostics={() => onCopyDiagnostics?.()}
        />
      )}
      {error && !errorPresentation && (
        <div className="error-text" role="alert">
          {error}
          {canChangeModel && onChangeModel && (
            <button type="button" className="btn ghost small" onClick={onChangeModel}>
              更換模型
            </button>
          )}
        </div>
      )}
      {notice && <div className="notice-text" role="status">{notice}</div>}
      {aiBusy && harnessProgress && (
        <HarnessProgressCard
          progress={harnessProgress}
          onContinue={onContinue}
          onCancel={onCancel}
        />
      )}

      {!result && (submittedGuess || actualMove) && (
        <div className="panel-empty-state">
          <span className="empty-state-mark">AI</span>
          <h3>
            {error
              ? '分析未完成'
              : actualMove && aiBlockedReason
                ? '目前無法啟動分析'
                : actualMove
                  ? `正在分析第 ${actualMove.plyIndex + 1} 手`
                  : '先完成引擎分析'}
          </h3>
          <p>
            {error ?? (actualMove && aiBlockedReason
              ? aiBlockedReason
              : actualMove
              ? `正在比較實戰著法 ${actualMove.displayMove} 與 AI 首選；完成後按一次「AI 解說」即可取得完整說明。`
              : aiBlockedReason ?? '引擎結果完成後，才能建立有證據的 AI 解說。')}
          </p>
        </div>
      )}

      {(aiBusy || (!explanation && streamingText)) && streamingText && (
        <section className="ai-explanation streaming">
          <div className="section-heading">
            <h4>AI 解說生成中</h4>
            <span className="muted small">
              {streamingAttempt > 1 ? '正在檢查並修正…' : '正在整理重點'}
            </span>
          </div>
          <ExplanationView text={streamingText} />
        </section>
      )}

      {answerMeta && !aiBusy && answerMeta.answerKind === 'engine_summary' && (
        <div className="notice-text ai-summary-banner" role="status">
          <span>AI 這次沒有通過檢查，下方是引擎重點摘要（非 AI 生成）。</span>
          {onRetryAi && (
            <button type="button" className="btn small" onClick={onRetryAi}>
              重試 AI
            </button>
          )}
        </div>
      )}
      {answerMeta && !aiBusy && answerMeta.answerKind === 'ai' && answerMeta.actualModel && (
        <div className="muted small ai-answer-model" role="note">
          由 {answerMeta.actualModel} 回答
          {answerMeta.fallbackFromModel
            ? `（${answerMeta.fallbackFromModel} 暫時無法使用：${answerMeta.fallbackReason ?? '服務故障'}）`
            : ''}
        </div>
      )}

      {conversation && latestMessage && (
        <section className="ai-explanation">
          <div className="section-heading">
            <h4>AI 解說</h4>
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
        </section>
      )}

      {!conversation && explanation && !streamingText && (
        <section className="ai-explanation">
          <ExplanationView text={explanation.text} />
        </section>
      )}

      {result && (
        <section className="ai-question" aria-label="直接提問">
          <div className="follow-up-row">
            <input
              className="text-input"
              value={followUp}
              placeholder="直接問，例如：為什麼我這步不好？照我的想法走會怎樣？"
              aria-label="AI 提問"
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
              disabled={aiBusy || !followUp.trim()}
            >
              {conversation ? '追問' : '提問'}
            </button>
            {(conversation || explanation) && (
              <button className="btn ghost small" onClick={onCopy}>複製</button>
            )}
          </div>

          {submittedGuess?.move && (
            <div className="muted small">
              提問會附加棋盤上選取的著法：
              {engineAnalysis?.displayUserMove ?? '目前選取著法'}
            </div>
          )}
        </section>
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
