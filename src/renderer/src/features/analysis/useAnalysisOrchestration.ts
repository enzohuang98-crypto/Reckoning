import { useEffect, useRef } from 'react'
import type { BoardState } from '@shared/types/BoardState'
import type { SubmittedGuess } from '@shared/types/UserGuess'
import type { ActualMoveSelection } from './types'
import type { AiExplanationController } from './useAiExplanation'
import type { EngineAnalysisController } from './useEngineAnalysis'
import {
  canScheduleLiveAnalysis,
  hasBothKings,
  isSameAnalysisTarget,
  liveAnalysisRetryDelayMs
} from './liveAnalysis'

export interface AnalysisOrchestrationOptions {
  visible: boolean
  board: BoardState
  analysisMove: string
  actualMove: ActualMoveSelection | null
  submittedGuess: SubmittedGuess | null
  engine: EngineAnalysisController
  ai: AiExplanationController
}

/**
 * 跨越引擎與 AI 兩條生命週期的規則：何時自動分析實戰步、何時排程 live 分析與精煉（含失敗退避），
 * 引擎完成後送出排隊的提問，以及猜測提交時觸發解說。
 *
 * 這些 effect 必須在兩個 hook 的重設 effect 之後、並依這裡的順序執行；
 * AnalysisPanel 依 useEngineAnalysis → useAiExplanation → useAnalysisOrchestration 的順序呼叫。
 */
export function useAnalysisOrchestration({
  visible,
  board,
  analysisMove,
  actualMove,
  submittedGuess,
  engine,
  ai
}: AnalysisOrchestrationOptions): { stopAll: () => void } {
  const {
    status,
    busy,
    livePaused,
    result,
    liveRetryCount,
    activeRequestId,
    explicitAnalysisTarget,
    startAnalysis
  } = engine
  const { aiBusy, currentAiTargetRef, generateExplanation } = ai
  const lastSubmittedExplanationId = useRef<string | null>(null)

  useEffect(() => {
    if (
      !actualMove ||
      actualMove.positionFen !== board.fen ||
      !visible ||
      !status?.available ||
      !hasBothKings(board) ||
      livePaused ||
      busy ||
      activeRequestId.current
    ) {
      return
    }
    const target = `${actualMove.selectionId}|${actualMove.positionFen}|${actualMove.move}`
    if (explicitAnalysisTarget.current === target) return
    explicitAnalysisTarget.current = target
    startAnalysis(true)
  }, [actualMove, board, busy, livePaused, startAnalysis, status?.available, visible])

  useEffect(() => {
    // 一鍵實戰步採用第一個穩定快照直接解說；不要在背景再啟動 15 秒精煉，
    // 否則會和模型請求搶資源，也違反點擊後的快速路徑契約。
    if (
      actualMove &&
      isSameAnalysisTarget(result?.engineAnalysis ?? null, board.fen, analysisMove)
    ) {
      return
    }
    if (actualMove && liveRetryCount > 0) return
    if (
      aiBusy || ai.hasQueuedExplanation() ||
      !canScheduleLiveAnalysis({
        livePaused,
        visible,
        engineAvailable: Boolean(status?.available),
        boardValid: hasBothKings(board),
        analysisBusy: busy
      }) ||
      activeRequestId.current
    ) return

    const retryDelay = liveAnalysisRetryDelayMs(liveRetryCount)
    const delay = retryDelay || (result ? 320 : 180)
    const timer = window.setTimeout(() => startAnalysis(true), delay)
    return () => window.clearTimeout(timer)
  }, [
    board,
    busy,
    livePaused,
    liveRetryCount,
    result?.analysisId,
    aiBusy,
    startAnalysis,
    status?.available,
    analysisMove,
    actualMove,
    visible
  ])

  useEffect(() => {
    if (!ai.hasQueuedExplanation() || busy || activeRequestId.current || !result) return
    ai.runQueuedExplanation()
  }, [busy, result?.analysisId])

  useEffect(() => {
    const submissionId = submittedGuess?.submissionId
    if (!submissionId || lastSubmittedExplanationId.current === submissionId) return
    lastSubmittedExplanationId.current = submissionId
    const target = currentAiTargetRef.current
    if (!target) return

    ai.resetForNewSubmission()

    if (
      result &&
      !busy &&
      !activeRequestId.current &&
      isSameAnalysisTarget(result.engineAnalysis, board.fen, analysisMove)
    ) {
      generateExplanation(null)
      return
    }

    ai.queueExplanationUntilAnalysisCompletes(target)
    if (!activeRequestId.current) startAnalysis(true)
  }, [submittedGuess?.submissionId])

  const stopAll = (): void => {
    ai.dropQueuedExplanation()
    engine.pauseAndCancelAnalysis()
    ai.cancelActiveExplanation()
  }

  return { stopAll }
}
