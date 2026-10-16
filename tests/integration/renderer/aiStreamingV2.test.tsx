import assert from 'node:assert/strict'
import * as React from 'react'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import {
  AnalysisPanel,
  type AnalysisPanelHandle
} from '../../../src/renderer/src/features/analysis/AnalysisPanel'
import type { SubmittedGuess } from '../../../src/shared/types/UserGuess'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { START_FEN, type BoardState } from '../../../src/shared/types/BoardState'
import type {
  EngineAnalysis,
  EngineCandidateMove,
  EngineScore
} from '../../../src/shared/types/EngineAnalysis'
import type {
  EngineInstallation,
  EngineRegistrySnapshot
} from '../../../src/shared/types/EngineRegistry'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../src/shared/types/Settings'
import type {
  AnalyzePositionStartPayload,
  EngineAnalysisErrorPayload,
  EngineAnalysisProgressPayload,
  EngineAnalysisResultPayload,
  GenerateExplanationChunkPayload,
  GenerateExplanationDonePayload,
  GenerateExplanationErrorPayload,
  GenerateExplanationStartPayload,
  RendererApi
} from '../../../src/shared/types/ipc'
import type { AIConversation } from '../../../src/shared/types/AppData'
import type { HarnessProgressPayload } from '../../../src/shared/types/Harness'

interface PendingTimer {
  callback: () => void
  delayMs: number
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function startingBoard(): BoardState {
  const parsed = parseFen(START_FEN)
  if (!parsed.valid) throw new Error(parsed.message)
  return parsed.board
}

function installation(): EngineInstallation {
  return {
    id: 'primary-engine',
    profileId: 'pikafish',
    displayName: 'Pikafish',
    executablePath: 'C:\\Engines\\pikafish.exe',
    protocol: 'uci',
    detectedName: 'Pikafish',
    enabled: true,
    verified: true,
    capabilities: {
      multiPv: true,
      configurableThreads: false,
      configurableHash: false
    }
  }
}

function score(cp: number, source: EngineScore['source']): EngineScore {
  return {
    type: 'cp',
    cp,
    value: cp / 100,
    comparableValue: cp / 100,
    raw: `score cp ${cp}`,
    displayText: `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`,
    wasInverted: false,
    source
  }
}

function engineAnalysis(): EngineAnalysis {
  const bestScore = score(80, 'root_analysis')
  const userScore = score(20, 'candidate_move')
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    userMove: 'h2e2',
    displayUserMove: '炮二平五',
    bestMove: 'c3c4',
    displayBestMove: '兵七進一',
    scoreAfterUserMove: userScore,
    scoreAfterBestMove: bestScore,
    evaluationAfterUserMove: userScore.comparableValue,
    evaluationAfterBestMove: bestScore.comparableValue,
    userMoveEvaluationSource: 'candidate_move',
    userMovePrincipalVariation: ['h2e2', 'h9g7'],
    displayUserMovePrincipalVariation: ['炮二平五', '馬8進7'],
    depth: 12,
    candidateMoves: [
      {
        move: 'c3c4',
        displayMove: '兵七進一',
        score: bestScore,
        evaluation: bestScore.comparableValue,
        depth: 12,
        principalVariation: ['c3c4', 'h9g7'],
        displayPrincipalVariation: ['兵七進一', '馬8進7']
      },
      {
        move: 'h2e2',
        displayMove: '炮二平五',
        score: userScore,
        evaluation: userScore.comparableValue,
        depth: 12,
        principalVariation: ['h2e2', 'h9g7'],
        displayPrincipalVariation: ['炮二平五', '馬8進7']
      }
    ],
    principalVariation: ['c3c4', 'h9g7'],
    displayPrincipalVariation: ['兵七進一', '馬8進7'],
    analysisTimeMs: 1_000,
    incomplete: false,
    warnings: [],
    engineId: 'primary-engine',
    engineName: 'Pikafish'
  }
}

function analysisResult(
  requestId: string,
  depth = 12,
  analysisId = 'analysis-original'
): EngineAnalysisResultPayload {
  const analysis = { ...engineAnalysis(), depth }
  return {
    requestId,
    analysisId,
    engineAnalysis: analysis,
    moveComparison: compareMove(analysis)
  }
}


async function main(): Promise<void> {
  const registry: EngineRegistrySnapshot = {
    activeEngineId: 'primary-engine',
    installations: [installation()]
  }
  const engineStarts: AnalyzePositionStartPayload[] = []
  const engineCancels: string[] = []
  const aiStarts: GenerateExplanationStartPayload[] = []
  const aiCancels: string[] = []
  const timers = new Map<number, PendingTimer>()
  const copied: string[] = []
  const conversationChanges: Array<AIConversation | null> = []
  let conversation = null as AIConversation | null
  let engineResultListener: ((payload: EngineAnalysisResultPayload) => void) | null = null
  let engineProgressListener: ((payload: EngineAnalysisProgressPayload) => void) | null = null
  let engineErrorListener: ((payload: EngineAnalysisErrorPayload) => void) | null = null
  let aiChunkListener: ((payload: GenerateExplanationChunkPayload) => void) | null = null
  let aiDoneListener: ((payload: GenerateExplanationDonePayload) => void) | null = null
  let aiErrorListener: ((payload: GenerateExplanationErrorPayload) => void) | null = null
  let harnessProgressListener: ((payload: HarnessProgressPayload) => void) | null = null
  let nextTimerId = 1

  const api = {
    engine: {
      startAnalysis: (payload: AnalyzePositionStartPayload) => engineStarts.push(payload),
      cancelAnalysis: (requestId: string) => engineCancels.push(requestId),
      onAnalysisResult: (listener: (payload: EngineAnalysisResultPayload) => void) => {
        engineResultListener = listener
        return () => {
          if (engineResultListener === listener) engineResultListener = null
        }
      },
      onAnalysisProgress: (listener: (payload: EngineAnalysisProgressPayload) => void) => {
        engineProgressListener = listener
        return () => {
          if (engineProgressListener === listener) engineProgressListener = null
        }
      },
      onAnalysisError: (listener: (payload: EngineAnalysisErrorPayload) => void) => {
        engineErrorListener = listener
        return () => {
          if (engineErrorListener === listener) engineErrorListener = null
        }
      },
      status: async () => ({
        engineId: 'primary-engine',
        available: true,
        engineName: 'Pikafish',
        protocol: 'uci' as const
      }),
      test: async () => ({ ok: true, protocol: 'uci' as const }),
      listInstallations: async () => registry,
      selectInstallation: async () => registry
    },
    ai: {
      startExplanation: (payload: GenerateExplanationStartPayload) => aiStarts.push(payload),
      cancelExplanation: (requestId: string) => aiCancels.push(requestId),
      continueExplanation: () => undefined,
      onExplanationChunk: (listener: (payload: GenerateExplanationChunkPayload) => void) => {
        aiChunkListener = listener
        return () => {
          if (aiChunkListener === listener) aiChunkListener = null
        }
      },
      onExplanationDone: (listener: (payload: GenerateExplanationDonePayload) => void) => {
        aiDoneListener = listener
        return () => {
          if (aiDoneListener === listener) aiDoneListener = null
        }
      },
      onExplanationError: (listener: (payload: GenerateExplanationErrorPayload) => void) => {
        aiErrorListener = listener
        return () => {
          if (aiErrorListener === listener) aiErrorListener = null
        }
      },
      onHarnessProgress: (listener: (payload: HarnessProgressPayload) => void) => {
        harnessProgressListener = listener
        return () => {
          if (harnessProgressListener === listener) harnessProgressListener = null
        }
      },
      setHarnessFeedback: async () => ({ ok: true as const })
    }
  } as unknown as RendererApi

  const fakeWindow = {
    api,
    setTimeout: (handler: TimerHandler, delay = 0): number => {
      assert.equal(typeof handler, 'function')
      const id = nextTimerId++
      timers.set(id, { callback: handler as () => void, delayMs: delay })
      return id
    },
    clearTimeout: (id: number): void => {
      timers.delete(id)
    },
    setInterval: (): number => nextTimerId++,
    clearInterval: (): void => undefined
  } as unknown as Window & typeof globalThis

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (value: string): Promise<void> => {
          copied.push(value)
        }
      }
    }
  })

  const board = startingBoard()
  const firstSubmission: SubmittedGuess = {
    submissionId: 'submission-first',
    move: 'h2e2',
    reason: '我要控制中路',
    submittedAt: Date.now()
  }
  const originalSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    aiModel: 'original-model'
  }
  const panelRef = React.createRef<AnalysisPanelHandle>()
  const callbacks = {
    onConversationChange: (next: AIConversation | null) => {
      conversation = next
      conversationChanges.push(next)
    },
    onResult: () => undefined,
    onReplayCandidates: (_: EngineCandidateMove[]) => undefined,
    onExplanation: () => undefined,
    onStatusChange: () => undefined
  }
  const panel = (submission: SubmittedGuess | null) => (
    <AnalysisPanel
      ref={panelRef}
      visible
      activeView="coach"
      liveDockElement={null}
      detailsDockElement={null}
      board={board}
      settings={originalSettings}
      submittedGuess={submission}
      actualMove={null}
      conversation={conversation}
      {...callbacks}
    />
  )

  let renderer = null as ReactTestRenderer | null
  try {
    await act(async () => {
      renderer = create(panel(null))
      await flushMicrotasks()
    })
    assert.ok(renderer)
    await act(async () => {
      renderer?.update(panel(firstSubmission))
      await flushMicrotasks()
    })
    act(() => engineResultListener?.(analysisResult(engineStarts[0].requestId)))
    assert.equal(aiStarts.length, 1)
    const first = aiStarts[0].requestId

    // 第 1 次回答串流到一半，第 2 次（修正）開始時取代舊文字。
    act(() => aiChunkListener?.({ requestId: first, deltaText: 'FIRST_ATTEMPT_TEXT', attempt: 1 }))
    assert.match(textContent(renderer.root), /FIRST_ATTEMPT_TEXT/)
    assert.match(textContent(renderer.root), /正在整理重點/)
    act(() => aiChunkListener?.({ requestId: first, deltaText: 'SECOND_', attempt: 2 }))
    act(() => aiChunkListener?.({ requestId: first, deltaText: 'ATTEMPT', attempt: 2 }))
    const streaming = textContent(renderer.root)
    assert.match(streaming, /SECOND_ATTEMPT/)
    assert.doesNotMatch(streaming, /FIRST_ATTEMPT_TEXT/, 'a new attempt replaces the previous stream')
    assert.match(streaming, /正在檢查並修正/)

    // 備援模型回答：標示「由 X 回答」與主模型無法使用的原因，對話記錄實際模型。
    act(() => aiDoneListener?.({
      requestId: first,
      finalText: 'BACKUP_FINAL_ANSWER',
      provider: 'openrouter',
      model: 'vendor/primary:free',
      answerKind: 'ai',
      actualModel: 'vendor/backup:free',
      fallbackFromModel: 'vendor/primary:free',
      fallbackReason: '模型暫時無法回應',
      repairUsed: false
    }))
    await act(async () => {
      renderer?.update(panel(firstSubmission))
      await flushMicrotasks()
    })
    const answered = textContent(renderer.root)
    assert.match(answered, /BACKUP_FINAL_ANSWER/)
    assert.match(answered, /由 vendor\/backup:free 回答（vendor\/primary:free 暫時無法使用：模型暫時無法回應）/)
    const lastConversation = conversationChanges.at(-1)
    assert.equal(lastConversation?.messages.at(-1)?.model, 'vendor/backup:free')

    // 引擎重點摘要：黃色橫幅＋「重試 AI」原樣重送同一個請求。
    const input = renderer.root.findByProps({ 'aria-label': 'AI 提問' })
    act(() => input.props.onChange({ target: { value: '為什麼不好？' } }))
    const ask = renderer.root
      .findAllByType('button')
      .find((button) => ['提問', '追問'].includes(textContent(button)))
    assert.ok(ask)
    act(() => ask.props.onClick())
    assert.equal(aiStarts.length, 2)
    const second = aiStarts[1]
    act(() => aiDoneListener?.({
      requestId: second.requestId,
      finalText: '⚠ AI 解說這次沒有通過檢查。以下是引擎重點摘要（非 AI 生成）：SUMMARY_BODY',
      provider: 'openrouter',
      model: 'vendor/primary:free',
      answerKind: 'engine_summary',
      repairUsed: true
    }))
    await act(async () => {
      renderer?.update(panel(firstSubmission))
      await flushMicrotasks()
    })
    const summaryText = textContent(renderer.root)
    assert.match(summaryText, /AI 這次沒有通過檢查，下方是引擎重點摘要（非 AI 生成）/)
    assert.doesNotMatch(summaryText, /由 vendor/, 'no model attribution on a non-AI summary')
    const retry = renderer.root.findAllByType('button').find((button) => textContent(button) === '重試 AI')
    assert.ok(retry, 'summary offers 重試 AI')
    act(() => retry.props.onClick())
    assert.equal(aiStarts.length, 3, 'retry sends a new request')
    assert.notEqual(aiStarts[2].requestId, second.requestId)
    assert.equal(aiStarts[2].followUpQuestion, second.followUpQuestion, 'retry re-sends the same question')
    assert.equal(aiStarts[2].analysisId, second.analysisId)
    console.log('v2 streaming, attribution and engine-summary renderer flow: passed')
  } finally {
    if (renderer) act(() => renderer?.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
