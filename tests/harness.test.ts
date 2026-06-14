import type { AIProvider } from '../src/shared/types/AIProviderTypes'
import type { EngineAnalysis } from '../src/shared/types/EngineAnalysis'
import { START_FEN } from '../src/shared/types/BoardState'
import { convertCpScore } from '../src/main/engine/EngineOutputParser'
import { compareMove } from '../src/shared/logic/MoveComparisonService'
import { runExplanationHarness } from '../src/main/ai/HarnessOrchestrator'
import type { AnalysisSession } from '../src/main/storage/AnalysisSessionStore'
import type { HarnessTrace } from '../src/shared/types/Harness'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail === undefined ? '' : ` — ${String(detail)}`}`)
  }
}

function analysis(): EngineAnalysis {
  const score = convertCpScore(42, 'score cp 42')
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    bestMove: 'h2e2',
    displayBestMove: '炮二平五',
    scoreAfterUserMove: null,
    scoreAfterBestMove: score,
    evaluationAfterUserMove: null,
    evaluationAfterBestMove: score.comparableValue,
    userMoveEvaluationSource: 'unavailable',
    depth: 12,
    candidateMoves: [
      {
        move: 'h2e2',
        displayMove: '炮二平五',
        score,
        evaluation: score.comparableValue,
        depth: 12,
        principalVariation: ['h2e2', 'h9g7'],
        displayPrincipalVariation: ['炮二平五', '馬8進7']
      }
    ],
    principalVariation: ['h2e2', 'h9g7'],
    displayPrincipalVariation: ['炮二平五', '馬8進7'],
    incomplete: false,
    warnings: [],
    engineId: 'engine-1',
    engineName: 'Test Engine'
  }
}

const engineAnalysis = analysis()
const session: AnalysisSession = {
  analysisId: 'analysis-1',
  requestId: 'engine-request-1',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  positionFen: START_FEN,
  primaryEngineId: 'engine-1',
  engineAnalysis,
  moveComparison: compareMove(engineAnalysis)
}

class FakeProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake'
  calls = 0

  async generateExplanation() {
    this.calls++
    const outputs = [
      '{"tasks":[{"kind":"root","purpose":"確認主線"}]}',
      '{"mode":"research","title":"局面分析","directAnswer":"目前首選是炮二平五。","directAnswerEvidenceIds":["E1"],"sections":[{"heading":"關鍵判斷","claims":[{"id":"C1","text":"引擎首選炮二平五，主要變例接馬8進7。","evidenceIds":["E1"]}]}],"warnings":[]}',
      '{"unsupportedClaimIds":[],"reasons":[]}'
    ]
    return {
      text: outputs[this.calls - 1] ?? '{}',
      provider: this.id,
      model: 'fake-model',
      createdAt: Date.now(),
      groundedOnEngineData: true as const,
      usage: { inputTokens: 10, outputTokens: 20 }
    }
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

async function main(): Promise<void> {
  console.log('\n## AI 解說 Harness')
  const traces: HarnessTrace[] = []
  const provider = new FakeProvider()
  const result = await runExplanationHarness(
    {
      requestId: 'ai-request-1',
      analysisId: session.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 3,
        maxModelCalls: 4,
        maxOutputTokens: 4000
      }
    },
    {
      provider,
      apiKey: 'not-stored-in-trace',
      model: 'fake-model',
      session,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => null
      } as never,
      traceStore: { save: (trace: HarnessTrace) => traces.push(trace) } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }
  )

  check('規劃、寫作與語意審查使用同一 Provider', provider.calls === 3)
  check('回答以中文呈現且含證據引用', result.finalText.includes('[E1]'))
  check('證據保留引擎名稱與中文主線', result.evidence[0]?.engineName === 'Test Engine')
  check('完成紀錄不保存 API key', !JSON.stringify(traces).includes('not-stored-in-trace'))
  check('完成狀態寫入本機 trace', traces[0]?.status === 'completed')

  const ambiguousProvider = new FakeProvider()
  const ambiguous = await runExplanationHarness(
    {
      requestId: 'ai-request-2',
      analysisId: session.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      followUpQuestion: '這步為什麼不好？'
    },
    {
      provider: ambiguousProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        })
      } as never,
      traceStore: { save: () => undefined } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }
  )
  check('模糊問題先要求使用者指出著法', ambiguous.clarificationRequired)
  check('模糊問題不浪費模型呼叫', ambiguousProvider.calls === 0)

  console.log(`結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exitCode = 1
}

void main()
