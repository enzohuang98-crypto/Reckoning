import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'
import { createPortal } from 'react-dom'
import type { BoardState } from '@shared/types/BoardState'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineAnalysisResultPayload } from '@shared/types/ipc'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import type { EngineCandidateMove } from '@shared/types/EngineAnalysis'
import type { AIConversation } from '@shared/types/AppData'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import { CoachView } from './CoachView'
import { DetailsView } from './DetailsView'
import { LiveAnalysisTable } from './LiveAnalysisTable'
import { hasBothKings } from './liveAnalysis'
import type {
  ActualMoveSelection,
  AnalysisPanelHandle,
  AnalysisPanelStatus,
  AnalysisView
} from './types'
import { useAiExplanation } from './useAiExplanation'
import { useAnalysisOrchestration } from './useAnalysisOrchestration'
import { useEngineAnalysis, type EngineAiLink } from './useEngineAnalysis'

export type { AnalysisPanelHandle, AnalysisPanelStatus } from './types'

interface Props {
  visible: boolean
  activeView: Exclude<AnalysisView, 'guess'>
  liveDockElement: HTMLElement | null
  detailsDockElement: HTMLElement | null
  board: BoardState
  settings: AppSettings
  submittedGuess: SubmittedGuess | null
  actualMove: ActualMoveSelection | null
  conversation: AIConversation | null
  onConversationChange: (conversation: AIConversation | null) => void
  onResult: (payload: EngineAnalysisResultPayload | null) => void
  onReplayCandidates: (candidates: EngineCandidateMove[]) => void
  onExplanation: (explanation: AIExplanationResponse | null) => void
  onStatusChange: (status: AnalysisPanelStatus) => void
  onOpenAiSettings?: () => void
  /** 追問框只在已有回答時出現；第一次請求一律從「問 AI 教練」表單送出。 */
  showQuestion?: boolean
}

/**
 * 唯一的分析與 AI IPC controller（見 docs/architecture/overview.md）。本元件只負責組裝：
 * - useEngineAnalysis：本機引擎分析的生命週期（狀態、啟動／取消、進度、截止計時）。
 * - useAiExplanation：AI 解說的生命週期（請求、串流、截止、取消、重試、對話）。
 * - useAnalysisOrchestration：兩者之間的規則（自動分析、live 精煉、等引擎再回答、提交觸發解說）。
 * 同一份狀態透過 portal 餵給教練畫面、Live dock 與資料抽屜。
 *
 * 三個 hook 的呼叫順序就是 effect 的執行順序（引擎重設 → AI 重設 → 自動分析與排隊提問），不可調換。
 */
export const AnalysisPanel = forwardRef<AnalysisPanelHandle, Props>(function AnalysisPanel(
  {
    visible,
    activeView,
    liveDockElement,
    detailsDockElement,
    board,
    settings,
    submittedGuess,
    actualMove,
    conversation,
    onConversationChange,
    onResult,
    onReplayCandidates,
    onExplanation,
    onStatusChange,
    onOpenAiSettings,
    showQuestion = true
  }: Props,
  ref
): JSX.Element {
  const explanationAnchorRef = useRef<HTMLDivElement>(null)
  const analysisMove = actualMove?.move ?? submittedGuess?.move ?? ''
  const aiLink = useRef<EngineAiLink | null>(null)

  const engine = useEngineAnalysis({
    visible,
    board,
    settings,
    analysisMove,
    actualMove,
    onResult,
    onReplayCandidates,
    onExplanation,
    aiLink
  })
  const ai = useAiExplanation({
    board,
    settings,
    analysisMove,
    actualMove,
    submittedGuess,
    conversation,
    onConversationChange,
    onExplanation,
    onOpenAiSettings,
    engine
  })
  // 引擎 hook 先建立（AI 需要它的結果），所以它反過來通知 AI 時經由這個 ref；
  // 引擎只在 effect、計時器與 IPC 事件中呼叫，都晚於這裡的指定。
  aiLink.current = ai.engineLink
  const { stopAll } = useAnalysisOrchestration({
    visible,
    board,
    analysisMove,
    actualMove,
    submittedGuess,
    engine,
    ai
  })

  const {
    status,
    busy,
    refining,
    progress,
    engineThoughts,
    retainingPreviousAnalysis,
    cancelling,
    error,
    engineDiagnostics,
    notice,
    result,
    engineRegistry,
    primaryEngineId,
    liveElapsedMs,
    sinceLastThoughtMs,
    startAnalysis,
    cancelAnalysis,
    selectPrimaryEngine
  } = engine
  const {
    aiError,
    aiDiagnostic,
    aiErrorInfo,
    aiNotice,
    explanation,
    explainedResult,
    aiBusy,
    aiCancelling,
    streamingText,
    streamingAttempt,
    answerMeta,
    followUp,
    setFollowUp,
    harnessProgress,
    traceId,
    conversationRef,
    generateExplanation,
    submitFollowUp,
    copyExplanation,
    cancelExplain,
    handleAiErrorAction,
    copyAiDiagnostics
  } = ai

  // 不傳 deps：generateExplanation/startAnalysis 等閉包捕捉了 settings/引擎選擇等會變動的值，
  // 每次 render 都重建這個 handle 才能避免呼叫到過期的閉包。
  useImperativeHandle(ref, () => ({
    requestExplanation: () => {
      if ((!result && !busy) || aiBusy) return
      generateExplanation(
        null,
        explanation !== null || conversationRef.current !== null
      )
      explanationAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    askQuestion: (question: string) => {
      if ((!result && !busy) || aiBusy || !question.trim()) return
      generateExplanation(question.trim())
      explanationAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    startAnalysis: () => startAnalysis(false),
    cancelAnalysis,
    cancelExplain,
    stopAll
  }))

  const coachResult = explainedResult ?? result

  const canAnalyze = Boolean(status?.available && hasBothKings(board) && !busy && !aiBusy)
  const analysisBlockedReason = !hasBothKings(board)
    ? '棋盤需要同時有紅帥與黑將才能分析。'
    : !status?.available
      ? '請先到設定頁完成本機引擎設定。'
      : aiBusy
        ? 'AI 正在解說，完成或取消後才能重新分析。'
        : busy
          ? '引擎正在分析中。'
          : null
  const aiBlockedReason = !result
    ? '請先等引擎分析完成，再請 AI 解說。'
    : busy && !refining
      ? '引擎分析中，完成後才能解說。'
      : aiBusy
        ? 'AI 正在生成解說。'
        : null

  // 把外部（頂部工具列）需要的按鈕狀態往上回報，本身不影響任何分析/Harness 邏輯。
  useEffect(() => {
    onStatusChange({
      canAnalyze,
      analysisBusy: busy,
      analysisCancelling: cancelling,
      aiBusy,
      aiCancelling,
      aiError,
      hasExplanation: explanation !== null || conversation !== null,
      hasResult: result !== null,
      analysisBlockedReason,
      aiBlockedReason
    })
  }, [
    canAnalyze,
    busy,
    cancelling,
    aiBusy,
    aiCancelling,
    aiError,
    explanation,
    conversation,
    result,
    analysisBlockedReason,
    aiBlockedReason,
    onStatusChange
  ])

  const liveDock = (
    <div className="analysis-panel live-analysis-panel">
      <LiveAnalysisTable
        status={status}
        progress={progress}
        busy={busy}
        thoughts={engineThoughts}
        result={result}
        error={error}
        notice={notice}
        liveElapsedMs={liveElapsedMs}
        sinceLastThoughtMs={sinceLastThoughtMs}
        retainingPreviousAnalysis={retainingPreviousAnalysis}
      />
    </div>
  )

  const detailsDock = (
    <div className="analysis-panel analysis-details-panel">
      <DetailsView
        result={result}
        registry={engineRegistry}
        primaryEngineId={primaryEngineId}
        busy={busy}
        aiBusy={aiBusy}
        diagnostics={engineDiagnostics}
        onSelectPrimary={(id) => void selectPrimaryEngine(id)}
      />
    </div>
  )

  return (
    <>
      <div className={`analysis-panel analysis-view-${activeView}`}>
        {activeView === 'coach' && (
          <div
            ref={explanationAnchorRef}
            role="tabpanel"
            id="analysis-panel-coach"
            aria-labelledby="analysis-tab-coach"
          >
            <CoachView
              result={coachResult}
              explanation={explanation}
              conversation={conversation}
              submittedGuess={submittedGuess}
              actualMove={actualMove}
              aiBusy={aiBusy}
              streamingText={streamingText}
              streamingAttempt={streamingAttempt}
              answerMeta={answerMeta}
              onRetryAi={ai.retryAi}
              harnessProgress={harnessProgress}
              traceId={traceId}
              aiBlockedReason={
                actualMove
                  ? !status?.available
                    ? analysisBlockedReason
                    : null
                  : aiBlockedReason
              }
              error={aiError ?? (actualMove ? error : null)}
              aiErrorInfo={aiErrorInfo}
              onErrorAction={handleAiErrorAction}
              onCopyDiagnostics={copyAiDiagnostics}
              canChangeModel={
                aiDiagnostic?.category === 'provider_unavailable' &&
                aiDiagnostic.httpStatus === 502
              }
              onChangeModel={onOpenAiSettings}
              notice={aiNotice}
              showQuestion={showQuestion}
              followUp={followUp}
              onFollowUpChange={setFollowUp}
              onCancel={cancelExplain}
              onSubmitFollowUp={submitFollowUp}
              onCopy={() => void copyExplanation()}
              onFeedback={ai.sendFeedback}
            />
          </div>
        )}
      </div>
      {liveDockElement ? createPortal(liveDock, liveDockElement) : null}
      {detailsDockElement ? createPortal(detailsDock, detailsDockElement) : null}
    </>
  )
})
