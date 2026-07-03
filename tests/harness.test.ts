import type { AIProvider } from '../src/shared/types/AIProviderTypes'
import type { EngineAnalysis } from '../src/shared/types/EngineAnalysis'
import { START_FEN } from '../src/shared/types/BoardState'
import { convertCpScore } from '../src/main/engine/EngineOutputParser'
import { compareMove } from '../src/shared/logic/MoveComparisonService'
import {
  runExplanationHarness,
  validateAnswer,
  validateConsequenceAudit
} from '../src/main/ai/HarnessOrchestrator'
import type {
  ConsequenceAudit,
  ConsequenceFinding
} from '../src/main/ai/HarnessOrchestrator'
import type { AnalysisSession } from '../src/main/storage/AnalysisSessionStore'
import type {
  HarnessAnswer,
  HarnessEvidence,
  HarnessTrace
} from '../src/shared/types/Harness'
import type { HarnessProgressPayload } from '../src/shared/types/Harness'

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
  const userScore = convertCpScore(7, 'score cp 7', 'candidate_move')
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    userMove: 'b0c2',
    displayUserMove: '馬八進七',
    bestMove: 'h2e2',
    displayBestMove: '炮二平五',
    scoreAfterUserMove: userScore,
    scoreAfterBestMove: score,
    evaluationAfterUserMove: userScore.comparableValue,
    evaluationAfterBestMove: score.comparableValue,
    userMoveEvaluationSource: 'candidate_move',
    userMovePrincipalVariation: ['b0c2', 'h9g7', 'h2e2', 'b9c7'],
    displayUserMovePrincipalVariation: [
      '馬八進七',
      '馬8進7',
      '炮二平五',
      '馬2進3'
    ],
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
      },
      {
        move: 'b0c2',
        displayMove: '馬八進七',
        score: userScore,
        evaluation: userScore.comparableValue,
        depth: 12,
        principalVariation: ['b0c2', 'h9g7', 'h2e2', 'b9c7'],
        displayPrincipalVariation: [
          '馬八進七',
          '馬8進7',
          '炮二平五',
          '馬2進3'
        ]
      },
      {
        move: 'c3c4',
        displayMove: '兵三進一',
        score: userScore,
        evaluation: userScore.comparableValue,
        depth: 12,
        principalVariation: ['c3c4', 'h9g7'],
        displayPrincipalVariation: ['兵三進一', '馬8進7']
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
      '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E1"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E1"],"verified":true}],"contradictions":[],"enoughEvidence":true}',
      '{"mode":"research","title":"你問我答：著法分析","directAnswer":"馬八進七先走，錯過炮二平五立即控制中路的機會；黑方可趁機完成兩翼馬的部署，使紅方之後補走中炮時已失去先手。","directAnswerEvidenceIds":["E1"],"sections":[{"heading":"問：最佳著法想做什麼？","claims":[{"id":"C1","text":"炮二平五立即控制中路並保留先手。","evidenceIds":["E1"]}]},{"heading":"問：你的著法錯失什麼？","claims":[{"id":"C2","text":"馬八進七先出子，錯過立即控制中路的時機。","evidenceIds":["E1"],"causal":{"cause":"因為先走馬八進七而不是炮二平五","mechanism":"開局第一時間的中路壓制被推遲","affected":"紅方中炮與中路攻勢","opponentUse":"黑方趁機馬8進7完成出子","consequence":"紅方補走炮二平五時黑方已多完成一步部署"}}]},{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方以馬8進7和馬2進3完成兩翼馬部署。","evidenceIds":["E1"],"causal":{"cause":"因為馬八進七沒有立即施壓","mechanism":"黑方獲得連續出子的節奏，完成兩翼部署","affected":"黑方雙馬與整體陣形","opponentUse":"黑方接連走馬8進7與馬2進3","consequence":"黑方陣形完整，紅方中路計畫慢一拍"}}]},{"heading":"問：後續主線與具體後果是什麼？","claims":[{"id":"C4","text":"馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3；結果是紅方中路計畫延後，黑方多完成一步部署。","evidenceIds":["E1"],"causal":{"cause":"因為馬八進七後黑方馬8進7","mechanism":"紅方被迫在第三手才補炮二平五控制中路","affected":"紅方中路與先手節奏","opponentUse":"黑方再走馬2進3補齊另一翼","consequence":"黑方多完成一步部署，紅方攻勢延後"}}]},{"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[{"id":"C5","text":"炮二平五先控制中路；馬八進七則讓黑方先完成出子，之後紅方仍要補走中炮。","evidenceIds":["E1"],"causal":{"cause":"因為炮二平五與馬八進七的次序互換","mechanism":"中路控制與出子節奏易手","affected":"紅方先手與黑方陣形","opponentUse":"黑方按馬8進7、馬2進3從容應對","consequence":"紅方需要多花一手補回中炮，黑方部署領先"}}]},{"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[{"id":"C6","text":"先問是否有需要立即爭取的中路或先手機會，再檢查普通出子是否會讓對手從容部署。","evidenceIds":["E1"]}]}],"generalNotes":["一般而言，先出正馬再補中炮，容易讓對手搶先完成部署。"],"warnings":[]}',
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

class StagnationProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake stagnation provider'
  calls = 0

  async generateExplanation() {
    this.calls++
    const outputs = [
      '{"bestMovePurpose":"炮二平五控制中路。","userMoveProblem":"馬八進七延後中路計畫。","consequences":[{"id":"K1","category":"initiative_loss","summary":"失去先手。","opponentUse":"黑方馬8進7出子。","boardImpact":"黑方先完成一步部署。","supportingMoves":["馬八進七","馬8進7"],"evidenceIds":["E2"],"verified":true}],"contradictions":[],"enoughEvidence":false}',
      '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過炮二平五立即控制中路的時機。","consequences":[{"id":"K1","category":"initiative_loss","summary":"馬八進七讓炮二平五延後到第三手才補，紅方中路先手被推遲。","opponentUse":"黑方在馬八進七後立即馬8進7，把本來要面對中炮壓力的時間拿去出子。","boardImpact":"紅方第三手才炮二平五，黑方已先完成馬8進7，紅方中路計畫慢一拍。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E3"],"verified":true},{"id":"K2","category":"opponent_development","summary":"炮二平五被延後後，黑方可以接馬2進3補齊另一翼馬。","opponentUse":"黑方先馬8進7，再在紅方炮二平五後馬2進3，兩翼馬都出動。","boardImpact":"到馬2進3時，黑方左右馬已連續完成部署，紅方只補回中炮，局面主動性下降。","supportingMoves":["馬8進7","炮二平五","馬2進3"],"evidenceIds":["E3"],"verified":true}],"contradictions":[],"enoughEvidence":true}',
      '{"mode":"research","title":"你問我答：著法分析","directAnswer":"馬八進七先走，讓炮二平五延後；黑方可先馬8進7，等紅方補炮二平五後再馬2進3，左右馬都完成部署，紅方中路計畫慢一拍。","directAnswerEvidenceIds":["E3"],"sections":[{"heading":"問：最佳著法想做什麼？","claims":[{"id":"C1","text":"炮二平五要立即控制中路，避免黑方先從容出馬。","evidenceIds":["E3"]}]},{"heading":"問：你的著法錯失什麼？","claims":[{"id":"C2","text":"馬八進七把炮二平五延後，錯過第一時間建立中路壓力的機會。","evidenceIds":["E3"],"causal":{"cause":"因為先走馬八進七而非炮二平五","mechanism":"第一時間的中路壓制被推遲","affected":"紅方中炮與中路攻勢","opponentUse":"黑方趁機馬8進7先出子","consequence":"紅方要到第三手才補回中炮，先手節奏被拖慢"}}]},{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方先用馬8進7出子，等紅方炮二平五後再馬2進3，兩翼馬都取得發展。","evidenceIds":["E3"],"causal":{"cause":"因為馬八進七沒有立即施壓","mechanism":"黑方獲得連續出子的節奏完成部署","affected":"黑方雙馬與整體陣形","opponentUse":"黑方接連走馬8進7與馬2進3","consequence":"黑方兩翼馬完成部署，紅方中路計畫慢一拍"}}]},{"heading":"問：後續主線與具體後果是什麼？","claims":[{"id":"C4","text":"主線是馬八進七、馬8進7、炮二平五、馬2進3；到馬2進3時，黑方左右馬已連續完成部署，紅方只補回中炮。","evidenceIds":["E3"],"causal":{"cause":"因為馬八進七後黑方馬8進7","mechanism":"紅方被迫第三手才炮二平五控制中路","affected":"紅方中路與先手節奏","opponentUse":"黑方再走馬2進3補齊另一翼","consequence":"黑方左右馬連續完成部署，紅方攻勢延後"}}]},{"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[{"id":"C5","text":"炮二平五先走是先控中路；而馬八進七後黑方馬8進7，紅方再炮二平五，黑方還能馬2進3，紅方中路計畫慢一拍。","evidenceIds":["E3"],"causal":{"cause":"因為炮二平五與馬八進七的次序互換","mechanism":"中路控制與出子節奏易手","affected":"紅方先手與黑方陣形","opponentUse":"黑方按馬8進7、馬2進3從容應對","consequence":"紅方需要多花一手補回中炮，黑方部署領先"}}]},{"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[{"id":"C6","text":"先問最佳著法是否在搶立即控制點，再檢查普通出子會不會讓對手連續完成部署。","evidenceIds":["E3"]}]}],"warnings":[]}',
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

/** 規劃器 + 具體後果審查器都成功，但預算只夠這兩次呼叫，寫作階段會撞到上限。 */
class WriterBudgetProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake writer-budget provider'
  calls = 0

  async generateExplanation() {
    this.calls++
    const outputs = [
      '{"clarification":"","tasks":[{"kind":"root","purpose":"確認目前局面的最佳著法與後續主線"}]}',
      '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E1"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E1"],"verified":true}],"contradictions":[],"enoughEvidence":true}'
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

const GOOD_AUDIT_JSON =
  '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E1"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E1"],"verified":true}],"contradictions":[],"enoughEvidence":true}'

/** 寫作者輸出一個空泛的「對手如何利用」區塊，其餘皆合格；修正迴圈應只重寫該區塊。 */
const VAGUE_OPPONENT_WRITER_JSON =
  '{"mode":"research","title":"你問我答：著法分析","directAnswer":"馬八進七先走，錯過炮二平五立即控制中路的機會；黑方可趁機完成兩翼馬的部署，使紅方之後補走中炮時已失去先手。","directAnswerEvidenceIds":["E1"],"sections":[{"heading":"問：最佳著法想做什麼？","claims":[{"id":"C1","text":"炮二平五立即控制中路並保留先手。","evidenceIds":["E1"]}]},{"heading":"問：你的著法錯失什麼？","claims":[{"id":"C2","text":"馬八進七先出子，錯過立即控制中路的時機。","evidenceIds":["E1"],"causal":{"cause":"因為先走馬八進七而不是炮二平五","mechanism":"開局第一時間的中路壓制被推遲","affected":"紅方中炮與中路攻勢","opponentUse":"黑方趁機馬8進7完成出子","consequence":"紅方補走炮二平五時黑方已多完成一步部署"}}]},{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方大致上可以獲得不錯的機會。","evidenceIds":["E1"]}]},{"heading":"問：後續主線與具體後果是什麼？","claims":[{"id":"C4","text":"馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3；結果是紅方中路計畫延後，黑方多完成一步部署。","evidenceIds":["E1"],"causal":{"cause":"因為馬八進七後黑方馬8進7","mechanism":"紅方被迫在第三手才補炮二平五控制中路","affected":"紅方中路與先手節奏","opponentUse":"黑方再走馬2進3補齊另一翼","consequence":"黑方多完成一步部署，紅方攻勢延後"}}]},{"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[{"id":"C5","text":"炮二平五先控制中路；馬八進七則讓黑方先完成出子，之後紅方仍要補走中炮。","evidenceIds":["E1"],"causal":{"cause":"因為炮二平五與馬八進七的次序互換","mechanism":"中路控制與出子節奏易手","affected":"紅方先手與黑方陣形","opponentUse":"黑方按馬8進7、馬2進3從容應對","consequence":"紅方需要多花一手補回中炮，黑方部署領先"}}]},{"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[{"id":"C6","text":"先問是否有需要立即爭取的中路或先手機會，再檢查普通出子是否會讓對手從容部署。","evidenceIds":["E1"]}]}],"generalNotes":[],"warnings":[]}'

const FIXED_OPPONENT_SECTION_JSON =
  '{"sections":[{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方以馬8進7搶先出子，再馬2進3完成兩翼部署。","evidenceIds":["E1"],"causal":{"cause":"因為馬八進七沒有立即施壓","mechanism":"黑方獲得連續出子的節奏，完成兩翼部署","affected":"黑方雙馬與整體陣形","opponentUse":"黑方接連走馬8進7與馬2進3","consequence":"黑方陣形完整，紅方中路計畫慢一拍"}}]}]}'

/** 一個區塊空泛 → 迴圈第 1 輪只重寫該區塊即通過。 */
class RewriteLoopProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake rewrite-loop provider'
  calls = 0
  prompts: string[] = []

  async generateExplanation(request: { prompt: string }) {
    this.calls++
    this.prompts.push(request.prompt)
    const outputs = [
      GOOD_AUDIT_JSON,
      VAGUE_OPPONENT_WRITER_JSON,
      '{"unsupportedClaimIds":[],"reasons":[]}',
      FIXED_OPPONENT_SECTION_JSON
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

/** 每輪重寫都回傳同樣空泛的區塊 → 用滿修正輪數後必須走保守版，不會無限重試。 */
class StubbornVagueProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake stubborn-vague provider'
  calls = 0

  async generateExplanation() {
    this.calls++
    const outputs = [
      GOOD_AUDIT_JSON,
      VAGUE_OPPONENT_WRITER_JSON,
      '{"unsupportedClaimIds":[],"reasons":[]}'
    ]
    return {
      text:
        outputs[this.calls - 1] ??
        '{"sections":[{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方大致上可以獲得不錯的機會。","evidenceIds":["E1"]}]}]}',
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

  check('Harness 依序執行具體後果審查、寫作與語意審查', provider.calls === 3)
  check('回答以中文呈現且含證據引用', result.finalText.includes('[E1]'))
  check('回答先說最佳著法目的', result.finalText.includes('最佳著法想做什麼'))
  check('回答解釋錯失機會與對手利用', result.finalText.includes('你的著法錯失什麼') && result.finalText.includes('對手如何利用'))
  check('回答包含後續主線與具體盤面後果', result.finalText.includes('黑方多完成一步部署'))
  check('正文不以評估差距或可信度作為理由', !result.finalText.includes('評估差距') && !result.finalText.includes('可信度'))
  check('只在查證區顯示引擎原始分數', result.finalText.includes('原始分數：score cp 42'))
  check('回答使用你問我答格式', result.finalText.includes('AI 答：'))
  check('證據保留引擎名稱與中文主線', result.evidence[0]?.engineName === 'Test Engine')
  check('完成紀錄不保存 API key', !JSON.stringify(traces).includes('not-stored-in-trace'))
  check('完成狀態寫入本機 trace', traces[0]?.status === 'completed')
  check(
    '一般棋理補充獨立成區塊並標示未經引擎驗證',
    result.finalText.includes('### 一般棋理補充（教練常識，未經引擎驗證）')
  )
  check(
    '一般棋理補充保留寫作者提供的原則句',
    result.finalText.includes('一般而言，先出正馬再補中炮')
  )

  const stagnationProvider = new StagnationProvider()
  const progressEvents: Array<Omit<HarnessProgressPayload, 'requestId'>> = []
  let continuationRequests = 0
  const stagnationResult = await runExplanationHarness(
    {
      requestId: 'ai-request-stagnation',
      analysisId: session.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 1,
        maxModelCalls: 4,
        maxOutputTokens: 8000
      }
    },
    {
      provider: stagnationProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => ({
          analyzePosition: async (
            _input: unknown,
            _config: unknown,
            options?: {
              onProgress?: (value: {
                phase: 'root_analysis'
                elapsedMs: number
                targetMs: number
                depth: number
                score: ReturnType<typeof convertCpScore>
                displayMove: string
                displayPrincipalVariation: string[]
              }) => void
            }
          ) => {
            options?.onProgress?.({
              phase: 'root_analysis',
              elapsedMs: 25,
              targetMs: 30,
              depth: 14,
              score: convertCpScore(42, 'score cp 42'),
              displayMove: '炮二平五',
              displayPrincipalVariation: ['炮二平五', '馬8進7']
            })
            await new Promise((resolve) => setTimeout(resolve, 30))
            return analysis()
          }
        })
      } as never,
      traceStore: { save: () => undefined } as never,
      signal: new AbortController().signal,
      onProgress: (payload) => progressEvents.push(payload),
      waitForContinuation: async () => {
        continuationRequests++
      },
      timing: {
        progressDelayMs: 0,
        progressIntervalMs: 5,
        stagnationMs: 0,
        minResearchRoundMs: 20,
        maxResearchRoundMs: 30
      }
    }
  )
  check('超過門檻後持續回報深度與目前主線', progressEvents.some((item) => item.depth === 14 && (item.displayPrincipalVariation?.length ?? 0) > 0))
  check('相同深度與變例停滯時要求使用者決定', continuationRequests === 1)
  check('使用者選擇繼續後可完成兩項具體後果', stagnationResult.finalText.includes('黑方左右馬已連續完成部署'))

  const ambiguousProvider = new FakeProvider()
  const noMoveEngineAnalysis: EngineAnalysis = {
    ...analysis(),
    userMove: undefined,
    displayUserMove: undefined,
    scoreAfterUserMove: null,
    evaluationAfterUserMove: null,
    userMoveEvaluationSource: 'unavailable',
    userMovePrincipalVariation: undefined,
    displayUserMovePrincipalVariation: undefined
  }
  const noMoveSession: AnalysisSession = {
    ...session,
    analysisId: 'analysis-no-move',
    engineAnalysis: noMoveEngineAnalysis,
    moveComparison: compareMove(noMoveEngineAnalysis)
  }
  const ambiguous = await runExplanationHarness(
    {
      requestId: 'ai-request-2',
      analysisId: noMoveSession.analysisId,
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
      session: noMoveSession,
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

  console.log('\n## 驗證器：具體詞彙、著法連結與欄位重複')

  const validatorEvidence: HarnessEvidence[] = [
    {
      id: 'E1',
      engineId: 'engine-1',
      engineName: 'Test Engine',
      purpose: '初始主引擎分析',
      positionFen: START_FEN,
      depth: 12,
      score: null,
      displayPrincipalVariation: ['炮二平五', '馬8進7'],
      analysis: engineAnalysis
    }
  ]
  const makeFinding = (
    overrides: Partial<ConsequenceFinding>
  ): ConsequenceFinding => ({
    id: 'K1',
    category: 'initiative_loss',
    summary: '馬八進七讓炮二平五延後，紅方中路控制慢一拍。',
    opponentUse: '黑方以馬8進7搶先出子。',
    boardImpact: '等紅方補走炮二平五時，黑方已先完成一步部署。',
    supportingMoves: ['馬八進七', '馬8進7', '炮二平五'],
    evidenceIds: ['E1'],
    verified: true,
    ...overrides
  })
  const goodSecondFinding = makeFinding({
    id: 'K2',
    category: 'opponent_development',
    summary: '黑方獲得先出子的時間差。',
    opponentUse: '黑方馬8進7後可從容再出另一翼馬。',
    boardImpact: '等紅方炮二平五時，黑方部署已領先一步。',
    supportingMoves: ['馬8進7', '炮二平五']
  })
  const makeAudit = (consequences: ConsequenceFinding[]): ConsequenceAudit => ({
    bestMovePurpose: '炮二平五立即控制中路並保留先手。',
    userMoveProblem: '馬八進七先出子，錯過立即控制中路的機會。',
    consequences,
    contradictions: [],
    enoughEvidence: true
  })

  const baselineErrors = validateConsequenceAudit(
    makeAudit([makeFinding({}), goodSecondFinding]),
    validatorEvidence,
    true
  )
  check('具體的後果審查可通過全部檢查', baselineErrors.length === 0, baselineErrors)

  const fatVagueErrors = validateConsequenceAudit(
    makeAudit([
      makeFinding({
        summary: '馬八進七之後紅方的整體節奏顯得緩慢，未來的機會逐漸流失。',
        opponentUse: '黑方馬8進7之後獲得更多的可能性與彈性。',
        boardImpact: '炮二平五補走之後，紅方各方面都變得不太理想。'
      }),
      goodSecondFinding
    ]),
    validatorEvidence,
    true
  )
  check(
    '灌水拉長但沒有具體象棋詞彙的敘述會被擋下',
    fatVagueErrors.some((error) => error.includes('具體象棋詞彙'))
  )

  const oneMoveErrors = validateConsequenceAudit(
    makeAudit([
      makeFinding({
        summary: '馬八進七讓紅方中路控制慢一拍。',
        opponentUse: '黑方藉機搶先出子。',
        boardImpact: '紅方之後被迫補中炮，部署落後。'
      }),
      goodSecondFinding
    ]),
    validatorEvidence,
    true
  )
  check(
    '正文只連回一步著法會被要求補到兩步',
    oneMoveErrors.some((error) => error.includes('至少兩步實際主線著法'))
  )

  const duplicatedText = '馬八進七與馬8進7交換次序後，紅方中路受制無法出車。'
  const duplicateErrors = validateConsequenceAudit(
    makeAudit([
      makeFinding({
        summary: duplicatedText,
        opponentUse: duplicatedText,
        boardImpact: duplicatedText
      }),
      goodSecondFinding
    ]),
    validatorEvidence,
    true
  )
  check(
    'summary/opponentUse/boardImpact 互相抄寫會被擋下',
    duplicateErrors.some((error) => error.includes('高度重複'))
  )

  const candidateLineErrors = validateConsequenceAudit(
    makeAudit([
      makeFinding({}),
      makeFinding({
        id: 'K3',
        category: 'piece_restriction',
        summary: '改走兵三進一雖然開通馬路，但讓黑方馬8進7搶先控制河口。',
        opponentUse: '黑方馬8進7後紅方馬路仍被壓制。',
        boardImpact: '紅方兵三進一後的部署比炮二平五慢。',
        supportingMoves: ['兵三進一', '馬8進7']
      })
    ]),
    validatorEvidence,
    true
  )
  check(
    '候選著法變例中的著法可以合法引用（不再誤判違規）',
    !candidateLineErrors.some((error) => error.includes('引擎主線中沒有的著法')),
    candidateLineErrors
  )

  const badNoteAnswer: HarnessAnswer = {
    mode: 'research',
    title: '測試',
    directAnswer: '目前引擎證據不足，無法確認。',
    directAnswerEvidenceIds: [],
    sections: [],
    generalNotes: ['這個原則已被引擎驗證，肯定成立 [E1]。'],
    evidence: [],
    warnings: []
  }
  const badNoteErrors = validateAnswer(badNoteAnswer, validatorEvidence, {
    hasUserMove: false,
    requiredHeadings: []
  })
  check(
    '一般棋理補充不得引用證據編號或聲稱經過引擎驗證',
    badNoteErrors.some((error) => error.includes('一般棋理補充不得'))
  )

  console.log('\n## 逾時、預算與證據簽章修正')

  // 使用者 120 秒內沒有回應「是否繼續」：不能整個失敗，要用現有證據自動收尾。
  const timeoutTraces: HarnessTrace[] = []
  let timeoutError: unknown = null
  let timeoutResult: Awaited<ReturnType<typeof runExplanationHarness>> | null = null
  try {
    timeoutResult = await runExplanationHarness(
      {
        requestId: 'ai-request-continuation-timeout',
        analysisId: session.analysisId,
        provider: 'openai',
        model: 'fake-model',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical',
        language: 'zh-TW',
        answerMode: 'research',
        budget: {
          engineTimeMs: 3000,
          maxEngineRounds: 1,
          maxModelCalls: 4,
          maxOutputTokens: 8000
        }
      },
      {
        provider: new FakeProvider(),
        apiKey: 'secret',
        model: 'fake-model',
        session,
        registry: {
          list: () => ({
            installations: [],
            activeEngineId: 'engine-1',
            verificationEngineId: null
          }),
          getAdapter: () => ({
            analyzePosition: async (
              _input: unknown,
              _config: unknown,
              options?: {
                onProgress?: (value: {
                  phase: 'root_analysis'
                  elapsedMs: number
                  targetMs: number
                  depth: number
                  score: ReturnType<typeof convertCpScore>
                  displayMove: string
                  displayPrincipalVariation: string[]
                }) => void
              }
            ) => {
              options?.onProgress?.({
                phase: 'root_analysis',
                elapsedMs: 5,
                targetMs: 10,
                depth: 14,
                score: convertCpScore(42, 'score cp 42'),
                displayMove: '炮二平五',
                displayPrincipalVariation: ['炮二平五', '馬8進7']
              })
              await new Promise((resolve) => setTimeout(resolve, 5))
              return analysis()
            }
          })
        } as never,
        traceStore: { save: (trace: HarnessTrace) => timeoutTraces.push(trace) } as never,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        // 永遠不 resolve：模擬使用者在時限內完全沒有回應「是否繼續」。
        waitForContinuation: () => new Promise<void>(() => undefined),
        timing: {
          progressDelayMs: 0,
          progressIntervalMs: 5,
          stagnationMs: 0,
          minResearchRoundMs: 10,
          maxResearchRoundMs: 20,
          continuationTimeoutMs: 20
        }
      }
    )
  } catch (error) {
    timeoutError = error
  }
  check('等待使用者決定逾時後不會讓整個請求失敗', timeoutError === null, timeoutError)
  check(
    '逾時後仍回傳完整分析而非要求澄清',
    Boolean(timeoutResult && !timeoutResult.clarificationRequired)
  )
  check(
    '逾時保守版分析明確承認證據有限，而非空泛帶過',
    Boolean(timeoutResult?.finalText.includes('證據不足'))
  )
  check(
    '逾時保守版分析不以分數高低作為理由',
    Boolean(timeoutResult && !/分數(較高|較低|比較高|比較低)/.test(timeoutResult.finalText))
  )
  check('逾時後完成狀態仍寫入 completed（不是 failed）', timeoutTraces[0]?.status === 'completed')
  check(
    '逾時後 trace 有記錄最終文字供未來評測使用',
    Boolean(timeoutTraces[0]?.finalText && timeoutTraces[0].finalText.length > 0)
  )

  // 引擎重跑後 depth／主線都沒變，但分數有實質變化：不應被誤判為「停滯」而打斷使用者。
  let scoreSignatureContinuationRequests = 0
  const scoreSignatureResult = await runExplanationHarness(
    {
      requestId: 'ai-request-score-signature',
      analysisId: session.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 1,
        maxModelCalls: 4,
        maxOutputTokens: 8000
      }
    },
    {
      provider: new FakeProvider(),
      apiKey: 'secret',
      model: 'fake-model',
      session,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => ({
          analyzePosition: async (): Promise<EngineAnalysis> => ({
            ...analysis(),
            scoreAfterBestMove: convertCpScore(88, 'score cp 88'),
            evaluationAfterBestMove: 0.88
          })
        })
      } as never,
      traceStore: { save: () => undefined } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      waitForContinuation: async () => {
        scoreSignatureContinuationRequests++
      },
      timing: {
        progressDelayMs: 0,
        progressIntervalMs: 5,
        stagnationMs: 0,
        minResearchRoundMs: 10,
        maxResearchRoundMs: 20
      }
    }
  )
  check(
    '深度與主線不變但分數變化時，不應被誤判為停滯',
    scoreSignatureContinuationRequests === 0
  )
  check(
    '分數變化情境仍能正常完成分析',
    scoreSignatureResult.finalText.includes('最佳著法想做什麼')
  )

  // 具體後果審查與規劃都成功，但預算只夠這兩次呼叫；寫作階段撞到上限時要走保守版問答，不能讓整個請求失敗。
  const writerBudgetProvider = new WriterBudgetProvider()
  const writerBudgetTraces: HarnessTrace[] = []
  let writerBudgetError: unknown = null
  let writerBudgetResult: Awaited<ReturnType<typeof runExplanationHarness>> | null = null
  try {
    writerBudgetResult = await runExplanationHarness(
      {
        requestId: 'ai-request-writer-budget',
        analysisId: session.analysisId,
        provider: 'openai',
        model: 'fake-model',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical',
        language: 'zh-TW',
        answerMode: 'research',
        followUpQuestion: '請完整解釋這個局面和我的著法錯在哪裡',
        budget: {
          engineTimeMs: 3000,
          maxEngineRounds: 1,
          maxModelCalls: 1,
          maxOutputTokens: 4000
        }
      },
      {
        provider: writerBudgetProvider,
        apiKey: 'secret',
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
        traceStore: { save: (trace: HarnessTrace) => writerBudgetTraces.push(trace) } as never,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        waitForContinuation: async () => undefined
      }
    )
  } catch (error) {
    writerBudgetError = error
  }
  check('寫作階段撞到模型呼叫上限時不會讓整個請求失敗', writerBudgetError === null, writerBudgetError)
  check(
    '撞到上限前只用掉規劃與具體後果審查兩次呼叫，沒有嘗試呼叫寫作模型',
    writerBudgetProvider.calls === 2
  )
  check(
    '撞到上限後改用引擎資料產生保守版問答',
    Boolean(
      writerBudgetResult?.finalText.includes(
        'AI 結構化回答未通過驗證，已改用引擎資料產生保守版問答'
      )
    )
  )
  check(
    '保守版問答仍具體引用真實對手利用方式，不是空泛帶過',
    Boolean(writerBudgetResult?.finalText.includes('黑方以馬8進7順利完成出子'))
  )
  check(
    '保守版問答仍具體引用真實盤面後果',
    Boolean(
      writerBudgetResult?.finalText.includes(
        '紅方補走炮二平五後中路計畫延後，黑方陣形更完整'
      )
    )
  )
  check('撞到上限後完成狀態仍寫入 completed', writerBudgetTraces[0]?.status === 'completed')

  console.log('\n## 品質修正迴圈（loop engineering）')

  // 一個區塊空泛：迴圈應「只重寫該區塊」，其餘區塊原樣保留。
  const rewriteProvider = new RewriteLoopProvider()
  const rewriteProgress: Array<Omit<HarnessProgressPayload, 'requestId'>> = []
  const rewriteResult = await runExplanationHarness(
    {
      requestId: 'ai-request-rewrite-loop',
      analysisId: session.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 1,
        maxModelCalls: 8,
        maxOutputTokens: 8000
      }
    },
    {
      provider: rewriteProvider,
      apiKey: 'secret',
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
      traceStore: { save: () => undefined } as never,
      signal: new AbortController().signal,
      onProgress: (payload) => rewriteProgress.push(payload)
    }
  )
  check(
    '空泛的對手利用區塊會觸發第 4 次呼叫（分段重寫）',
    rewriteProvider.calls === 4,
    rewriteProvider.calls
  )
  const rewritePrompt = rewriteProvider.prompts[3] ?? ''
  check('重寫提示明確標示是局部重寫', rewritePrompt.includes('只重寫下列區塊'))
  check('重寫提示指向失敗的「對手如何利用」區塊', rewritePrompt.includes('對手如何利用'))
  check(
    '重寫提示不包含未失敗區塊的原文（不是整篇重生）',
    !rewritePrompt.includes('先問是否有需要立即爭取的中路或先手機會')
  )
  check(
    '重寫後的區塊取代原本空泛內容',
    rewriteResult.finalText.includes('黑方以馬8進7搶先出子，再馬2進3完成兩翼部署') &&
      !rewriteResult.finalText.includes('黑方大致上可以獲得不錯的機會')
  )
  check(
    '未失敗區塊在重寫後原樣保留',
    rewriteResult.finalText.includes(
      '馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3'
    )
  )
  check(
    '重寫成功後不落入保守版問答',
    !rewriteResult.finalText.includes('保守版問答')
  )
  check(
    '迴圈進度回報「正在重寫」與輪數',
    rewriteProgress.some(
      (item) => item.phase === 'repairing' && item.message.includes('第 1/2 輪修正')
    )
  )
  check(
    '通過後回報「已通過品質檢查」',
    rewriteProgress.some(
      (item) =>
        item.phase === 'quality_check' && item.message.includes('已通過品質檢查')
    )
  )

  // 每輪重寫都一樣空泛：用滿輪數後必須收斂到保守版，不能無限重試。
  const stubbornProvider = new StubbornVagueProvider()
  const stubbornTraces: HarnessTrace[] = []
  const stubbornResult = await runExplanationHarness(
    {
      requestId: 'ai-request-stubborn-vague',
      analysisId: session.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 1,
        maxModelCalls: 8,
        maxOutputTokens: 8000
      }
    },
    {
      provider: stubbornProvider,
      apiKey: 'secret',
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
      traceStore: { save: (trace: HarnessTrace) => stubbornTraces.push(trace) } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }
  )
  check(
    '重寫兩輪仍空泛 → 恰好用掉 5 次呼叫（不無限重試）',
    stubbornProvider.calls === 5,
    stubbornProvider.calls
  )
  check(
    '超過修正輪數上限後改用保守版問答',
    stubbornResult.finalText.includes('保守版問答')
  )
  check(
    '保守版問答仍保留已驗證的具體後果',
    stubbornResult.finalText.includes('黑方以馬8進7順利完成出子')
  )
  check(
    'trace 記錄達到修正上限的原因',
    (stubbornTraces[0]?.validationErrors ?? []).some((error) =>
      error.includes('修正上限')
    )
  )

  console.log(`結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exitCode = 1
}

void main()
