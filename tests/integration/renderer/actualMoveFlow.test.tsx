import assert from 'node:assert/strict'
import * as React from 'react'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import { AnalysisPanel } from '../../../src/renderer/src/features/analysis/AnalysisPanel'
import {
  ACTUAL_MOVE_ENGINE_DEADLINE_MS,
  AUTO_INITIAL_ANALYSIS_MAX_MS,
  AUTO_USER_MOVE_ANALYSIS_MAX_MS,
  ONE_CLICK_EXPLANATION_DEADLINE_MS
} from '../../../src/renderer/src/features/analysis/liveAnalysis'
import type { ActualMoveSelection } from '../../../src/renderer/src/features/analysis/types'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import { parseFen } from '../../../src/shared/logic/board/fen'
import { START_FEN, type BoardState } from '../../../src/shared/types/BoardState'
import type { EngineAnalysis, EngineScore } from '../../../src/shared/types/EngineAnalysis'
import type {
  EngineInstallation,
  EngineRegistrySnapshot
} from '../../../src/shared/types/EngineRegistry'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
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
import type { HarnessProgressPayload } from '../../../src/shared/types/Harness'

interface PendingTimer {
  callback: () => void
  delayMs: number
}

function installation(id: string, displayName: string): EngineInstallation {
  return {
    id,
    profileId: 'pikafish',
    displayName,
    executablePath: `C:\\Engines\\${id}.exe`,
    protocol: 'uci',
    detectedName: displayName,
    enabled: true,
    verified: true,
    capabilities: {
      multiPv: true,
      configurableThreads: false,
      configurableHash: false
    }
  }
}

const registry: EngineRegistrySnapshot = {
  activeEngineId: 'primary-engine',
  verificationEngineId: null,
  installations: [installation('primary-engine', 'Pikafish')]
}

function startingBoard(): BoardState {
  const parsed = parseFen(START_FEN)
  assert.equal(parsed.valid, true)
  if (!parsed.valid) throw new Error(parsed.message)
  return parsed.board
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

function analysis(userMove: string, displayUserMove: string): EngineAnalysis {
  const bestScore = score(80, 'root_analysis')
  const userScore = score(20, 'candidate_move')
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    userMove,
    displayUserMove,
    bestMove: 'c3c4',
    displayBestMove: '兵七進一',
    scoreAfterUserMove: userScore,
    scoreAfterBestMove: bestScore,
    evaluationAfterUserMove: userScore.comparableValue,
    evaluationAfterBestMove: bestScore.comparableValue,
    userMoveEvaluationSource: 'candidate_move',
    userMovePrincipalVariation: [userMove, 'h9g7'],
    displayUserMovePrincipalVariation: [displayUserMove, '馬8進7'],
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
        move: userMove,
        displayMove: displayUserMove,
        score: userScore,
        evaluation: userScore.comparableValue,
        depth: 12,
        principalVariation: [userMove, 'h9g7'],
        displayPrincipalVariation: [displayUserMove, '馬8進7']
      }
    ],
    principalVariation: ['c3c4', 'h9g7'],
    displayPrincipalVariation: ['兵七進一', '馬8進7'],
    analysisTimeMs: 1_700,
    incomplete: false,
    warnings: [],
    engineId: 'primary-engine',
    engineName: 'Primary Engine'
  }
}

function result(
  requestId: string,
  analysisId: string,
  userMove: string,
  displayUserMove: string
): EngineAnalysisResultPayload {
  const engineAnalysis = analysis(userMove, displayUserMove)
  return {
    requestId,
    analysisId,
    engineAnalysis,
    moveComparison: compareMove(engineAnalysis)
  }
}

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function main(): Promise<void> {
  const engineStarts: AnalyzePositionStartPayload[] = []
  const engineCancels: string[] = []
  const aiStarts: GenerateExplanationStartPayload[] = []
  const aiCancels: string[] = []
  const deliveredResults: EngineAnalysisResultPayload[] = []
  let engineResultListener: ((payload: EngineAnalysisResultPayload) => void) | null = null
  let engineProgressListener: ((payload: EngineAnalysisProgressPayload) => void) | null = null
  let engineErrorListener: ((payload: EngineAnalysisErrorPayload) => void) | null = null
  let aiChunkListener: ((payload: GenerateExplanationChunkPayload) => void) | null = null
  let aiDoneListener: ((payload: GenerateExplanationDonePayload) => void) | null = null
  let aiErrorListener: ((payload: GenerateExplanationErrorPayload) => void) | null = null
  let harnessProgressListener: ((payload: HarnessProgressPayload) => void) | null = null
  let nextTimerId = 1
  const timeouts = new Map<number, PendingTimer>()
  const intervals = new Set<number>()

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
        engineName: 'Primary Engine',
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
      timeouts.set(id, { callback: handler as () => void, delayMs: delay })
      return id
    },
    clearTimeout: (id: number): void => {
      timeouts.delete(id)
    },
    setInterval: (): number => {
      const id = nextTimerId++
      intervals.add(id)
      return id
    },
    clearInterval: (id: number): void => {
      intervals.delete(id)
    }
  } as unknown as Window & typeof globalThis

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow
  })

  const board = startingBoard()
  const firstMove: ActualMoveSelection = {
    selectionId: 'selection-1',
    positionFen: START_FEN,
    move: 'h2e2',
    displayMove: '炮二平五',
    plyIndex: 0,
    selectedAt: Date.now()
  }
  const secondMove: ActualMoveSelection = {
    selectionId: 'selection-2',
    positionFen: START_FEN,
    move: 'b2e2',
    displayMove: '炮八平五',
    plyIndex: 1,
    selectedAt: Date.now()
  }
  const stableCallbacks = {
    onActiveViewChange: () => undefined,
    onConversationChange: () => undefined,
    onResult: (payload: EngineAnalysisResultPayload | null) => {
      if (payload) deliveredResults.push(payload)
    },
    onExplanation: () => undefined,
    onSaveMisunderstood: () => undefined,
    onStatusChange: () => undefined
  }
  const props = (actualMove: ActualMoveSelection) => ({
    visible: true,
    activeView: 'coach' as const,
    liveDockElement: null,
    detailsDockElement: null,
    board,
    settings: { ...DEFAULT_SETTINGS, harnessAutoRun: true },
    submittedGuess: null,
    actualMove,
    conversation: null,
    ...stableCallbacks
  })

  let renderer: ReactTestRenderer | null = null
  try {
    await act(async () => {
      renderer = create(<AnalysisPanel {...props(firstMove)} />)
      await flushMicrotasks()
    })
    assert.ok(renderer)
    assert.equal(engineStarts.length, 1, '選取實戰步後應自動啟動一次本機分析')
    assert.equal(aiStarts.length, 0, '選取實戰步不得自動呼叫 AI')
    const firstRequestId = engineStarts[0].requestId
    assert.equal(engineStarts[0].verificationEngineId, undefined)
    assert.deepEqual(engineStarts[0].analysisConfig, {
      rootAnalysisMovetimeMs: AUTO_INITIAL_ANALYSIS_MAX_MS,
      userMoveEvalMovetimeMs: AUTO_USER_MOVE_ANALYSIS_MAX_MS,
      multiPv: DEFAULT_SETTINGS.multiPv
    })
    assert.equal(timeouts.size, 1, '實戰步應建立一個 3 秒引擎截止計時器')
    assert.ok(
      [...timeouts.values()][0].delayMs > 0 &&
        [...timeouts.values()][0].delayMs <= ACTUAL_MOVE_ENGINE_DEADLINE_MS
    )

    act(() => {
      renderer?.update(<AnalysisPanel {...props(secondMove)} />)
    })
    assert.equal(engineStarts.length, 2, '快速切換著法應啟動新分析')
    assert.deepEqual(engineCancels, [firstRequestId], '快速切換著法應取消舊分析')
    assert.equal(timeouts.size, 1, '換步應清除舊截止時間並只保留目前分析')
    assert.equal(aiStarts.length, 0)
    const secondRequestId = engineStarts[1].requestId

    assert.ok(engineResultListener)
    act(() => {
      engineResultListener?.(
        result(firstRequestId, 'stale-analysis', firstMove.move, firstMove.displayMove)
      )
    })
    assert.equal(deliveredResults.length, 0, '舊 requestId 的結果必須被忽略')
    assert.equal(aiStarts.length, 0)

    act(() => {
      engineResultListener?.(
        result(secondRequestId, 'analysis-2', secondMove.move, secondMove.displayMove)
      )
    })
    assert.equal(deliveredResults.length, 1)
    assert.equal(aiStarts.length, 0, '引擎完成後仍不得自動呼叫 AI')
    assert.equal(timeouts.size, 0, '引擎完成後必須清除 3 秒截止計時器')
    assert.doesNotMatch(
      textContent(renderer.root),
      /複核引擎|降級/
    )

    const generateButton = renderer.root
      .findAllByType('button')
      .find((button) => textContent(button).includes('產生完整 AI 解說'))
    assert.ok(generateButton, '引擎結果後應提供一次產生完整解說的按鈕')
    act(() => {
      generateButton.props.onClick()
      generateButton.props.onClick()
    })
    assert.equal(aiStarts.length, 1, '連續點擊也只能啟動一個完整 AI 請求')
    assert.equal(aiStarts[0].analysisId, 'analysis-2')
    assert.equal(aiStarts[0].attachedMove, secondMove.move)
    assert.equal(aiStarts[0].verificationEngineId, undefined)
    assert.equal(aiStarts[0].explanationStyle, 'long_analytical')
    assert.equal(aiStarts[0].followUpQuestion, undefined)

    assert.equal(timeouts.size, 1, 'AI 請求只應建立一個截止計時器')
    const [deadlineId, deadline] = [...timeouts.entries()][0]
    assert.ok(
      deadline.delayMs > ONE_CLICK_EXPLANATION_DEADLINE_MS - 1_000 &&
        deadline.delayMs <= ONE_CLICK_EXPLANATION_DEADLINE_MS
    )
    timeouts.delete(deadlineId)
    act(() => deadline.callback())
    assert.deepEqual(aiCancels, [aiStarts[0].requestId])
    assert.match(textContent(renderer.root), /AI 解說在點擊後 90 秒內未完成/)

    const timedMove: ActualMoveSelection = {
      ...firstMove,
      selectionId: 'selection-engine-timeout',
      selectedAt: Date.now()
    }
    act(() => {
      renderer?.update(<AnalysisPanel {...props(timedMove)} />)
    })
    assert.equal(engineStarts.length, 3)
    const timedEngineRequestId = engineStarts[2].requestId
    assert.equal(timeouts.size, 1)
    const [engineDeadlineId, engineDeadline] = [...timeouts.entries()][0]
    assert.ok(engineDeadline.delayMs > 0 && engineDeadline.delayMs <= 3_000)
    timeouts.delete(engineDeadlineId)
    act(() => engineDeadline.callback())
    assert.equal(engineCancels.at(-1), timedEngineRequestId)
    assert.match(textContent(renderer.root), /引擎比較在點擊後 3 秒內未完成/)

    const aiSwitchMove: ActualMoveSelection = {
      ...secondMove,
      selectionId: 'selection-ai-switch',
      selectedAt: Date.now()
    }
    act(() => {
      renderer?.update(<AnalysisPanel {...props(aiSwitchMove)} />)
    })
    assert.equal(engineStarts.length, 4)
    const aiSwitchEngineRequestId = engineStarts[3].requestId
    act(() => {
      engineResultListener?.(
        result(aiSwitchEngineRequestId, 'analysis-ai-switch', aiSwitchMove.move, aiSwitchMove.displayMove)
      )
    })
    const switchGenerateButton = renderer.root
      .findAllByType('button')
      .find((button) => textContent(button).includes('產生完整 AI 解說'))
    assert.ok(switchGenerateButton)
    act(() => switchGenerateButton.props.onClick())
    assert.equal(aiStarts.length, 2)
    const switchedAwayAiRequestId = aiStarts[1].requestId

    const finalMove: ActualMoveSelection = {
      ...firstMove,
      selectionId: 'selection-final',
      selectedAt: Date.now()
    }
    act(() => {
      renderer?.update(<AnalysisPanel {...props(finalMove)} />)
    })
    assert.equal(aiCancels.at(-1), switchedAwayAiRequestId, '換步必須取消進行中的 AI')
    act(() => {
      aiDoneListener?.({
        requestId: switchedAwayAiRequestId,
        finalText: 'OLD_AI_RESULT_MUST_NOT_APPEAR'
      })
    })
    assert.doesNotMatch(textContent(renderer.root), /OLD_AI_RESULT_MUST_NOT_APPEAR/)

    assert.equal(engineStarts.length, 5)
    const finalEngineRequestId = engineStarts[4].requestId
    act(() => {
      engineResultListener?.(
        result(finalEngineRequestId, 'analysis-final', finalMove.move, finalMove.displayMove)
      )
    })
    const finalGenerateButton = renderer.root
      .findAllByType('button')
      .find((button) => textContent(button).includes('產生完整 AI 解說'))
    assert.ok(finalGenerateButton)
    act(() => finalGenerateButton.props.onClick())
    assert.equal(aiStarts.length, 3)
    const completeText = [
      '## 完整實戰解說',
      '### 直接結論',
      '炮二平五讓中路先暴露，AI 首選兵七進一先穩住陣形。',
      '### 實戰步問題',
      '炮二平五過早表態，使對手可用馬8進7封住後續攻勢。',
      '### AI 首選',
      '兵七進一先控制要點並保留兩翼出子選擇。',
      '### 對手利用與後果',
      '對手以馬8進7發展後，紅方中炮會受到牽制。',
      '### 實戰原則',
      '先確認對手最強回應，再決定是否提早暴露主攻方向。'
    ].join('\n')
    act(() => {
      aiDoneListener?.({ requestId: aiStarts[2].requestId, finalText: completeText })
    })
    const rendered = textContent(renderer.root)
    assert.match(rendered, /完整實戰解說/)
    assert.match(rendered, /直接結論/)
    assert.match(rendered, /實戰步問題/)
    assert.match(rendered, /AI 首選/)
    assert.match(rendered, /對手利用與後果/)
    assert.match(rendered, /實戰原則/)
    assert.equal(timeouts.size, 0, '完整 AI 回覆後必須清除截止計時器')

    console.log('Actual-move renderer flow tests passed')
  } finally {
    if (renderer) act(() => renderer?.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
