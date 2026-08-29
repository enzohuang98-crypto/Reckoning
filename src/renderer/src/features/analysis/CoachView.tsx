import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { AIConversation } from '@shared/types/AppData'
import type {
  EngineAnalysisResultPayload,
  GenerateExplanationDonePayload
} from '@shared/types/ipc'
import type {
  HarnessProgressPayload,
  HarnessTrace,
  TeacherTestRunStatusV1
} from '@shared/types/Harness'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import type { ActualMoveSelection } from './types'
import { ExplanationView } from '../explanations/ExplanationView'
import { HarnessProgressCard } from './HarnessProgressCard'

interface Props {
  result: EngineAnalysisResultPayload | null
  explanation: AIExplanationResponse | null
  conversation: AIConversation | null
  submittedGuess: SubmittedGuess | null
  actualMove: ActualMoveSelection | null
  aiBusy: boolean
  streamingText: string
  harnessProgress: HarnessProgressPayload | null
  traceId: string | null
  aiBlockedReason: string | null
  error: string | null
  notice: string | null
  teacherTestStatus: TeacherTestRunStatusV1 | null
  teacherExecution: GenerateExplanationDonePayload['teacherExecution'] | null
  followUp: string
  onFollowUpChange: (value: string) => void
  onGenerate: () => void
  onContinue: () => void
  onCancel: () => void
  onSubmitFollowUp: () => void
  onCopy: () => void
  onCopyTeacherId: (value: string) => void
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
  harnessProgress,
  traceId,
  aiBlockedReason,
  error,
  notice,
  teacherTestStatus,
  teacherExecution,
  followUp,
  onFollowUpChange,
  onGenerate,
  onContinue,
  onCancel,
  onSubmitFollowUp,
  onCopy,
  onCopyTeacherId,
  onFeedback
}: Props): JSX.Element {
  const engineAnalysis = result?.engineAnalysis
  const latestMessage = conversation?.messages.at(-1)
  const historyMessages = conversation?.messages.slice(0, -1) ?? []

  return (
    <div className="analysis-view-content coach-view">
      {error && <div className="error-text" role="alert">{error}</div>}
      {notice && <div className="notice-text" role="status">{notice}</div>}
      {teacherTestStatus?.active && (
        <div className="notice-text small" role="status">
          目前是工程凍結題測試，狀態仍為 fixture-only、teacher-confirmation-pending。
          正式案例不會把上方 prelude 或先前對話送入模型；非 frozen-case 問題會被阻止。
        </div>
      )}
      {teacherExecution?.interactionKind === 'teacher-prelude' && (
        <div className="notice-text small" role="status">
          這次是老師測試 prelude，不計入正式案例。
        </div>
      )}
      {teacherExecution?.interactionKind === 'teacher-formal-case' && (
        <div className="notice-text small teacher-execution-identity" role="status">
          <b>老師凍結案例已記錄</b>
          <span>Case：{teacherExecution.caseKey}</span>
          <span>
            testCaseId：{teacherExecution.testCaseId}
            {teacherExecution.testCaseId && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => onCopyTeacherId(teacherExecution.testCaseId!)}
              >
                複製
              </button>
            )}
          </span>
          <span>
            externalReviewId：{teacherExecution.externalReviewId}
            {teacherExecution.externalReviewId && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => onCopyTeacherId(teacherExecution.externalReviewId!)}
              >
                複製
              </button>
            )}
          </span>
        </div>
      )}

      {aiBusy && harnessProgress && (
        <HarnessProgressCard
          progress={harnessProgress}
          onContinue={onContinue}
          onCancel={onCancel}
        />
      )}

      {actualMove &&
        result?.verificationWarning &&
        !explanation &&
        !conversation && (
          <div className="notice-text small" role="status">
            {result.verificationWarning}
          </div>
        )}

      {!result && (
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

      {result && !aiBusy && !streamingText && !conversation && !explanation && (
        <div className="coach-ready-card">
          <div>
            <b>{actualMove ? '引擎比較完成' : '引擎證據已準備完成'}</b>
            {actualMove && (
              <span>
                實戰 {engineAnalysis?.displayUserMove ?? actualMove.displayMove} → AI 首選{' '}
                {engineAnalysis?.displayBestMove ?? '尚無可辨識著法'}
              </span>
            )}
            <span>AI 會直接說明錯因、對手利用、後果與可帶走的原則。</span>
          </div>
          <button className="btn" onClick={onGenerate}>產生完整 AI 解說</button>
        </div>
      )}

      {(aiBusy || (!explanation && streamingText)) && streamingText && (
        <section className="ai-explanation streaming">
          <div className="section-heading">
            <h4>AI 解說生成中</h4>
            <span className="muted small">正在整理重點</span>
          </div>
          <ExplanationView text={streamingText} />
        </section>
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
