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
import type { ActualMoveSelection } from '../../../src/renderer/src/features/analysis/types'
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
import { ONE_CLICK_EXPLANATION_DEADLINE_MS } from '../../../src/renderer/src/features/analysis/liveAnalysis'

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
  assert.equal(parsed.valid, true)
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

function analysisResult(requestId: string): EngineAnalysisResultPayload {
  const analysis = engineAnalysis()
  return {
    requestId,
    analysisId: 'analysis-original',
    engineAnalysis: analysis,
    moveComparison: compareMove(analysis)
  }
}

function findButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const button = renderer.root
    .findAllByType('button')
    .find((candidate) => textContent(candidate) === label)
  assert.ok(button, `應找到「${label}」按鈕`)
  return button
}

async function main(): Promise<void> {
  const registry: EngineRegistrySnapshot = {
    activeEngineId: 'primary-engine',
    verificationEngineId: null,
    installations: [installation()]
  }
  const engineStarts: AnalyzePositionStartPayload[] = []
  const engineCancels: string[] = []
  const aiStarts: GenerateExplanationStartPayload[] = []
  const aiCancels: string[] = []
  const timers = new Map<number, PendingTimer>()
  const copied: string[] = []
  const conversationChanges: Array<AIConversation | null> = []
  let conversation: AIConversation | null = null
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
    },
    teacherTest: {
      status: async () => ({
        currentAppVersion: '0.4.10',
        active: false,
        manifest: null
      })
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
  const actualMove: ActualMoveSelection = {
    selectionId: 'selection-original',
    positionFen: START_FEN,
    move: 'h2e2',
    displayMove: '炮二平五',
    plyIndex: 0,
    selectedAt: Date.now()
  }
  const originalSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    harnessAutoRun: false,
    aiModel: 'original-model'
  }
  const changedSettings: AppSettings = {
    ...originalSettings,
    aiModel: 'changed-after-failure-model'
  }
  const panelRef = React.createRef<AnalysisPanelHandle>()
  const callbacks = {
    onActiveViewChange: () => undefined,
    onConversationChange: (next: AIConversation | null) => {
      conversation = next
      conversationChanges.push(next)
    },
    onResult: () => undefined,
    onReplayCandidates: (_: EngineCandidateMove[]) => undefined,
    onExplanation: () => undefined,
    onStatusChange: () => undefined
  }
  const panel = (settings: AppSettings, selection = actualMove) => (
    <AnalysisPanel
      ref={panelRef}
      visible
      activeView="coach"
      liveDockElement={null}
      detailsDockElement={null}
      board={board}
      settings={settings}
      submittedGuess={null}
      actualMove={selection}
      conversation={conversation}
      {...callbacks}
    />
  )

  let renderer: ReactTestRenderer | null = null
  try {
    await act(async () => {
      renderer = create(panel(originalSettings))
      await flushMicrotasks()
    })
    assert.ok(renderer)
    assert.equal(engineStarts.length,1)
    act(()=>panelRef.current?.requestExplanation())
    assert.equal(aiStarts.length,0,'皮卡魚還在分析時不得先呼叫模型')
    assert.match(textContent(renderer.root),/等待皮卡魚/)
    act(()=>engineResultListener?.(analysisResult(engineStarts[0].requestId)))
    assert.equal(aiStarts.length,1,'皮卡魚完成後才回答')
    assert.equal(aiStarts[0].analysisId,analysisResult(engineStarts[0].requestId).analysisId)
    act(()=>aiDoneListener?.({requestId:aiStarts[0].requestId,finalText:'完成皮卡魚解說'}))
    act(()=>panelRef.current?.startAnalysis())
    act(()=>panelRef.current?.requestExplanation())
    assert.equal(aiStarts.length,1)
    act(()=>panelRef.current?.cancelExplain())
    act(()=>engineResultListener?.(analysisResult(engineStarts.at(-1)!.requestId)))
    assert.equal(aiStarts.length,1,'取消等待後，遲到的引擎結果不能啟動模型')
    act(()=>panelRef.current?.startAnalysis())
    act(()=>panelRef.current?.requestExplanation())
    act(()=>engineErrorListener?.({requestId:engineStarts.at(-1)!.requestId,code:'engine_error',message:'engine failed'}))
    assert.equal(aiStarts.length,1,'引擎失敗不使用舊快照代答')
    assert.match(textContent(renderer.root),/皮卡魚分析未完成/)
    console.log('Wait for engine before model renderer flow: passed')

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
