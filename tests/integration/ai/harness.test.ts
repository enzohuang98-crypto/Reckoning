import type { AIProvider } from '../../../src/shared/types/AIProviderTypes'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'
import Ajv from 'ajv'
import { buildInitialMoveResponseSchema } from '../../../src/main/ai/InitialMoveResponseSchema'
import type { EngineAnalysis } from '../../../src/shared/types/EngineAnalysis'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { convertCpScore } from '../../../src/main/engine/EngineOutputParser'
import { compareMove } from '../../../src/shared/logic/analysis/MoveComparisonService'
import { buildDualEngineComparison } from '../../../src/shared/logic/analysis/DualEngineComparison'
import { buildExplanationPrompt } from '../../../src/main/ai/promptBuilder'
import {
  countHanCharacters,
  playerFacingAnswerText
} from '../../../src/shared/logic/ai/ExplanationQualityScorer'
import {
  HarnessExplanationUnavailableError,
  runExplanationHarness as runPreparedExplanationHarness,
  type HarnessRuntimeDependencies,
  validateAnswer,
  validateConsequenceAudit
} from '../../../src/main/ai/HarnessOrchestrator'
import { prepareExplanationExecution } from '../../../src/main/ai/prepareExplanationExecution'
import { buildVariationBoardFacts } from '../../../src/main/ai/VariationBoardFacts'
import { AIHttpError, AIResponseValidationError } from '../../../src/main/ai/http'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'
import { TeacherTestRunService } from '../../../src/main/teacherTest/TeacherTestRunService'
import { getTeacherTestCatalog } from '../../../src/main/teacherTest/TeacherTestCatalog'
import playOkAcceptanceCases from '../../fixtures/playok/acceptance-cases.json'
import type { GenerateExplanationStartPayload } from '../../../src/shared/types/ipc'
import type {
  ConsequenceAudit,
  ConsequenceFinding
} from '../../../src/main/ai/HarnessOrchestrator'
import type { AnalysisSession } from '../../../src/main/storage/AnalysisSessionStore'
import { HarnessTraceStore } from '../../../src/main/storage/HarnessTraceStore'
import type {
  HarnessAnswer,
  HarnessEvidence,
  HarnessTrace
} from '../../../src/shared/types/Harness'
import {
  HARNESS_SECTION_IDS,
  INITIAL_MOVE_EXPLANATION_SECTION_IDS
} from '../../../src/shared/types/Harness'
import type { HarnessProgressPayload } from '../../../src/shared/types/Harness'

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

const inactiveTeacherRun = new TeacherTestRunService({
  getRuntime: () => ({
    appVersion: '0.3.11',
    platform: 'win32',
    systemVersion: '10.0.22631',
    osBuild: 'Windows 11 10.0.22631',
    arch: 'x64'
  })
})

type LegacyHarnessDependencies = HarnessRuntimeDependencies & {
  model: string
  session: AnalysisSession
}

async function runExplanationHarness(
  payload: GenerateExplanationStartPayload,
  deps: LegacyHarnessDependencies
) {
  const { model, session: analysisSession, ...runtimeDeps } = deps
  return runPreparedExplanationHarness(
    prepareExplanationExecution(payload, analysisSession, model, inactiveTeacherRun),
    runtimeDeps
  )
}

const DEEP_INITIAL_EXPLANATION_EXTENSION =
  '沿著實戰主線逐步看，馬八進七先出子後，黑方以馬8進7發展右翼馬；紅方到下一回合才補炮二平五，中炮壓到中線的時間因此延後。黑方接著馬2進3，另一匹馬也取得自然發展，兩翼馬在紅方只完成中炮部署時已經就位。這個差別不是抽象的分數高低，而是走子次序讓黑方多得到一個完整出子節奏；紅方原本可用炮二平五先限制中卒並迫使黑方先處理中路，實戰卻讓黑方按照馬8進7、馬2進3連續改善子力。後續判斷時要比較中炮壓力是否仍能限制黑方出車與中卒活動，也要檢查紅方補走炮二平五後是否還保有主動進攻的速度。若黑方已從容完成雙馬部署，紅方往後每一步都要同時顧及中路與兩翼，原先可直接建立的先手壓力便轉成追趕部署。'

function combineAuditAndAnswer(
  auditJson: string,
  answerJson: string,
  ensureCompleteDepth = true
): string {
  const answer = JSON.parse(answerJson) as HarnessAnswer
  if (ensureCompleteDepth) {
    const consequence = answer.sections.find(
      (section) =>
        section.id === HARNESS_SECTION_IDS.opponentExploitation ||
        section.heading.includes('後續主線')
    )
    const claim = consequence?.claims.at(-1)
    if (claim) claim.text = `${claim.text}${DEEP_INITIAL_EXPLANATION_EXTENSION}`
  }
  return JSON.stringify({
    audit: JSON.parse(auditJson),
    answer
  })
}

const NO_USER_REQUIRED_SECTION_IDS = [
  HARNESS_SECTION_IDS.directConclusion,
  HARNESS_SECTION_IDS.bestMovePlan,
  HARNESS_SECTION_IDS.opponentExploitation,
  HARNESS_SECTION_IDS.practicalPrinciple
]

class FakeProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake'
  calls = 0
  prompts: string[] = []
  requestedMaxTokens: number[] = []

  constructor(private readonly ensureCompleteDepth = true) {}

  async generateExplanation(request: { prompt: string; maxOutputTokens?: number }) {
    this.calls++
    this.prompts.push(request.prompt)
    this.requestedMaxTokens.push(request.maxOutputTokens ?? -1)
    const outputs = [
      '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E2"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E2"],"verified":true}],"contradictions":[],"enoughEvidence":true}',
      '{"mode":"research","title":"你問我答：著法分析","directAnswer":"馬八進七先走，錯過炮二平五立即控制中路的機會；黑方可趁機完成兩翼馬的部署，使紅方之後補走中炮時已失去先手。","directAnswerEvidenceIds":["E2"],"sections":[{"heading":"問：最佳著法想做什麼？","claims":[{"id":"C1","text":"炮二平五立即控制中路並保留先手。","evidenceIds":["E2"]}]},{"heading":"問：你的著法錯失什麼？","claims":[{"id":"C2","text":"馬八進七先出子，錯過立即控制中路的時機。","evidenceIds":["E2"],"causal":{"cause":"因為先走馬八進七而不是炮二平五","mechanism":"開局第一時間的中路壓制被推遲","affected":"紅方中炮與中路攻勢","opponentUse":"黑方趁機馬8進7完成出子","consequence":"紅方補走炮二平五時黑方已多完成一步部署"}}]},{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方以馬8進7和馬2進3完成兩翼馬部署。","evidenceIds":["E2"],"causal":{"cause":"因為馬八進七沒有立即施壓","mechanism":"黑方獲得連續出子的節奏，完成兩翼部署","affected":"黑方雙馬與整體陣形","opponentUse":"黑方接連走馬8進7與馬2進3","consequence":"黑方陣形完整，紅方中路計畫慢一拍"}}]},{"heading":"問：後續主線與具體後果是什麼？","claims":[{"id":"C4","text":"馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3；結果是紅方中路計畫延後，黑方多完成一步部署。","evidenceIds":["E2"],"causal":{"cause":"因為馬八進七後黑方馬8進7","mechanism":"紅方在這條主線第三手才補炮二平五控制中路","affected":"紅方中路與先手節奏","opponentUse":"黑方再走馬2進3補齊另一翼","consequence":"黑方多完成一步部署，紅方攻勢延後"}}]},{"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[{"id":"C5","text":"炮二平五先控制中路；馬八進七則讓黑方先完成出子，之後紅方仍要補走中炮。","evidenceIds":["E2"],"causal":{"cause":"因為炮二平五與馬八進七的次序互換","mechanism":"中路控制與出子節奏易手","affected":"紅方先手與黑方陣形","opponentUse":"黑方按馬8進7、馬2進3從容應對","consequence":"紅方需要多花一手補回中炮，黑方部署領先"}}]},{"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[{"id":"C6","text":"先問是否有需要立即爭取的中路或先手機會，再檢查普通出子是否會讓對手從容部署。","evidenceIds":["E2"]}]}],"generalNotes":["一般而言，先出正馬再補中炮，容易讓對手搶先完成部署。"],"warnings":[]}',
      '{"unsupportedClaimIds":[],"reasons":[]}'
    ]
    const scopedEvidenceId = [
      ...request.prompt.matchAll(/"id":"(E\d+)"/g)
    ].at(-1)?.[1] ?? 'E2'
    return {
      text:
        this.calls === 1
          ? combineAuditAndAnswer(
              outputs[0].replaceAll('"E2"', `"${scopedEvidenceId}"`),
              outputs[1].replaceAll('"E2"', `"${scopedEvidenceId}"`),
              this.ensureCompleteDepth
            )
          : outputs[2] ?? '{}',
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

class SameMoveProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake same-move provider'
  calls = 0
  prompt = ''

  async generateExplanation(request: { prompt: string }) {
    this.calls += 1
    this.prompt = request.prompt
    const causal = {
      cause: '因為炮二平五先把二路炮移到中路',
      mechanism: '中炮立即形成中線控制並限制黑方中卒活動',
      affected: '紅方中炮、黑方中卒與雙方中央線路',
      opponentUse: '黑方可走馬8進7發展右翼馬並協助中路防守',
      consequence: '紅方接著馬八進七時仍可協調雙馬與中炮的部署'
    }
    const longNeutralText =
      '炮二平五後，黑方可用馬8進7自然發展右翼馬；紅方再走馬八進七，既補出正馬，也讓中炮與馬彼此照應。接著黑方馬2進3發展另一翼，這條主線顯示雙方都在開局原則內改善子力，也是目前可見的一條合理應對。紅方這步的實際價值，是第一時間把炮移到中線，直接關注中卒與中央通道，同時保留兩翼馬依局勢出動的彈性。黑方以馬8進7應對後，中卒多一層防守，右翼馬也靠近中心；紅方用馬八進七延續部署，之後可以再判斷是加強中路、準備出車，或先處理黑方的反擊。沿著炮二平五、馬8進7、馬八進七、馬2進3的次序觀察，雙方每一步都能連回具體棋子與線路：紅方先建立中炮，黑方補馬守中，紅方再出正馬，黑方完成另一翼發展。這些是目前主線能直接支持的盤面事實；更遠的攻勢是否成立，仍要看後續引擎變例，不能把可發生的計畫寫成已經確定的結果。實戰理解上，炮二平五不是因為名稱或候選排名而值得採用，而是它在這個起始局面先處理中央控制，再讓後續子力圍繞中炮協調。面對馬8進7，紅方仍需觀察黑方中卒、兩翼馬與出車節奏，不能因為第一步正確就假定後續自動取得優勢。每走一步都應重新核對當前局面與可見主線，這樣才能把正確開局選擇轉化為後續可執行的計畫。'
    return {
      text: JSON.stringify({
        audit: {
          bestMovePurpose: '炮二平五立即建立中炮，控制中線並關注黑方中卒。',
          userMoveProblem: '實戰的炮二平五與引擎首選一致，具體價值是立即控制中路。',
          consequences: [
            {
              id: 'K1',
              category: 'central_control',
              summary: '炮二平五建立中炮，馬8進7協助黑方守中。',
              opponentUse: '黑方以馬8進7發展右翼馬並協防中卒。',
              boardImpact: '炮二平五與馬8進7走完後，雙方子力圍繞中線展開。',
              supportingMoves: ['炮二平五', '馬8進7'],
              evidenceIds: ['E1'],
              verified: true
            },
            {
              id: 'K2',
              category: 'piece_development',
              summary: '炮二平五先控制中路，黑方馬8進7完成自然出子。',
              opponentUse: '黑方走馬8進7後，以右翼馬增加中央防守。',
              boardImpact: '中炮與右翼馬在中線形成可見的攻防關係。',
              supportingMoves: ['炮二平五', '馬8進7'],
              evidenceIds: ['E1'],
              verified: true
            }
          ],
          contradictions: [],
          enoughEvidence: true
        },
        answer: {
          mode: 'research',
          title: '實戰著法解析',
          directAnswer: '炮二平五與引擎首選一致；這步立即建立中炮，黑方可用馬8進7合理應對。',
          directAnswerEvidenceIds: ['E1'],
          sections: [
            { id: HARNESS_SECTION_IDS.directConclusion, heading: '直接結論', claims: [{ id: 'S1', text: '炮二平五就是引擎首選，兩者是同一著法。', evidenceIds: ['E1'] }] },
            { id: HARNESS_SECTION_IDS.actualMoveProblem, heading: '與首選一致', claims: [{ id: 'S2', text: '實戰的炮二平五與首選一致，能立即建立中炮並控制中路。', evidenceIds: ['E1'], findingIds: ['K1'], causal }] },
            { id: HARNESS_SECTION_IDS.bestMovePlan, heading: '這步的好處', claims: [{ id: 'S3', text: '炮二平五把炮移到中線，關注中卒並保留馬八進七的協調發展。', evidenceIds: ['E1'] }] },
            { id: HARNESS_SECTION_IDS.opponentExploitation, heading: '對手合理應對', claims: [{ id: 'S4', text: longNeutralText, evidenceIds: ['E1'], findingIds: ['K1', 'K2'], causal }] },
            { id: HARNESS_SECTION_IDS.practicalPrinciple, heading: '實戰原則', claims: [{ id: 'S5', text: '著法與首選一致時，應理解它改善哪條線，以及對手有哪些合理回應。', evidenceIds: ['E1'] }] }
          ],
          generalNotes: [],
          warnings: []
        }
      }),
      provider: this.id,
      model: 'fake-model',
      createdAt: Date.now(),
      groundedOnEngineData: true as const,
      usage: { inputTokens: 10, outputTokens: 800 }
    }
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

class MutatedSameMoveProvider extends SameMoveProvider {
  constructor(private readonly mutate: (answer: HarnessAnswer) => void) { super() }

  async generateExplanation(request: { prompt: string }) {
    const response = await super.generateExplanation(request)
    const combined = JSON.parse(response.text) as { answer: HarnessAnswer }
    this.mutate(combined.answer)
    return { ...response, text: JSON.stringify(combined) }
  }
}

class TransientRetryProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake transient retry provider'
  attempts = 0
  private readonly delegate = new FakeProvider()

  async generateExplanation(request: { prompt: string }) {
    this.attempts += 1
    if (this.attempts === 1) {
      throw new Error('OpenAI-compatible API 錯誤 (503)：temporarily unavailable')
    }
    return this.delegate.generateExplanation(request)
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

class LateTransientProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake late transient provider'
  attempts = 0

  async generateExplanation() {
    this.attempts += 1
    await new Promise((resolve) => setTimeout(resolve, 30))
    throw new Error('OpenAI-compatible API 錯誤 (503)：temporarily unavailable')
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

/** 具體後果審查器成功，但預算只夠這一次呼叫，寫作階段會撞到上限。 */
class WriterBudgetProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake writer-budget provider'
  calls = 0

  async generateExplanation() {
    this.calls++
    const outputs = [
      '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E1"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E1"],"verified":true}],"contradictions":[],"enoughEvidence":true}'
    ]
    return {
      text: JSON.stringify({ audit: JSON.parse(outputs[0]), answer: {} }),
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
  '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E2"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E2"],"verified":true}],"contradictions":[],"enoughEvidence":true}'

const NO_USER_MOVE_AUDIT_JSON = JSON.stringify({
  bestMovePurpose: '炮二平五立即把中炮移到中路，瞄準中卒並建立中線壓力。',
  userMoveProblem: '',
  consequences: [
    {
      id: 'K1',
      category: 'opponent_development',
      summary: '炮二平五先把中炮移到中路，直接瞄準中卒並建立中線壓力。',
      opponentUse: '黑方以馬8進7發展右翼馬，同時增加中卒防守並準備出車。',
      boardImpact: '炮二平五與馬8進7交換後，紅方中炮控制中線，黑方右翼馬也完成部署。',
      supportingMoves: ['炮二平五', '馬8進7'],
      evidenceIds: ['E1'],
      verified: true
    },
    {
      id: 'K2',
      category: 'piece_restriction',
      summary: '炮二平五控制中線後，黑方中卒的活動空間受到中炮牽制。',
      opponentUse: '馬8進7讓右翼馬靠近中路，協助中卒並準備化解中炮壓力。',
      boardImpact: '炮二平五、馬8進7走完後，雙方子力圍繞中卒形成後續攻防。',
      supportingMoves: ['炮二平五', '馬8進7'],
      evidenceIds: ['E1'],
      verified: true
    }
  ],
  contradictions: [],
  enoughEvidence: true
})

const NO_USER_MOVE_WRITER_JSON = JSON.stringify({
  mode: 'research',
  title: '你問我答：目前局面分析',
  directAnswer:
    '目前局面應先看炮二平五的中路控制；黑方以馬8進7發展右翼馬，之後進入中線與子力部署的攻防。',
  directAnswerEvidenceIds: ['E1'],
  sections: [
    {
      heading: '問：最佳著法想做什麼？',
      claims: [
        {
          id: 'C1',
          text: '炮二平五把二路炮平到中路，直接瞄準中卒並建立中線壓力。',
          evidenceIds: ['E1']
        }
      ]
    },
    {
      heading: '問：後續主線與具體後果是什麼？',
      claims: [
        {
          id: 'C2',
          text: '炮二平五先形成中炮控制，黑方接著馬8進7發展右翼馬並協防中卒；走完這兩步後，雙方子力圍繞中線展開後續攻防。',
          evidenceIds: ['E1'],
          findingIds: ['K1', 'K2'],
          causal: {
            cause: '炮二平五先把中炮移入中路',
            mechanism: '中炮沿中線瞄準中卒並建立壓力',
            affected: '黑方中卒與右翼馬的防守關係',
            opponentUse: '黑方以馬8進7發展右翼馬並協防中卒',
            consequence: '雙方子力圍繞中線形成後續攻防'
          }
        }
      ]
    },
    {
      heading: '問：下次遇到類似局面要先問自己什麼？',
      claims: [
        {
          id: 'C3',
          text: '先確認中線與王區的直接威脅，再看最佳著法能否改善子力並限制對手部署。',
          evidenceIds: ['E1']
        }
      ]
    }
  ],
  generalNotes: [],
  warnings: []
})

class NoUserMoveProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake no-user-move provider'
  calls = 0
  prompts: string[] = []
  responseFormats: Array<'text' | 'json' | undefined> = []

  async generateExplanation(request: {
    prompt: string
    responseFormat?: 'text' | 'json'
  }) {
    this.calls++
    this.prompts.push(request.prompt)
    this.responseFormats.push(request.responseFormat)
    const outputs = [
      `\`\`\`json\n${NO_USER_MOVE_AUDIT_JSON}\n\`\`\``,
      `[${NO_USER_MOVE_WRITER_JSON}]`
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

class NearTargetProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake near-target provider'
  calls = 0
  private readonly delegate = new FakeProvider(false)

  async generateExplanation(request: { prompt: string }) {
    this.calls += 1
    const response = await this.delegate.generateExplanation(request)
    const combined = JSON.parse(response.text) as {
      audit: ConsequenceAudit
      answer: HarnessAnswer
    }
    const consequence = combined.answer.sections.find(
      (section) =>
        section.id === HARNESS_SECTION_IDS.opponentExploitation ||
        section.heading.includes('後續主線')
    )
    const claim = consequence?.claims.at(-1)
    if (claim) {
      const grounding = DEEP_INITIAL_EXPLANATION_EXTENSION
      let index = 0
      while (
        countHanCharacters(playerFacingAnswerText(combined.answer)) < 450 &&
        index < grounding.length
      ) {
        claim.text += grounding[index]
        index += 1
      }
      claim.text += '。'
    }
    return { ...response, text: JSON.stringify(combined) }
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

class PermanentProviderErrorProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake permanent provider error'
  calls = 0

  async generateExplanation(): Promise<never> {
    this.calls += 1
    throw new Error('OpenAI-compatible API 錯誤 (401)：unauthorized')
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

class RateLimitedProvider implements AIProvider {
  readonly id = 'gemini' as const
  readonly displayName = 'Fake rate-limited Gemini provider'
  calls = 0

  async generateExplanation(): Promise<never> {
    this.calls += 1
    throw new Error(
      'Gemini API 錯誤 (429)：RESOURCE_EXHAUSTED rate limit exceeded'
    )
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

class HangingInitialProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake hanging initial provider'
  calls = 0

  async generateExplanation(_request: unknown, signal?: AbortSignal): Promise<never> {
    this.calls += 1
    return new Promise<never>((_resolve, reject) => {
      const abort = (): void => reject(new DOMException('aborted', 'AbortError'))
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

const EN_NO_USER_MOVE_AUDIT_JSON = JSON.stringify({
  bestMovePurpose:
    '炮二平五 moves the cannon to the central file, pressures the central pawn, and establishes central control.',
  userMoveProblem: '',
  consequences: [
    {
      id: 'K1',
      category: 'opponent_development',
      summary:
        'After 炮二平五 occupies the central file, 馬8進7 develops the right horse to contest the center.',
      opponentUse:
        'Black answers 炮二平五 with 馬8進7, adding the horse as a defender of the central pawn.',
      boardImpact:
        'The central cannon and the developed horse create direct pressure around the central pawn.',
      supportingMoves: ['炮二平五', '馬8進7'],
      evidenceIds: ['E1'],
      verified: true
    },
    {
      id: 'K2',
      category: 'piece_restriction',
      summary:
        '炮二平五 pins attention to the central file, while 馬8進7 brings a horse closer to that fight.',
      opponentUse:
        'After 炮二平五, Black uses 馬8進7 to reinforce the central pawn and prepare development.',
      boardImpact:
        'The cannon line and horse defense leave both sides contesting the center with developed pieces.',
      supportingMoves: ['炮二平五', '馬8進7'],
      evidenceIds: ['E1'],
      verified: true
    }
  ],
  contradictions: [],
  enoughEvidence: true
})

const EN_NO_USER_MOVE_WRITER_JSON = JSON.stringify({
  mode: 'research',
  title: 'Q&A: Current Position Analysis',
  directAnswer:
    'The current position calls for 炮二平五 to place the cannon on the central file; after 馬8進7, both sides contest the central pawn and continue developing.',
  directAnswerEvidenceIds: ['E1'],
  sections: [
    {
      heading: '問：最佳著法想做什麼？',
      claims: [
        {
          id: 'C1',
          text: '炮二平五 places the cannon on the central file and pressures the central pawn.',
          evidenceIds: ['E1']
        }
      ]
    },
    {
      heading: '問：後續主線與具體後果是什麼？',
      claims: [
        {
          id: 'C2',
          text: 'After 炮二平五 takes the central file, Black plays 馬8進7 to develop the right horse and defend the central pawn; the result is a direct central contest.',
          evidenceIds: ['E1'],
          findingIds: ['K1', 'K2']
        }
      ]
    },
    {
      heading: '問：下次遇到類似局面要先問自己什麼？',
      claims: [
        {
          id: 'C3',
          text: "Check immediate threats, the central file, and the opponent's strongest continuation before choosing a plan.",
          evidenceIds: ['E1']
        }
      ]
    }
  ],
  generalNotes: [],
  warnings: []
})

const ZH_CN_NO_USER_MOVE_AUDIT_JSON = JSON.stringify({
  bestMovePurpose: '炮二平五把中炮移到中路，瞄准中卒并建立中线压力。',
  userMoveProblem: '',
  consequences: [
    {
      id: 'K1',
      category: 'opponent_development',
      summary: '炮二平五先控制中路，馬8進7随后发展右翼马并协防中卒。',
      opponentUse: '黑方用馬8進7回应炮二平五，让右翼马靠近中线并保护中卒。',
      boardImpact: '中炮与右翼马围绕中卒形成直接攻防，双方子力继续向中路集中。',
      supportingMoves: ['炮二平五', '馬8進7'],
      evidenceIds: ['E1'],
      verified: true
    },
    {
      id: 'K2',
      category: 'piece_restriction',
      summary: '炮二平五牵制中卒，馬8進7则增加中路防守并准备出车。',
      opponentUse: '炮二平五之后，黑方以馬8進7协防中卒并改善右翼马的位置。',
      boardImpact: '中炮的炮线与右翼马的防守关系使中线成为后续争夺重点。',
      supportingMoves: ['炮二平五', '馬8進7'],
      evidenceIds: ['E1'],
      verified: true
    }
  ],
  contradictions: [],
  enoughEvidence: true
})

const ZH_CN_NO_USER_MOVE_WRITER_JSON = JSON.stringify({
  mode: 'research',
  title: '问答：当前局面分析',
  directAnswer:
    '当前局面应先看炮二平五的中路控制；黑方以馬8進7发展右翼马，之后双方围绕中卒继续攻防。',
  directAnswerEvidenceIds: ['E1'],
  sections: [
    {
      heading: '問：最佳著法想做什麼？',
      claims: [
        {
          id: 'C1',
          text: '炮二平五把中炮移到中路，直接瞄准中卒并建立中线压力。',
          evidenceIds: ['E1']
        }
      ]
    },
    {
      heading: '問：後續主線與具體後果是什麼？',
      claims: [
        {
          id: 'C2',
          text: '炮二平五先控制中路，黑方随后走馬8進7发展右翼马并协防中卒，因此双方子力继续围绕中线展开攻防。',
          evidenceIds: ['E1'],
          findingIds: ['K1', 'K2']
        }
      ]
    },
    {
      heading: '問：下次遇到類似局面要先問自己什麼？',
      claims: [
        {
          id: 'C3',
          text: '先检查中线与王区的直接威胁，再沿着对手最强回应查看后续变化。',
          evidenceIds: ['E1']
        }
      ]
    }
  ],
  generalNotes: [],
  warnings: []
})

class LocalizedNoUserMoveProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake localized no-user-move provider'
  calls = 0

  constructor(private readonly outputs: string[]) {}

  async generateExplanation() {
    this.calls++
    return {
      text: this.outputs[this.calls - 1] ?? '{}',
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

const FOLLOW_UP_WRITER_JSON = JSON.stringify({
  mode: 'research',
  title: '你問我答：繼續追問',
  directAnswer:
    '最需要注意三點：第一，炮二平五後要注意黑方馬8進7對中路的補強；第二，後續主線應檢查雙方子力活動與王區安全；第三，不要只看原始分數，要沿著實際著法確認盤面變化。',
  directAnswerEvidenceIds: ['E1'],
  sections: [
    {
      heading: '問：追問',
      claims: [
        {
          id: 'FQ1',
          text: '炮二平五、馬8進7的後續主線顯示中路與子力活動是目前最需要檢查的盤面因素。',
          evidenceIds: ['E1']
        }
      ]
    }
  ],
  generalNotes: [],
  warnings: []
})

const EN_FOLLOW_UP_WRITER_JSON = JSON.stringify({
  mode: 'research',
  title: 'Q&A: Follow-up',
  directAnswer:
    'First, 炮二平五 establishes central pressure; Second, 馬8進7 reinforces the central defense; Third, follow the engine line to compare piece activity and king safety.',
  directAnswerEvidenceIds: ['E1'],
  sections: [
    {
      heading: '問：追問',
      claims: [
        {
          id: 'FQ1',
          text: '炮二平五 and 馬8進7 show that central pressure, piece activity, and king safety are the concrete factors to verify.',
          evidenceIds: ['E1']
        }
      ]
    }
  ],
  generalNotes: [],
  warnings: []
})

class FollowUpProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake follow-up provider'
  constructor(private readonly output = JSON.stringify(FOLLOW_UP_WRITER_JSON)) {}
  calls = 0
  prompts: string[] = []
  requestedMaxTokens: number[] = []

  async generateExplanation(request: {
    prompt: string
    maxOutputTokens?: number
  }) {
    this.calls++
    this.prompts.push(request.prompt)
    this.requestedMaxTokens.push(request.maxOutputTokens ?? -1)
    return {
      // JSON-mode services sometimes double-encode the requested object.
      text: this.output,
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

class OutputTokenBoundaryProvider implements AIProvider {
  readonly id = 'openai' as const
  readonly displayName = 'Fake output-token-boundary provider'
  calls = 0
  requestedMaxTokens: number[] = []

  async generateExplanation(request: {
    prompt: string
    maxOutputTokens?: number
  }) {
    this.calls++
    this.requestedMaxTokens.push(request.maxOutputTokens ?? -1)
    return {
      text:
        this.calls === 1
          ? combineAuditAndAnswer(GOOD_AUDIT_JSON, VAGUE_OPPONENT_WRITER_JSON)
          : '{}',
      provider: this.id,
      model: 'fake-model',
      createdAt: Date.now(),
      groundedOnEngineData: true as const,
      usage: {
        inputTokens: 10,
        outputTokens: this.calls === 1 ? 24 : 1
      }
    }
  }

  async *generateExplanationStream(): AsyncIterable<never> {
    return
  }
}

/** 寫作者輸出一個空泛的「對手如何利用」區塊，其餘皆合格；修正迴圈應只重寫該區塊。 */
const VAGUE_OPPONENT_WRITER_JSON =
  '{"mode":"research","title":"你問我答：著法分析","directAnswer":"馬八進七先走，錯過炮二平五立即控制中路的機會；黑方可趁機完成兩翼馬的部署，使紅方之後補走中炮時已失去先手。","directAnswerEvidenceIds":["E2"],"sections":[{"heading":"問：最佳著法想做什麼？","claims":[{"id":"C1","text":"炮二平五立即控制中路並保留先手。","evidenceIds":["E2"]}]},{"heading":"問：你的著法錯失什麼？","claims":[{"id":"C2","text":"馬八進七先出子，錯過立即控制中路的時機。","evidenceIds":["E2"],"causal":{"cause":"因為先走馬八進七而不是炮二平五","mechanism":"開局第一時間的中路壓制被推遲","affected":"紅方中炮與中路攻勢","opponentUse":"黑方趁機馬8進7完成出子","consequence":"紅方補走炮二平五時黑方已多完成一步部署"}}]},{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方大致上可以獲得不錯的機會。","evidenceIds":["E2"]}]},{"heading":"問：後續主線與具體後果是什麼？","claims":[{"id":"C4","text":"馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3；結果是紅方中路計畫延後，黑方多完成一步部署。","evidenceIds":["E2"],"causal":{"cause":"因為馬八進七後黑方馬8進7","mechanism":"紅方在這條主線第三手才補炮二平五控制中路","affected":"紅方中路與先手節奏","opponentUse":"黑方再走馬2進3補齊另一翼","consequence":"黑方多完成一步部署，紅方攻勢延後"}}]},{"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[{"id":"C5","text":"炮二平五先控制中路；馬八進七則讓黑方先完成出子，之後紅方仍要補走中炮。","evidenceIds":["E2"],"causal":{"cause":"因為炮二平五與馬八進七的次序互換","mechanism":"中路控制與出子節奏易手","affected":"紅方先手與黑方陣形","opponentUse":"黑方按馬8進7、馬2進3從容應對","consequence":"紅方需要多花一手補回中炮，黑方部署領先"}}]},{"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[{"id":"C6","text":"先問是否有需要立即爭取的中路或先手機會，再檢查普通出子是否會讓對手從容部署。","evidenceIds":["E2"]}]}],"generalNotes":[],"warnings":[]}'

const FIXED_OPPONENT_SECTION_JSON = JSON.stringify({
  sections: [
    {
      id: HARNESS_SECTION_IDS.opponentExploitation,
      heading: '對手利用與後果',
      claims: [
        {
          id: 'C3',
          text: `黑方以馬8進7搶先出子，再馬2進3完成兩翼部署。${DEEP_INITIAL_EXPLANATION_EXTENSION}`,
            evidenceIds: ['E2'],
          causal: {
            cause: '因為馬八進七沒有立即施壓',
            mechanism: '黑方獲得連續出子的節奏，完成兩翼部署',
            affected: '黑方雙馬與整體陣形',
            opponentUse: '黑方接連走馬8進7與馬2進3',
            consequence: '黑方陣形完整，紅方中路計畫慢一拍'
          }
        }
      ]
    }
  ]
})

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
      FIXED_OPPONENT_SECTION_JSON
    ]
    return {
      text:
        this.calls === 1
          ? combineAuditAndAnswer(outputs[0], outputs[1])
          : outputs[2] ?? '{}',
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
      VAGUE_OPPONENT_WRITER_JSON
    ]
    return {
      text:
        this.calls === 1
          ? combineAuditAndAnswer(outputs[0], outputs[1])
          :
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
  const boardFactEvidence = (moves: string[], display: string[], fen = START_FEN): HarnessEvidence => ({
    id: 'facts-fixture', engineId: 'engine-1', engineName: 'Fixture', purpose: 'Board facts',
    positionFen: fen, depth: 12, score: null, displayPrincipalVariation: display,
    analysis: { ...engineAnalysis, positionFen: fen, principalVariation: moves }
  })
  const legalFacts = buildVariationBoardFacts(boardFactEvidence(
    ['h2e2', 'h9g7'], ['炮二平五', '馬8進7']
  ))
  check('逐手棋盤事實由正確方別計算炮的路數與對手應手',
    legalFacts.warning === null && legalFacts.steps.length === 2 &&
      legalFacts.steps[0]?.side === 'red' && legalFacts.steps[0]?.fromFile === 2 &&
      legalFacts.steps[0]?.toFile === 5 && legalFacts.steps[0]?.captured === null &&
      legalFacts.steps[1]?.side === 'black' && legalFacts.steps[1]?.piece === 'horse')
  const captureCheckFacts = buildVariationBoardFacts(boardFactEvidence(
    ['a1a9'], ['車九進八'], 'p3k4/9/9/9/4p4/9/9/9/R8/4K4 w - - 0 1'
  ))
  check('吃子與將軍從走後棋盤計算，沒有沿用模型 verified 欄位',
    captureCheckFacts.warning === null && captureCheckFacts.steps[0]?.captured?.side === 'black' &&
      captureCheckFacts.steps[0]?.captured?.piece === 'pawn' && captureCheckFacts.steps[0]?.givesCheck === true)
  const wrongSideFacts = buildVariationBoardFacts(boardFactEvidence(['h9g7'], ['馬8進7']))
  check('輪走方錯誤的主線不產生棋盤事實',
    wrongSideFacts.steps.length === 0 && wrongSideFacts.warning !== null)
  const otherVariationFacts = buildVariationBoardFacts(boardFactEvidence(['h2e2'], ['馬八進七']))
  check('中文著法與另一條變例混用時不替它提供棋盤背書',
    otherVariationFacts.steps.length === 0 && otherVariationFacts.warning !== null)
  const invalidContinuationFacts = buildVariationBoardFacts(boardFactEvidence(
    ['h2e2', 'h0g2'], ['炮二平五', '馬二進三']
  ))
  check('無效後續只保留合法前綴的事實，不推測後面走法',
    invalidContinuationFacts.steps.length === 1 && invalidContinuationFacts.warning !== null)
  console.log('\n## AI 解說 Harness')
  const traces: HarnessTrace[] = []
  const provider = new FakeProvider()
  const initialProgressEvents: HarnessProgressPayload[] = []
  const explanationPrompt = buildExplanationPrompt({
    engineAnalysis: session.engineAnalysis,
    moveComparison: session.moveComparison,
    userLevel: 'intermediate',
    explanationStyle: 'long_analytical',
    language: 'en',
    conversationHistory: [
      {
        id: 'message-1',
        role: 'assistant',
        text: 'Previous coach context marker',
        createdAt: new Date().toISOString()
      }
    ],
    followUpQuestion: 'Why does that previous point matter?'
  })
  check('PromptBuilder 實際納入目標語言', explanationPrompt.includes('English'))
  check('共用提示的短追問仍提供必需棋規，不依問題有沒有規則關鍵字',
    ['象眼', '馬腿', '炮架', '將帥', '不能後退'].every(rule => explanationPrompt.includes(rule)))
  check('PromptBuilder 實際納入既有對話', explanationPrompt.includes('Previous coach context marker'))
  check('精準追問上下文不要求長篇或固定完整課程',
    !/長篇、仔細|500–900|逐點引用/.test(explanationPrompt) &&
    explanationPrompt.includes('Why does that previous point matter?'))
  const fullComparisonPrompt = buildExplanationPrompt({
    engineAnalysis: session.engineAnalysis, moveComparison: session.moveComparison,
    userLevel: 'intermediate', explanationStyle: 'long_analytical', language: 'zh-TW',
    followUpQuestion: '請完整說明這一步的作用與對手應對。', answerStrategy: 'move-comparison'
  })
  check('有問題的首次完整比較仍保留正文契約，不被誤分成短追問',
    fullComparisonPrompt.includes('500–900') && fullComparisonPrompt.includes('practical_principle') &&
    fullComparisonPrompt.includes('請完整說明這一步的作用與對手應對。'))
  check('共用完整比較與短追問使用同一份棋規基礎',
    ['象眼', '馬腿', '炮架', '將帥', '不能後退'].every(rule => fullComparisonPrompt.includes(rule)))
  const result = await runExplanationHarness(
    {
      requestId: 'ai-request-1',
      analysisId: session.analysisId,
      provider: 'openrouter',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      userMoveReason: '先出馬可以讓子力調度更靈活',
      answerMode: 'research',
      conversationHistory: [
        {
          id: 'message-1',
          role: 'assistant',
          text: 'Previous coach context marker',
          createdAt: new Date().toISOString()
        }
      ],
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
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
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
      onProgress: (event) => initialProgressEvents.push(event),
      explanationPrompt
    }
  )

  check('首次實戰步比較以一次結構化模型呼叫同時完成審查與寫作', provider.calls === 1)
  check('真正一鍵完整講解收到固定棋規、相關術語及逐線吃子摘要',
    ['象眼', '馬腿', '恰好一枚', '不能後退', '吃子摘要只涵蓋', '不得冒充引擎證據']
      .every(rule => provider.prompts[0]?.includes(rule)))
  check(
    '首次合併審查與五段正文提供足夠 JSON 輸出預算',
    provider.requestedMaxTokens[0] === 4_000,
    String(provider.requestedMaxTokens[0])
  )
  check(
    'trace 只保存安全的模型階段、預算、耗時與 token 診斷',
    traces.at(-1)?.modelCallDiagnostics?.length === 1 &&
      traces.at(-1)?.modelCallDiagnostics?.[0]?.stage === 'initial_combined' &&
      traces.at(-1)?.modelCallDiagnostics?.[0]?.maxOutputTokens === 4_000 &&
      traces.at(-1)?.modelCallDiagnostics?.[0]?.reasoningPolicy ===
        'reasoning_disabled' &&
      traces.at(-1)?.modelCallDiagnostics?.[0]?.status === 'completed' &&
      traces.at(-1)?.modelCallDiagnostics?.[0]?.outputTokens === 20
  )
  check(
    '首次實戰步 combined prompt 不重複 PromptBuilder 引擎資料與對話區塊',
    !provider.prompts[0]?.includes('【引擎分析數據】') &&
      !provider.prompts[0]?.includes('Previous coach context marker')
  )
  check(
    '首次比較 prompt 固定五個 section id、400 漢字下限並以 500–900 中文字為目標',
    provider.prompts[0]?.includes('direct_conclusion、actual_move_problem、best_move_plan、opponent_exploitation、practical_principle') &&
      provider.prompts[0]?.includes('不得少於 400 個漢字') &&
      provider.prompts[0]?.includes('500–900')
  )
  check(
    '首次比較 prompt 明確區分首選與實戰兩條主線且示意引用不誤導模型',
    provider.prompts[0]?.includes('E1 作 AI 首選主線、E2 作實戰步主線') &&
      provider.prompts[0]?.includes('"directAnswerEvidenceIds":["E1","E2"]') &&
      provider.prompts[0]?.includes('"evidenceIds":["E1","E2"]')
  )
  check('比較證據依角色隔離逐手事實，不重複另一份對手應手清單',
    provider.prompts[0]?.includes('"id":"E1","role":"best_move"') &&
      provider.prompts[0]?.includes('"id":"E2","role":"user_move"') &&
      provider.prompts[0]?.includes('"computedBoardFacts":{"steps":[') &&
      !provider.prompts[0]?.includes('"opponentReplies":'))
  check('首次正文把本手結果與走後機會分開表述，不投放易混淆的原始欄位',
    provider.prompts[0]?.includes('"actualCapture":"本手未吃子。"') &&
      provider.prompts[0]?.includes('"captureOpportunities":') &&
      !provider.prompts[0]?.includes('"captured":') &&
      !provider.prompts[0]?.includes('"movedPieceCaptureTargets":'))
  check(
    '完整正文提示不把第一段限制成摘要，先寫正文再填審查欄位',
    !provider.prompts[0]?.includes('與 directAnswer 相同的直接結論') &&
      (provider.prompts[0]?.indexOf('"answer":{') ?? -1) <
        (provider.prompts[0]?.indexOf('"audit":{') ?? -1)
  )
  check('實戰原則的示意引用涵蓋兩種著法，不預填成只能引用首選線',
    provider.prompts[0]?.includes('"id":"C5","text":"約70–100漢字的一條可操作原則，說明本局先檢查什麼、如何判斷與適用限制","evidenceIds":["E1","E2"]'))
  check(
    '首次比較 prompt 禁止把跨引擎分歧或主線外後續寫成確定事實',
    provider.prompts[0]?.includes('若兩個引擎的對手首應不同') &&
      provider.prompts[0]?.includes('主線未出現的後續不得寫成已經發生') &&
      provider.prompts[0]?.includes('避免「完全、全面、嚴重、必然」等誇大語氣')
  )
  check(
    '首次比較會把棋手原始想法當成待檢驗自述並使用精簡證據包',
    provider.prompts[0]?.includes('先出馬可以讓子力調度更靈活') &&
      provider.prompts[0]?.includes('不可信自述') &&
      !provider.prompts[0]?.includes('"candidates"') &&
      !provider.prompts[0]?.includes('"rawScore"') &&
      !provider.prompts[0]?.includes('本機術語知識') &&
      !provider.prompts[0]?.includes('"score":')
  )
  check(
    '只有主引擎時，進度與 prompt 不會虛構複核引擎',
    initialProgressEvents.some((event) =>
      event.message.includes('正在用既有主引擎快照')
    ) &&
      provider.prompts[0]?.includes('只使用下方既有主引擎快照') &&
      !initialProgressEvents.some((event) => event.message.includes('複核引擎')) &&
      !provider.prompts[0]?.includes('主引擎／複核引擎快照')
  )

  const sameMoveAnalysis: EngineAnalysis = {
    ...engineAnalysis,
    userMove: engineAnalysis.bestMove,
    displayUserMove: engineAnalysis.displayBestMove,
    scoreAfterUserMove: engineAnalysis.scoreAfterBestMove,
    evaluationAfterUserMove: engineAnalysis.evaluationAfterBestMove,
    userMovePrincipalVariation: ['h2e2', 'h9g7', 'b0c2', 'b9c7'],
    displayUserMovePrincipalVariation: ['炮二平五', '馬8進7', '馬八進七', '馬2進3'],
    principalVariation: ['h2e2', 'h9g7', 'b0c2', 'b9c7'],
    displayPrincipalVariation: ['炮二平五', '馬8進7', '馬八進七', '馬2進3']
  }
  const sameMoveSession: AnalysisSession = {
    ...session,
    analysisId: 'analysis-same-user-and-best-move',
    engineAnalysis: sameMoveAnalysis,
    moveComparison: compareMove(sameMoveAnalysis)
  }
  const dotsTraces: HarnessTrace[] = []
  const dotsProvider = new FakeProvider()
  await runExplanationHarness({
    requestId: 'dots-policy-trace', analysisId: session.analysisId,
    provider: 'openrouter', model: 'dots-studio/dots-3-note-preview:free',
    userLevel: 'intermediate', explanationStyle: 'long_analytical', language: 'zh-TW',
    userMoveReason: '先出馬可以讓子力調度更靈活', answerMode: 'research',
    budget: { engineTimeMs: 3000, maxEngineRounds: 3, maxModelCalls: 4, maxOutputTokens: 6000 }
  }, {
    provider: dotsProvider, apiKey: 'synthetic-trace-key', model: 'dots-studio/dots-3-note-preview:free', session,
    registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
    traceStore: { save: (trace: HarnessTrace) => dotsTraces.push(trace) } as never,
    signal: new AbortController().signal, onProgress: () => undefined, explanationPrompt
  })
  check('Dots 完整合格 fixture 通過正式 validator 且 trace 正確標示其獨立推理策略',
    dotsProvider.calls === 1 && dotsProvider.requestedMaxTokens[0] === 6000 &&
    dotsTraces.at(-1)?.modelCallDiagnostics?.[0]?.reasoningPolicy === 'reasoning_disabled' &&
    dotsTraces.at(-1)?.modelCallDiagnostics?.[0]?.stage === 'initial_combined')
  const qwenTraces: HarnessTrace[] = []
  const qwenProvider = new FakeProvider()
  await runExplanationHarness({
    requestId: 'qwen-policy-trace', analysisId: session.analysisId,
    provider: 'openrouter', model: 'qwen/qwen3.8-27b:free',
    userLevel: 'intermediate', explanationStyle: 'long_analytical', language: 'zh-TW',
    userMoveReason: '先出馬可以讓子力調度更靈活', answerMode: 'research',
    budget: { engineTimeMs: 3000, maxEngineRounds: 3, maxModelCalls: 4, maxOutputTokens: 6000 }
  }, {
    provider: qwenProvider, apiKey: 'synthetic-trace-key', model: 'qwen/qwen3.8-27b:free', session,
    registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
    traceStore: { save: (trace: HarnessTrace) => qwenTraces.push(trace) } as never,
    signal: new AbortController().signal, onProgress: () => undefined, explanationPrompt
  })
  check('Qwen 完整合格 fixture 的 trace 標示關閉可選推理而不冒稱固定推理 token 上限',
    qwenProvider.calls === 1 && qwenProvider.requestedMaxTokens[0] === 6000 &&
      qwenTraces.at(-1)?.modelCallDiagnostics?.[0]?.reasoningPolicy === 'reasoning_disabled' &&
      qwenTraces.at(-1)?.modelCallDiagnostics?.[0]?.stage === 'initial_combined')

  const sameMoveProvider = new SameMoveProvider()
  const sameMoveResult = await runExplanationHarness(
    {
      requestId: 'ai-request-same-user-and-best-move',
      analysisId: sameMoveSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      attachedMove: sameMoveAnalysis.userMove,
      userMoveReason: '想用中炮控制中央並取得主動',
      answerMode: 'research',
      budget: {
        engineTimeMs: 3_000,
        maxEngineRounds: 1,
        maxModelCalls: 2,
        maxOutputTokens: 4_000
      }
    },
    {
      provider: sameMoveProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: sameMoveSession,
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
      onProgress: () => undefined
    }
  )
  const runSameMoveVariant = (variant: AIProvider) => runExplanationHarness({
    requestId: 'ai-contract-root-cause', analysisId: sameMoveSession.analysisId,
    provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
    explanationStyle: 'long_analytical', language: 'zh-TW',
    attachedMove: sameMoveAnalysis.userMove, answerMode: 'research',
    budget: { engineTimeMs: 3_000, maxEngineRounds: 1, maxModelCalls: 2, maxOutputTokens: 4_000 }
  }, {
    provider: variant, apiKey: 'synthetic-test-key', model: 'fake-model', session: sameMoveSession,
    registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
    traceStore: { save: () => undefined } as never, signal: new AbortController().signal,
    onProgress: () => undefined
  })
  const inventedMoveProvider = new MutatedSameMoveProvider((answer) => {
    answer.sections[2]!.claims[0]!.text += '紅方車九平五吃掉黑方炮並將軍。'
  })
  let inventedMoveRejected = false
  try { await runSameMoveVariant(inventedMoveProvider) } catch (error) {
    inventedMoveRejected = error instanceof HarnessExplanationUnavailableError && error.reason === 'quality_validation_failed'
  }
  check('完整 Harness 不交付合法 ID 搭配主線外編造吃子與將軍', inventedMoveRejected)
  const deniedCriticismProvider = new MutatedSameMoveProvider((answer) => {
    answer.sections[1]!.claims[0]!.text += '這不是失誤，也沒有錯失機會。'
  })
  let deniedCriticismAccepted = false
  try {
    const accepted = await runSameMoveVariant(deniedCriticismProvider)
    deniedCriticismAccepted = accepted.finalText.includes('這不是失誤，也沒有錯失機會。')
  } catch { /* The assertion below records a rejection as failure. */ }
  check('同首選的正常否定評價通過 scorer 與完整 Harness', deniedCriticismAccepted)
  const mixedNotationProvider = new MutatedSameMoveProvider((answer) => {
    answer.directAnswer = answer.directAnswer.replaceAll('馬8進7', '馬8進七')
    for (const section of answer.sections) for (const claim of section.claims) {
      claim.text = claim.text.replaceAll('馬8進7', '馬8進七')
      if (claim.causal) for (const field of Object.keys(claim.causal) as Array<keyof typeof claim.causal>) {
        claim.causal[field] = claim.causal[field].replaceAll('馬8進7', '馬8進七')
      }
    }
  })
  const mixedNotationResult = await runSameMoveVariant(mixedNotationProvider)
  check('相同棋盤著法的目的數字字形差異能通過完整 Harness，正文不被改寫',
    mixedNotationResult.finalText.includes('馬8進七'))
  let hiddenMetadataPreservesLength = false
  const hiddenConsequencesProvider = new MutatedSameMoveProvider((answer) => {
    const opponent = answer.sections.find((section) => section.id === HARNESS_SECTION_IDS.opponentExploitation)!
    const bestPlan = answer.sections.find((section) => section.id === HARNESS_SECTION_IDS.bestMovePlan)!
    const originalHan = countHanCharacters(playerFacingAnswerText(answer))
    bestPlan.claims[0]!.text += opponent.claims[0]!.text
    opponent.claims[0]!.text = '黑方馬8進7發展。'
    hiddenMetadataPreservesLength = countHanCharacters(playerFacingAnswerText(answer)) >= originalHan
  })
  let hiddenConsequencesRejected = false
  try { await runSameMoveVariant(hiddenConsequencesProvider) } catch (error) {
    hiddenConsequencesRejected = error instanceof HarnessExplanationUnavailableError &&
      error.reason === 'quality_validation_failed'
  }
  check('完整 Harness 不讓 hidden causal/audit 補足缺少後果的可見段落',
    hiddenMetadataPreservesLength && hiddenConsequencesRejected)
  check(
    '實戰步等同首選時，prompt 明確禁止硬寫失誤且一次完成',
    sameMoveProvider.calls === 1 &&
      sameMoveProvider.prompt.includes('實戰步與引擎首選是同一著法') &&
      sameMoveProvider.prompt.includes('禁止硬寫錯失、失誤、較差、懲罰')
  )
  check(
    '同首選正文配額與 causal 範例不預設實戰步有問題或可被利用',
    !sameMoveProvider.prompt.includes('實戰步問題約') &&
      !sameMoveProvider.prompt.includes('"opponentUse":"對手實際利用"')
  )
  check(
    '正式完整比較提供各變例獨立計算的輪走方、吃子與將軍事實',
    sameMoveProvider.prompt.includes('"computedBoardFacts"') &&
      sameMoveProvider.prompt.includes('"move":"炮二平五","side":"red"') &&
      sameMoveProvider.prompt.includes('"move":"馬8進7","side":"black"') &&
      sameMoveProvider.prompt.includes('"actualCapture":"本手未吃子。","actualCheck":"本手未將軍。"')
  )
  check(
    '實戰步等同首選時保留五段 id 並改用正向顯示標題',
    sameMoveResult.finalText.includes('## 與首選一致') &&
      sameMoveResult.finalText.includes('## 這步的好處') &&
      sameMoveResult.finalText.includes('## 對手合理應對') &&
      !/(較差失誤|必然受到懲罰)/.test(sameMoveResult.finalText),
    sameMoveResult.finalText
  )
  check(
    '完整正文顯示第一段 claim，不以一句摘要丟掉完整結論',
    sameMoveResult.finalText.includes('炮二平五就是引擎首選，兩者是同一著法。')
  )

  const probeFollowUpPrompt = async (analysisSession: AnalysisSession): Promise<string> => {
    const prompts: string[] = []
    const probeProvider = {
      id: 'openai' as const,
      displayName: 'Audit prompt probe',
      generateExplanation: async (request: { prompt: string }): Promise<never> => {
        prompts.push(request.prompt)
        throw new Error('audit prompt captured')
      },
      async *generateExplanationStream(): AsyncIterable<never> { return }
    }
    try {
      await runExplanationHarness(
        {
          requestId: `follow-up-prompt-${analysisSession.analysisId}`,
          analysisId: analysisSession.analysisId,
          provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
          explanationStyle: 'long_analytical', language: 'zh-TW',
          attachedMove: analysisSession.engineAnalysis.userMove,
          followUpQuestion: '這一步與首選相比，後續主線怎麼走？',
          conversationHistory: [{
            id: 'previous-answer', role: 'assistant', text: '先前的完整講解。',
            createdAt: new Date().toISOString(), provider: 'openai', model: 'fake-model'
          }],
          reuseEvidence: true,
          budget: { engineTimeMs: 100, maxEngineRounds: 1, maxModelCalls: 1, maxOutputTokens: 4_000 }
        },
        {
          provider: probeProvider, apiKey: 'synthetic-test-key', model: 'fake-model',
          session: analysisSession,
          registry: {
            list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }),
            getAdapter: () => null
          } as never,
          traceStore: { save: () => undefined } as never,
          signal: new AbortController().signal, onProgress: () => undefined
        }
      )
    } catch {
      // The probe stops after capturing the first real model request.
    }
    return prompts[0] ?? ''
  }
  const sameMoveFollowUpPrompt = await probeFollowUpPrompt(sameMoveSession)
  check(
    '同首選的短追問提示使用正向主線，不要求證明失誤',
    sameMoveFollowUpPrompt.includes('實戰步與引擎首選是同一著法') &&
      sameMoveFollowUpPrompt.includes('只回答使用者這一次的問題') &&
      !sameMoveFollowUpPrompt.includes('這步為什麼不好、錯失什麼'),
    sameMoveFollowUpPrompt.slice(0, 400)
  )

  const insufficientSession: AnalysisSession = {
    ...session,
    analysisId: 'analysis-insufficient-comparison-evidence',
    moveComparison: {
      ...session.moveComparison,
      confidence: 'low',
      uncertaintyReasons: ['固定 fixture：比較可信度不足']
    }
  }
  const insufficientProvider = new FakeProvider()
  const insufficientTraces: HarnessTrace[] = []
  let insufficientError: unknown
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-insufficient-comparison-evidence',
        analysisId: insufficientSession.analysisId,
        provider: 'openai',
        model: 'fake-model',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical',
        language: 'zh-TW',
        attachedMove: insufficientSession.engineAnalysis.userMove,
        userMoveReason: '想先出馬改善子力',
        answerMode: 'research',
        budget: {
          engineTimeMs: 3_000,
          maxEngineRounds: 1,
          maxModelCalls: 2,
          maxOutputTokens: 4_000
        }
      },
      {
        provider: insufficientProvider,
        apiKey: 'secret',
        model: 'fake-model',
        session: insufficientSession,
        registry: {
          list: () => ({
            installations: [],
            activeEngineId: 'engine-1',
            verificationEngineId: null
          }),
          getAdapter: () => null
        } as never,
        traceStore: {
          save: (trace: HarnessTrace) => insufficientTraces.push(trace)
        } as never,
        signal: new AbortController().signal,
        onProgress: () => undefined
      }
    )
  } catch (error) {
    insufficientError = error
  }
  check(
    '比較證據不足 fixture 會要求中性回答並拒絕模型硬造錯失結論',
    insufficientProvider.prompts[0]?.includes('比較狀態：證據不足') === true &&
      insufficientError instanceof HarnessExplanationUnavailableError &&
      insufficientError.reason === 'quality_validation_failed' &&
      insufficientTraces.at(-1)?.status === 'failed' &&
      insufficientTraces.at(-1)?.finalText === undefined,
    JSON.stringify({
      promptMarkedInsufficient:
        insufficientProvider.prompts[0]?.includes('比較狀態：證據不足') === true,
      error:
        insufficientError instanceof HarnessExplanationUnavailableError
          ? insufficientError.reason
          : String(insufficientError),
      traceStatus: insufficientTraces.at(-1)?.status,
      hasFinalText: insufficientTraces.at(-1)?.finalText !== undefined
    })
  )
  const insufficientFollowUpPrompt = await probeFollowUpPrompt(insufficientSession)
  check(
    '中性審查範例提供兩種不同後果類型，不要求模型照抄重複類型',
    insufficientProvider.prompts[0]?.includes('"id":"K1","category":"central_control"') === true &&
      insufficientProvider.prompts[0]?.includes('"id":"K2","category":"piece_development"') === true
  )
  check(
    '比較分差不預填失先或讓對手獲利的原因，所有狀態都由實際主線選類型',
    !insufficientProvider.prompts[0]?.includes('"category":"initiative_loss"') &&
      !insufficientProvider.prompts[0]?.includes('"category":"opponent_development"') &&
      !provider.prompts[0]?.includes('"category":"initiative_loss"') &&
      provider.prompts[0]?.includes('分類只標示正文已描述的盤面影響') === true
  )
  check(
    '比較證據不足的短追問提示要求區分已知與未知',
    insufficientFollowUpPrompt.includes('分開寫目前可確定的主線與缺少的證據') &&
      insufficientFollowUpPrompt.includes('只回答使用者這一次的問題') &&
      !insufficientFollowUpPrompt.includes('這步為什麼不好、錯失什麼'),
    insufficientFollowUpPrompt.slice(0, 400)
  )

  const frozenCase = getTeacherTestCatalog().cases[0]
  const formalQuestionMarker = frozenCase.question
  const excludedHistoryMarker = 'GENERIC-PRELUDE-MARKER-DO-NOT-SEND'
  const formalFixture = playOkAcceptanceCases.cases[0]
  check('正式老師案例使用同一凍結局面與實戰步的真實引擎 fixture',
    formalFixture.preMoveFen === frozenCase.positionFen &&
      formalFixture.actualMove.uci === frozenCase.attachedMove)
  const formalBestScore = convertCpScore(formalFixture.primary.bestScore.cp!, 'score cp -1603')
  const formalUserScore = convertCpScore(formalFixture.primary.actualScore.cp!, 'score cp -1683', 'candidate_move')
  const formalAnalysis: EngineAnalysis = {
    positionFen: formalFixture.preMoveFen,
    sideToMove: 'black',
    userMove: formalFixture.actualMove.uci,
    displayUserMove: formalFixture.actualMove.chinese,
    bestMove: formalFixture.primary.bestMove.uci,
    displayBestMove: formalFixture.primary.bestMove.chinese,
    scoreAfterBestMove: formalBestScore,
    scoreAfterUserMove: formalUserScore,
    evaluationAfterBestMove: formalBestScore.comparableValue,
    evaluationAfterUserMove: formalUserScore.comparableValue,
    userMoveEvaluationSource: 'candidate_move',
    principalVariation: formalFixture.primary.bestLine.uci,
    displayPrincipalVariation: formalFixture.primary.bestLine.chinese,
    userMovePrincipalVariation: formalFixture.primary.actualLine.uci,
    displayUserMovePrincipalVariation: formalFixture.primary.actualLine.chinese,
    candidateMoves: [
      { move: formalFixture.primary.bestMove.uci, score: formalBestScore,
        evaluation: formalBestScore.comparableValue, depth: formalFixture.primary.depth,
        principalVariation: formalFixture.primary.bestLine.uci,
        displayPrincipalVariation: formalFixture.primary.bestLine.chinese },
      { move: formalFixture.actualMove.uci, score: formalUserScore,
        evaluation: formalUserScore.comparableValue, depth: formalFixture.primary.depth,
        principalVariation: formalFixture.primary.actualLine.uci,
        displayPrincipalVariation: formalFixture.primary.actualLine.chinese }
    ],
    depth: formalFixture.primary.depth,
    incomplete: formalFixture.primary.incomplete,
    warnings: formalFixture.primary.warnings,
    engineId: 'engine-1',
    engineName: formalFixture.primary.engineName
  }
  const formalCausal = {
    cause: '因為黑方先走士4進5，這條主線接著是紅方車一平五',
    mechanism: '紅車從一路轉至五路，黑車仍需要調整橫向位置',
    affected: '紅方車與黑方車所在的中路和橫向線路',
    opponentUse: '紅方以車一平五把車移至中央，再觀察黑車的位置',
    consequence: '黑方車7平4後，雙方車已分別位在五路與四路'
  }
  const formalSecondCausal = {
    cause: '因為士4進5後紅方車一平五，黑方續走車7平4',
    mechanism: '車的位置改變後，紅方用退馬調整另一個子力的位置',
    affected: '紅方馬、中央車與黑方四路車的部署',
    opponentUse: '紅方接著馬八退六，把馬從八路調回六路',
    consequence: '黑方象5進3後，紅馬與黑象都移到主線所列的新位置'
  }
  const formalAnswer: HarnessAnswer = {
    mode: frozenCase.mode,
    title: '實戰著法解析',
    directAnswer: '士4進5先調整士，車7平6則先移動黑車；問題在於兩條主線的子力次序不同。',
    directAnswerEvidenceIds: ['E1', 'E2'],
    sections: [
      { id: HARNESS_SECTION_IDS.directConclusion, heading: '直接結論', claims: [{ id: 'C1', evidenceIds: ['E1', 'E2'],
        text: '士4進5與車7平6的差別，是黑方先調整士還是先移動車。實戰線接著紅方車一平五，黑車再走車7平4；首選線則先有紅方兵四平三，黑方再調整士。這些是兩條主線的具體次序，問題不能只用評估數字解釋，也不能把某條線說成對手唯一的應法。' }] },
      { id: HARNESS_SECTION_IDS.actualMoveProblem, heading: '實戰步問題', claims: [{ id: 'C2', evidenceIds: ['E1', 'E2'], findingIds: ['K1'], causal: formalCausal,
        text: '士4進5的問題應從黑車的調整次序看，而不是把士的移動直接當成丟子的原因。實戰線先讓紅方車一平五，黑方才走車7平4，把車移向四路；車7平6這條首選線則先改變黑車位置，紅方以兵四平三回應，黑方下一步才補士。比較時要分清士、車與紅兵各在哪一步移動，不能將兩條線拼成同一串棋譜，更遠的得失仍需另外的主線支持。' }] },
      { id: HARNESS_SECTION_IDS.bestMovePlan, heading: 'AI 首選', claims: [{ id: 'C3', evidenceIds: ['E1'],
        text: '車7平6先把黑車從七路移到六路，主線中的紅方兵四平三隨後橫移過河兵。黑方接著士4進5調整士，紅方再車一平五，把車放到中央。再往下是黑方車6平2，說明這條主線中車還會繼續橫向轉移。理解這步時可以追蹤黑車所在的路數，以及紅兵和紅車如何逐步換位；這裡只解釋可見的子力位置，沒有自行補算攻殺，也沒有把單一回應當作必走。' }] },
      { id: HARNESS_SECTION_IDS.opponentExploitation, heading: '對手利用與後果', claims: [
        { id: 'C4a', evidenceIds: ['E2'], findingIds: ['K1'], causal: formalCausal,
          text: '士4進5後，紅方用車一平五將車從一路轉到中央，這是本條主線的合理應對。黑方車7平4再把車移到四路，因此雙方車的路數與原局面已經不同。閱讀後果時應核對這些可見的移動，區分紅車的中央位置與黑車的橫向調整；主線沒有在這幾步顯示直接吃子，不能額外宣稱已經得車或失車。' },
        { id: 'C4b', evidenceIds: ['E2'], findingIds: ['K2'], causal: formalSecondCausal,
          text: '車7平4之後，紅方接著馬八退六，將馬調回六路，再由黑方象5進3移象。這項後果關注馬與象的重新部署，與前面的雙車位置是不同面向。因為兩個子力都依主線改變位置，後續盤面應以新的馬、象位置繼續觀察；這不能直接推出強制戰術，也不能用一般殘局口訣替代本局已回傳的步序。' }
      ] },
      { id: HARNESS_SECTION_IDS.practicalPrinciple, heading: '實戰原則', claims: [{ id: 'C5', evidenceIds: ['E1', 'E2'],
        text: '比較士4進5與車7平6時，先逐步核對車、士及對手子力的換位次序，再檢查每條主線實際呈現的盤面關係；同一步士的調整出現在不同時機，不能只憑著法名稱判斷整條線的好壞。' }] }
    ],
    generalNotes: [], evidence: [], warnings: []
  }
  const formalAudit: ConsequenceAudit = {
    bestMovePurpose: '車7平6先調整黑車橫向位置，再觀察紅方兵與車的換位。',
    userMoveProblem: '士4進5先調整士，問題在於黑車與紅車的位置改變順序不同。',
    consequences: [
      { id: 'K1', category: 'central_control', summary: '士4進5後車一平五讓紅車移到中央，黑車稍後橫向調整。',
        opponentUse: formalCausal.opponentUse, boardImpact: formalCausal.consequence,
        supportingMoves: ['士4進5', '車一平五', '車7平4'], evidenceIds: ['E2'], verified: true },
      { id: 'K2', category: 'piece_development', summary: '車7平4後馬八退六與象5進3分別改變紅馬和黑象的位置。',
        opponentUse: formalSecondCausal.opponentUse, boardImpact: formalSecondCausal.consequence,
        supportingMoves: ['車7平4', '馬八退六', '象5進3'], evidenceIds: ['E2'], verified: true }
    ],
    contradictions: [], enoughEvidence: true
  }
  const formalProvider = {
    id: 'openai' as const, displayName: 'Frozen teacher fixture', prompts: [] as string[],
    async generateExplanation(request: { prompt: string }) {
      this.prompts.push(request.prompt)
      return { text: JSON.stringify({ audit: formalAudit, answer: formalAnswer }),
        provider: this.id, model: 'fake-model', createdAt: Date.now(),
        groundedOnEngineData: true as const, usage: { inputTokens: 10, outputTokens: 2000 } }
    },
    async *generateExplanationStream(): AsyncIterable<never> { return }
  }
  const formalSession: AnalysisSession = {
    ...session,
    positionFen: frozenCase.positionFen,
    userMove: frozenCase.attachedMove,
    engineAnalysis: formalAnalysis,
    moveComparison: compareMove(formalAnalysis)
  }
  const formalRun = {
    getActiveManifest: () => ({
      schemaVersion: 1 as const,
      testRunId: 'formal-run',
      startedAt: '2026-08-07T00:00:00.000Z',
      artifactClaim: {
        appVersion: '0.3.11',
        releaseTag: 'v0.3.11',
        productSourceCommit: 'a'.repeat(40),
        installerFileName: 'candidate.exe',
        installerSha256: 'b'.repeat(64)
      },
      runtime: {
        platform: 'win32' as const,
        systemVersion: '10.0.22631',
        osBuild: 'Windows 11 10.0.22631',
        arch: 'x64'
      }
    }),
    createEvaluationLink: () => ({
      schemaVersion: 1 as const,
      testRunId: 'formal-run',
      testCaseId: 'a'.repeat(64),
      canonicalizationVersion: 1 as const,
      externalReviewId: 'review-formal'
    })
  } satisfies Parameters<typeof prepareExplanationExecution>[3]
  const formalExecution = prepareExplanationExecution(
    {
      requestId: 'teacher-formal-characterization',
      analysisId: formalSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      followUpQuestion: formalQuestionMarker,
      attachedMove: frozenCase.attachedMove,
      answerMode: frozenCase.mode,
      conversationHistory: [
        {
          id: 'teacher-prelude',
          role: 'assistant',
          text: excludedHistoryMarker,
          createdAt: new Date().toISOString()
        }
      ],
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 3,
        maxModelCalls: 4,
        maxOutputTokens: 4000
      }
    },
    formalSession,
    'fake-model',
    formalRun
  )
  const formalTraces: HarnessTrace[] = []
  const formalResult = await runPreparedExplanationHarness(
    formalExecution,
    {
      provider: formalProvider,
      apiKey: 'not-stored-in-trace',
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => null
      } as never,
      traceStore: { save: (trace: HarnessTrace) => formalTraces.push(trace) } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      explanationPrompt: excludedHistoryMarker
    }
  )
  check(
    '正式案例固定問題進入真正的 answer-writing prompt',
    formalProvider.prompts.some((prompt) => prompt.includes(formalQuestionMarker))
  )
  check(
    '正式案例不把 prelude 或既有 history 送入任何 provider prompt',
    formalProvider.prompts.every((prompt) => !prompt.includes(excludedHistoryMarker))
  )
  check(
    '正式案例即使 history 清空仍保留完整五段 move-comparison contract',
    formalExecution.answerStrategy === 'formal-move-comparison' &&
      ['直接結論', '實戰步評價', 'AI 首選', '對手合理應對與後續', '實戰原則'].every((heading) =>
        formalResult.finalText.includes(`### ${heading}`)
      )
  )
  check(
    '正式案例成功輸出與 trace 都保留固定問題及 v2 execution metadata',
    formalResult.finalText.includes(formalQuestionMarker) &&
      formalTraces[0]?.question === formalQuestionMarker &&
      formalTraces[0]?.interactionKind === 'teacher-formal-case' &&
      formalTraces[0]?.executionSemanticsVersion === 2 &&
      formalTraces[0]?.teacherCaseSetId === 'teacher-test-cases-v1' &&
      formalTraces[0]?.teacherCaseKey === frozenCase.caseKey &&
      formalTraces[0]?.evaluation?.externalReviewId === 'review-formal'
  )

  let receivedInitialSchema = false
  const strictFixtureProvider: AIProvider = {
    id: 'openrouter', displayName: 'SYNTHETIC strict fixture provider',
    async generateExplanation(request: AIExplanationRequest) {
      receivedInitialSchema = request.responseSchema !== undefined
      const strictAnswer = {
        mode: formalAnswer.mode, title: formalAnswer.title,
        directAnswer: formalAnswer.directAnswer, directAnswerEvidenceIds: formalAnswer.directAnswerEvidenceIds,
        sections: formalAnswer.sections.map(section => ({ ...section,
          claims: section.claims.map(claim => ({ ...claim, findingIds: claim.findingIds ?? [], causal: claim.causal ?? null })) })),
        generalNotes: [], warnings: []
      }
      const strictAudit = { bestMovePurpose: formalAudit.bestMovePurpose, userMoveProblem: formalAudit.userMoveProblem,
        consequences: formalAudit.consequences.map((finding, index) => ({ id: finding.id,
          category: finding.category, claimId: index === 0 ? 'C4a' : 'C4b', verified: finding.verified })),
        contradictions: [], enoughEvidence: true }
      const combined = { answer: strictAnswer, audit: strictAudit }
      const validateSchema = new Ajv({ strict: true }).compile(buildInitialMoveResponseSchema('research', ['E1', 'E2']).schema)
      check('完整五段 JSON object fixture 符合本機欄位契約', validateSchema(combined), validateSchema.errors)
      return { text: JSON.stringify(combined), provider: this.id, model: request.model,
        createdAt: Date.now(), groundedOnEngineData: true, usage: { inputTokens: 10, outputTokens: 2000 } }
    },
    async *generateExplanationStream(): AsyncIterable<never> { return }
  }
  const strictFixtureResult = await runExplanationHarness({
    requestId: 'schema-formal-fixture', analysisId: formalSession.analysisId, provider: 'openrouter',
    model: 'nvidia/nemotron-3-super-120b-a12b:free', userLevel: 'intermediate', explanationStyle: 'long_analytical',
    language: 'zh-TW', answerMode: 'research', attachedMove: formalSession.userMove
  }, {
    provider: strictFixtureProvider, apiKey: 'synthetic-test-key',
    model: 'nvidia/nemotron-3-super-120b-a12b:free', session: formalSession,
    registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
    traceStore: { save: () => undefined } as never, signal: new AbortController().signal, onProgress: () => undefined
  })
  check('不強制 provider schema 的完整 JSON 仍通過正式 Harness／正文 validator',
    !receivedInitialSchema && strictFixtureResult.finalText.includes('士4進5') &&
      countHanCharacters(strictFixtureResult.finalText) >= 400)

  const nominalTraces: HarnessTrace[] = []
  const nominalCatalog = getTeacherTestCatalog()
  const nominalRun = {
    getActiveManifest: formalRun.getActiveManifest,
    createEvaluationLink: (input: {
      positionFen: string
      question?: string
      attachedMove?: string
      mode: 'focused' | 'research'
    }) => {
      const caseIndex = nominalCatalog.cases.findIndex(
        (item) =>
          item.positionFen === input.positionFen &&
          item.question === input.question &&
          item.attachedMove === input.attachedMove &&
          item.mode === input.mode
      )
      return caseIndex < 0
        ? undefined
        : {
            schemaVersion: 1 as const,
            testRunId: 'formal-run',
            testCaseId: String(caseIndex + 1).padStart(64, '0'),
            canonicalizationVersion: 1 as const,
            externalReviewId: `review-nominal-${caseIndex + 1}`
          }
    }
  } satisfies Parameters<typeof prepareExplanationExecution>[3]
  for (const [caseIndex, teacherCase] of nominalCatalog.cases.entries()) {
    const nominalFixture = playOkAcceptanceCases.cases.find((item) =>
      item.preMoveFen === teacherCase.positionFen && item.actualMove.uci === teacherCase.attachedMove
    )!
    const nominalBestScore = convertCpScore(nominalFixture.primary.bestScore.cp!, 'fixture best score')
    const nominalActualScore = convertCpScore(nominalFixture.primary.actualScore.cp!, 'fixture actual score', 'candidate_move')
    const nominalAnalysis: EngineAnalysis = {
      ...formalAnalysis,
      positionFen: nominalFixture.preMoveFen,
      userMove: nominalFixture.actualMove.uci,
      displayUserMove: nominalFixture.actualMove.chinese,
      bestMove: nominalFixture.primary.bestMove.uci,
      displayBestMove: nominalFixture.primary.bestMove.chinese,
      scoreAfterBestMove: nominalBestScore,
      scoreAfterUserMove: nominalActualScore,
      evaluationAfterBestMove: nominalBestScore.comparableValue,
      evaluationAfterUserMove: nominalActualScore.comparableValue,
      principalVariation: nominalFixture.primary.bestLine.uci,
      displayPrincipalVariation: nominalFixture.primary.bestLine.chinese,
      userMovePrincipalVariation: nominalFixture.primary.actualLine.uci,
      displayUserMovePrincipalVariation: nominalFixture.primary.actualLine.chinese,
      depth: nominalFixture.primary.depth,
      candidateMoves: [
        { move: nominalFixture.primary.bestMove.uci, score: nominalBestScore,
          evaluation: nominalBestScore.comparableValue, depth: nominalFixture.primary.depth,
          principalVariation: nominalFixture.primary.bestLine.uci,
          displayPrincipalVariation: nominalFixture.primary.bestLine.chinese },
        { move: nominalFixture.actualMove.uci, score: nominalActualScore,
          evaluation: nominalActualScore.comparableValue, depth: nominalFixture.primary.depth,
          principalVariation: nominalFixture.primary.actualLine.uci,
          displayPrincipalVariation: nominalFixture.primary.actualLine.chinese }
      ]
    }
    const [best, bestReply] = nominalFixture.primary.bestLine.chinese
    const [actual, reply, continuation, secondReply] = nominalFixture.primary.actualLine.chinese
    const nominalBoardFacts = buildVariationBoardFacts({
      id: 'E2', positionFen: nominalAnalysis.positionFen, engineId: 'engine-1',
      engineName: nominalAnalysis.engineName, purpose: 'Nominal actual line',
      depth: nominalAnalysis.depth, score: nominalActualScore,
      move: nominalAnalysis.userMove, displayMove: nominalAnalysis.displayUserMove,
      displayPrincipalVariation: nominalAnalysis.displayUserMovePrincipalVariation!,
      analysis: nominalAnalysis
    })
    const nominalFileStep = nominalBoardFacts.steps.slice(0, 4).find((step) =>
      step.toFile === 5 || step.toFile === 1 || step.toFile === 9
    )!
    const nominalFileFact = `${nominalFileStep.side === 'red' ? '紅方' : '黑方'}${nominalFileStep.move}把${nominalFileStep.fromFile}路棋子移到${nominalFileStep.toFile}路${nominalFileStep.toFile === 5 ? '中路' : '邊路'}。`
    const nominalCausal = {
      cause: `因為黑方先走${actual}，這條主線再由紅方${reply}回應`,
      mechanism: '雙方棋子依照這條變例換位，核對中路與其他線路時也須使用新位置',
      affected: '黑方實戰棋子與紅方回應棋子的路數和陣形',
      opponentUse: `紅方以${reply}調整子力，接著還有${secondReply}的移動`,
      consequence: `${continuation}之後雙方的棋子位置不同，應以新陣形繼續觀察`
    }
    const nominalSecondCausal = {
      cause: `因為${continuation}延續本線，下一個回合紅方${secondReply}`,
      mechanism: '後半段的子力換位需依照當時棋盤核對，不能沿用舊中路位置',
      affected: '雙方後續棋子的路數與陣形關係',
      opponentUse: `紅方的${secondReply}是這條主線下一個已提供的回應`,
      consequence: `${reply}與${secondReply}出現在不同回合，不能混為同一步的盤面`
    }
    const nominalAnswer: HarnessAnswer = {
      mode: teacherCase.mode, title: '實戰著法解析',
      directAnswer: `${actual}與${best}的問題應用各自真實主線比較，不能只看分數。`,
      directAnswerEvidenceIds: ['E1', 'E2'],
      sections: [
        { id: HARNESS_SECTION_IDS.directConclusion, heading: '直接結論', claims: [{ id: 'C1', evidenceIds: ['E1', 'E2'],
          text: `${actual}是本局實戰步，${best}是引擎首選，兩者須分開按原局面核對。實戰線中的紅方回應是${reply}，首選線則有${bestReply}。問題應從每一步棋子的移動與陣形變化理解，不能以候選排名代替原因，也不能把不同變例中的棋子位置拼成同一個盤面。` }] },
        { id: HARNESS_SECTION_IDS.actualMoveProblem, heading: '實戰步問題', claims: [{ id: 'C2', evidenceIds: ['E1', 'E2'], findingIds: ['K1'], causal: nominalCausal,
          text: `${actual}後紅方${reply}，而${best}這條線接著是紅方${bestReply}，兩種著法因此具有不同的具體步序。這裡的問題要逐步核對黑方先動哪個棋子、紅方如何回應，再看後續${continuation}與${secondReply}的換位。${nominalFileFact}可見主線提供的是子力位置的變化，不能自行添加沒有列出的吃子或攻殺，也不能把棋手想法當成引擎已證實的戰術。` }] },
        { id: HARNESS_SECTION_IDS.bestMovePlan, heading: 'AI 首選', claims: [{ id: 'C3', evidenceIds: ['E1'],
          text: `${best}先移動黑方棋子，紅方在這條主線以${bestReply}回應。閱讀首選計畫時，應從這兩步的實際棋子位置繼續看陣形，並確認每一步是誰走子。這條主線只顯示引擎提供的一組後續，不能據此宣稱其他回應都不合法，也不能假定更遠的中路、先手或王區後果已經確定。` }] },
        { id: HARNESS_SECTION_IDS.opponentExploitation, heading: '對手利用與後果', claims: [
          { id: 'C4a', evidenceIds: ['E2'], findingIds: ['K1'], causal: nominalCausal,
            text: `${actual}後紅方${reply}，接著黑方${continuation}，這些是實戰線的前三步。${nominalFileFact}因為雙方依序換位，應在每一步後重新核對棋子所在的路數與陣形關係。對手的合理應對由主線給出，不需要再補造另一手棋；現有步序也不能自動證明某個攻殺必定成立。` },
          { id: 'C4b', evidenceIds: ['E2'], findingIds: ['K2'], causal: nominalSecondCausal,
            text: `${continuation}後紅方還有${secondReply}，它與前面的${reply}是不同回合的移動。這項後果關注後續棋子重新部署，應在該回合的棋盤上核對相關路數，而非沿用最初的棋子位置。主線有提供的變化可以逐步說清楚，未提供的其他後續則保持未知，不能由一般棋理口訣替代。` }
        ] },
        { id: HARNESS_SECTION_IDS.practicalPrinciple, heading: '實戰原則', claims: [{ id: 'C5', evidenceIds: ['E1', 'E2'],
          text: `比較${actual}與${best}時，先區分兩條主線，再逐步核對棋子位置和輪走方；同一個著法出現在另一回合時，必須以當時盤面重新理解，不能用表面字樣替代本局的棋盤關係。` }] }
      ], generalNotes: [], evidence: [], warnings: []
    }
    const nominalAudit: ConsequenceAudit = {
      bestMovePurpose: `${best}先調整黑方棋子的位置，再以該線的紅方回應核對陣形。`,
      userMoveProblem: `${actual}與首選的問題應從各自的棋子換位次序觀察。`,
      consequences: [
        { id: 'K1', category: 'central_control', summary: `${actual}後${reply}再${continuation}，雙方棋子依這條主線換位。`,
          opponentUse: nominalCausal.opponentUse, boardImpact: `${nominalCausal.consequence}；核對中路時不能沿用舊棋盤。`,
          supportingMoves: [actual, reply, continuation], evidenceIds: ['E2'], verified: true },
        { id: 'K2', category: 'piece_development', summary: `${continuation}後${secondReply}延續子力的重新部署，需核對各回合位置。`,
          opponentUse: nominalSecondCausal.opponentUse, boardImpact: `${nominalSecondCausal.consequence}；中路關係也須按新盤面核對。`,
          supportingMoves: [continuation, secondReply], evidenceIds: ['E2'], verified: true }
      ], contradictions: [], enoughEvidence: true
    }
    const nominalSession: AnalysisSession = {
      ...session,
      analysisId: `nominal-analysis-${caseIndex + 1}`,
      positionFen: teacherCase.positionFen,
      userMove: teacherCase.attachedMove,
      engineAnalysis: nominalAnalysis,
      moveComparison: compareMove(nominalAnalysis)
    }
    const basePayload: GenerateExplanationStartPayload = {
      requestId: `nominal-prelude-${caseIndex + 1}`,
      analysisId: nominalSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      attachedMove: teacherCase.attachedMove,
      answerMode: teacherCase.mode,
      conversationHistory: []
    }
    const runNominal = async (
      execution: ReturnType<typeof prepareExplanationExecution>
    ): Promise<void> => {
      await runPreparedExplanationHarness(execution, {
        provider: {
          id: 'openai', displayName: 'Nominal frozen fixture',
          async generateExplanation() {
            return { text: JSON.stringify({ audit: nominalAudit, answer: nominalAnswer }),
              provider: 'openai', model: 'fake-model', createdAt: Date.now(),
              groundedOnEngineData: true, usage: { inputTokens: 10, outputTokens: 2000 } }
          },
          async *generateExplanationStream(): AsyncIterable<never> { return }
        },
        apiKey: 'not-stored-in-trace',
        registry: {
          list: () => ({
            installations: [],
            activeEngineId: 'engine-1',
            verificationEngineId: null
          }),
          getAdapter: () => null
        } as never,
        traceStore: { save: (trace: HarnessTrace) => nominalTraces.push(trace) } as never,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        explanationPrompt: ''
      })
    }
    await runNominal(
      prepareExplanationExecution(basePayload, nominalSession, 'fake-model', nominalRun)
    )
    await runNominal(
      prepareExplanationExecution(
        {
          ...basePayload,
          requestId: `nominal-formal-${caseIndex + 1}`,
          followUpQuestion: teacherCase.question,
          conversationHistory: [
            {
              id: `nominal-prelude-message-${caseIndex + 1}`,
              role: 'assistant',
              text: excludedHistoryMarker,
              createdAt: '2026-08-07T00:00:00.000Z'
            }
          ]
        },
        nominalSession,
        'fake-model',
        nominalRun
      )
    )
  }
  const nominalEvaluated = nominalTraces.filter((trace) => trace.evaluation)
  check(
    '六組 prelude → frozen case 只產生六筆 evaluated traces',
    nominalTraces.length === 12 &&
      nominalEvaluated.length === 6 &&
      new Set(nominalEvaluated.map((trace) => trace.evaluation?.testCaseId)).size === 6
  )
  check(
    '六筆 prelude traces 明確不帶 evaluation，六筆 formal traces 都標示 v2',
    nominalTraces.filter((trace) => trace.interactionKind === 'teacher-prelude').length === 6 &&
      nominalTraces
        .filter((trace) => trace.interactionKind === 'teacher-prelude')
        .every((trace) => trace.evaluation === undefined) &&
      nominalTraces.filter(
        (trace) =>
          trace.interactionKind === 'teacher-formal-case' &&
          trace.executionSemanticsVersion === 2
      ).length === 6
  )
  check('棋手正文不顯示證據編號', !result.finalText.includes('[E1]'))
  check('回答先顯示直接結論', result.finalText.indexOf('### 直接結論') < result.finalText.indexOf('### 實戰步評價'))
  check('回答使用五個具名內容區塊', ['直接結論', '實戰步評價', 'AI 首選', '對手合理應對與後續', '實戰原則'].every((heading) => result.finalText.includes(`### ${heading}`)))
  check(
    '首次實戰步 render 正好只有五個棋手標題且順序固定',
    (result.finalText.match(/^### .+$/gm) ?? []).join('|') ===
      [
        '### 直接結論',
        '### 實戰步評價',
        '### AI 首選',
        '### 對手合理應對與後續',
        '### 實戰原則'
      ].join('|')
  )
  check('回答包含後續主線與具體盤面後果', result.finalText.includes('黑方多完成一步部署'))
  check('正文不以評估差距或可信度作為理由', !result.finalText.includes('評估差距') && !result.finalText.includes('可信度'))
  check('棋手正文移除引擎原始分數', !result.finalText.includes('score cp 42') && !result.finalText.includes('原始分數'))
  check('回答不使用 AI 自問自答格式', !result.finalText.includes('你問我答') && !result.finalText.includes('問：'))
  check('證據保留引擎名稱與中文主線', result.evidence[0]?.engineName === 'Test Engine')
  check('完成紀錄不保存 API key', !JSON.stringify(traces).includes('not-stored-in-trace'))
  check('完成狀態寫入本機 trace', traces[0]?.status === 'completed')
  check(
    '完成 trace 保存請求、模型、語言、歷史訊息數與耗時 metadata',
    traces[0]?.requestId === 'ai-request-1' &&
      traces[0]?.analysisId === session.analysisId &&
      traces[0]?.provider === 'openrouter' &&
      traces[0]?.model === 'nvidia/nemotron-3-super-120b-a12b:free' &&
      traces[0]?.language === 'zh-TW' &&
      traces[0]?.historyMessageCount === 1 &&
      typeof traces[0]?.durationMs === 'number' &&
      (traces[0]?.durationMs ?? -1) >= 0
  )
  const legacyTrace: HarnessTrace = {
    id: 'legacy-trace-without-metadata',
    createdAt: new Date().toISOString(),
    positionFen: START_FEN,
    mode: 'research',
    primaryEngineId: 'engine-1',
    phases: [],
    evidence: [],
    validationErrors: [],
    modelCalls: 0,
    engineRounds: 0,
    status: 'completed'
  }
  const legacyTraceStore = new HarnessTraceStore({
    read: () => [legacyTrace]
  } as never)
  check(
    '舊 trace 缺少新增 optional metadata 時仍可由 store 正常讀取',
    legacyTraceStore.list()[0]?.id === legacyTrace.id
  )
  check('首次實戰步正文只保留五個產品區塊', !result.finalText.includes('一般棋理補充'))
  check('模型提供的額外一般註記不會混入棋手正文', !result.finalText.includes('一般而言，先出正馬再補中炮'))

  const shortProvider = new FakeProvider(false)
  const shortTraces: HarnessTrace[] = []
  let shortResult: Awaited<ReturnType<typeof runExplanationHarness>> | null = null
  let shortError: unknown
  try { shortResult = await runExplanationHarness(
    {
      requestId: 'ai-request-grounded-short-completion',
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
      provider: shortProvider,
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
      traceStore: { save: (trace: HarnessTrace) => shortTraces.push(trace) } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }
  ) } catch (error) { shortError = error }
  check(
    '不足 400 漢字的首答不得用固定文字補字交付',
    shortResult === null && shortError instanceof Error &&
      shortError.message.includes('沒有通過棋理與證據檢查')
  )
  check(
    '短答至多嘗試一次有界修補，失敗後仍拒絕交付',
    shortProvider.calls === 2 && shortTraces.at(-1)?.status === 'failed' &&
      !shortTraces.at(-1)?.finalText,
    JSON.stringify({ calls: shortProvider.calls, errors: shortTraces.at(-1)?.validationErrors })
  )
  check(
    '短答 trace 保留原始字數診斷',
      shortTraces.at(-1)?.validationErrors.some((error) =>
        error.includes('一鍵完整解說正文只有')
      )
  )

  const nearTargetProvider = new NearTargetProvider()
  const nearTargetTraces: HarnessTrace[] = []
  const nearTargetResult = await runExplanationHarness(
    {
      requestId: 'ai-request-grounded-near-target-completion',
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
      provider: nearTargetProvider,
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
      traceStore: {
        save: (trace: HarnessTrace) => nearTargetTraces.push(trace)
      } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }
  )
  check(
    '400–499 漢字的合格正文達最低門檻，保留原文不補字',
    nearTargetProvider.calls === 1 &&
      countHanCharacters(nearTargetResult.finalText) >= 400 &&
      countHanCharacters(nearTargetResult.finalText) < 500 &&
      nearTargetTraces.at(-1)?.status === 'completed',
    JSON.stringify({
      calls: nearTargetProvider.calls,
      finalHan: countHanCharacters(nearTargetResult.finalText),
      errors: nearTargetTraces.at(-1)?.validationErrors
    })
  )

  const shallowAnalysis: EngineAnalysis = {
    ...engineAnalysis,
    principalVariation: [engineAnalysis.bestMove],
    displayPrincipalVariation: [engineAnalysis.displayBestMove],
    userMovePrincipalVariation: [
      engineAnalysis.userMove as string,
      'h9g7'
    ],
    displayUserMovePrincipalVariation: [
      engineAnalysis.displayUserMove as string,
      '馬8進7'
    ]
  }
  const shallowSession: AnalysisSession = {
    ...session,
    analysisId: 'analysis-shallow-initial-lines',
    engineAnalysis: shallowAnalysis,
    moveComparison: compareMove(shallowAnalysis)
  }
  const shallowEvidenceProvider = new FakeProvider()
  const shallowEvidenceTraces: HarnessTrace[] = []
  let shallowEvidenceResearchCalls = 0
  await runExplanationHarness(
    {
      requestId: 'ai-request-shallow-initial-lines',
      analysisId: shallowSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      attachedMove: shallowAnalysis.userMove,
      answerMode: 'research',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 1,
        maxModelCalls: 4,
        maxOutputTokens: 8000
      }
    },
    {
      provider: shallowEvidenceProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: shallowSession,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => ({
          analyzePosition: async () => {
            shallowEvidenceResearchCalls += 1
            return engineAnalysis
          }
        })
      } as never,
      traceStore: {
        save: (trace: HarnessTrace) => shallowEvidenceTraces.push(trace)
      } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      timing: { minResearchRoundMs: 1, maxResearchRoundMs: 1 }
    }
  )
  check(
    '首選線少於兩手或實戰線少於三手時，先做一次短引擎加深再送模型',
    shallowEvidenceResearchCalls === 1 &&
      shallowEvidenceTraces.at(-1)?.engineRounds === 1 &&
      shallowEvidenceProvider.prompts[0]?.includes('馬2進3'),
    JSON.stringify({
      engineCalls: shallowEvidenceResearchCalls,
      engineRounds: shallowEvidenceTraces.at(-1)?.engineRounds
    })
  )
  const deepUserEvidence = shallowEvidenceTraces.at(-1)?.evidence
    .filter((item) => item.move === shallowAnalysis.userMove)
    .sort((a, b) => b.displayPrincipalVariation.length - a.displayPrincipalVariation.length)[0]
  check(
    '實戰線加深後 prompt 改引用較完整的變例，不能仍把淺層 E2 當作唯一實戰線',
    deepUserEvidence?.displayPrincipalVariation.length === 4 &&
      deepUserEvidence.id !== 'E2' &&
      (shallowEvidenceTraces.at(-1)?.evidence[0]?.displayPrincipalVariation.length ?? 0) >= 2 &&
      shallowEvidenceProvider.prompts[0]?.includes(`${deepUserEvidence.id} 作實戰步主線`) &&
      shallowEvidenceProvider.prompts[0]?.includes(`"directAnswerEvidenceIds":["E1","${deepUserEvidence.id}"]`) &&
      shallowEvidenceProvider.prompts[0]?.includes(`"evidenceIds":["${deepUserEvidence.id}"],"findingIds":["K1"]`) &&
      shallowEvidenceProvider.prompts[0]?.includes(`"evidenceIds":["${deepUserEvidence.id}"],"findingIds":["K2"]`) &&
      shallowEvidenceProvider.prompts[0]?.includes(`"id":"${deepUserEvidence.id}","role":"user_move"`) &&
      shallowEvidenceProvider.prompts[0]?.includes(`"ply":2,"move":"${deepUserEvidence.displayPrincipalVariation[1]}"`) &&
      shallowEvidenceProvider.prompts[0]?.includes('"claimId":"C4a"') &&
      shallowEvidenceProvider.prompts[0]?.includes('"claimId":"C4b"') &&
      !shallowEvidenceProvider.prompts[0]?.includes('"supportingMoves":["中文著法一"') &&
      !shallowEvidenceProvider.prompts[0]?.includes('"id":"E2"'),
    JSON.stringify({
      selected: deepUserEvidence?.id,
      lineLength: deepUserEvidence?.displayPrincipalVariation.length
    })
  )

  const delayedDeepEvidenceProvider = new FakeProvider()
  const delayedDeepEvidenceTraces: HarnessTrace[] = []
  const delayedDeepEvidenceProgress: HarnessProgressPayload[] = []
  let delayedDeepEvidenceResearchCalls = 0
  const delayedDeepEvidenceResult = await runExplanationHarness(
    {
      requestId: 'ai-request-wait-for-deeper-lines',
      analysisId: shallowSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      attachedMove: shallowAnalysis.userMove,
      answerMode: 'research',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 2,
        maxModelCalls: 4,
        maxOutputTokens: 8000
      }
    },
    {
      provider: delayedDeepEvidenceProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: shallowSession,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => ({
          analyzePosition: async () => {
            delayedDeepEvidenceResearchCalls += 1
            return delayedDeepEvidenceResearchCalls === 1
              ? shallowAnalysis
              : engineAnalysis
          }
        })
      } as never,
      traceStore: {
        save: (trace: HarnessTrace) => delayedDeepEvidenceTraces.push(trace)
      } as never,
      signal: new AbortController().signal,
      onProgress: (payload) => delayedDeepEvidenceProgress.push(payload),
      timing: { minResearchRoundMs: 1, maxResearchRoundMs: 1 }
    }
  )
  check(
    '第一次加深仍太淺時自動等待下一輪，不要求棋手重新提交想法',
    delayedDeepEvidenceResearchCalls === 2 &&
      delayedDeepEvidenceTraces.at(-1)?.engineRounds === 2 &&
      delayedDeepEvidenceResult.finalText.length > 0 &&
      delayedDeepEvidenceProvider.calls === 1 &&
      delayedDeepEvidenceProvider.prompts[0]?.includes('馬2進3'),
    JSON.stringify({
      engineCalls: delayedDeepEvidenceResearchCalls,
      engineRounds: delayedDeepEvidenceTraces.at(-1)?.engineRounds,
      modelCalls: delayedDeepEvidenceProvider.calls
    })
  )
  check(
    '等待較深主線期間持續回報引擎研究進度供畫面顯示',
    delayedDeepEvidenceProgress.filter((item) => item.phase === 'engine_research')
      .length >= 2
  )

  const hangingProvider = new HangingInitialProvider()
  const softTimeoutTraces: HarnessTrace[] = []
  const softTimeoutStartedAt = Date.now()
  let softTimeoutError: unknown
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-initial-soft-timeout',
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
        provider: hangingProvider,
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
        traceStore: {
          save: (trace: HarnessTrace) => softTimeoutTraces.push(trace)
        } as never,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        timing: { initialMoveFirstCallTimeoutMs: 10 }
      }
    )
  } catch (error) {
    softTimeoutError = error
  }
  check(
    '首輪服務卡住時在內部軟截止後明確失敗，不交付假解說',
    hangingProvider.calls === 1 &&
      Date.now() - softTimeoutStartedAt < 500 &&
      softTimeoutError instanceof Error &&
      softTimeoutError.message.includes('AI 教練模型未在時限內完成')
  )
  check(
    '首輪軟截止 trace 為 failed，且不保存五段模板正文',
    softTimeoutTraces.at(-1)?.status === 'failed' &&
      softTimeoutTraces.at(-1)?.finalText === undefined
  )

  const permanentErrorProvider = new PermanentProviderErrorProvider()
  const permanentErrorTraces: HarnessTrace[] = []
  let permanentProviderError: unknown
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-provider-error-fallback',
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
        provider: permanentErrorProvider,
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
        traceStore: {
          save: (trace: HarnessTrace) => permanentErrorTraces.push(trace)
        } as never,
        signal: new AbortController().signal,
        onProgress: () => undefined
      }
    )
  } catch (error) {
    permanentProviderError = error
  }
  check(
    '模型服務錯誤會明確失敗且不再誤記成無效 JSON',
    permanentErrorProvider.calls === 1 &&
      permanentProviderError instanceof Error &&
      permanentProviderError.message.includes('(401)') &&
      permanentErrorTraces.at(-1)?.status === 'failed' &&
      permanentErrorTraces.at(-1)?.validationErrors.some((error) =>
        error.includes('AI 服務未完成')
      ) &&
      !permanentErrorTraces.at(-1)?.validationErrors.some((error) =>
        error.includes('JSON')
      )
  )

  const rateLimitedProvider = new RateLimitedProvider()
  const rateLimitedProgress: Array<Omit<HarnessProgressPayload, 'requestId'>> = []
  const rateLimitedTraces: HarnessTrace[] = []
  let rateLimitedError: unknown
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-rate-limited-fallback',
        analysisId: session.analysisId,
        provider: 'gemini',
        model: 'gemini-3.5-flash',
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
        provider: rateLimitedProvider,
        apiKey: 'secret',
        model: 'gemini-3.5-flash',
        session,
        registry: {
          list: () => ({
            installations: [],
            activeEngineId: 'engine-1',
            verificationEngineId: null
          }),
          getAdapter: () => null
        } as never,
        traceStore: {
          save: (trace: HarnessTrace) => rateLimitedTraces.push(trace)
        } as never,
        signal: new AbortController().signal,
        onProgress: (event) => rateLimitedProgress.push(event)
      }
    )
  } catch (error) {
    rateLimitedError = error
  }
  check(
    '429 限流不會以 600ms 重試繼續撞額度',
    rateLimitedProvider.calls === 1 &&
      !rateLimitedProgress.some((event) => event.phase === 'provider_retry')
  )
  check(
    '429 限流不交付五段替代模板，直接保留可重試錯誤',
    rateLimitedError instanceof Error &&
      rateLimitedError.message.includes('(429)') &&
      rateLimitedTraces.at(-1)?.status === 'failed' &&
      rateLimitedTraces.at(-1)?.finalText === undefined
  )
  check(
    '429 限流 trace 記錄服務未完成而非無效 JSON',
    rateLimitedTraces.at(-1)?.validationErrors.some((error) =>
      error.includes('AI 服務未完成')
    ) &&
      !rateLimitedTraces.at(-1)?.validationErrors.some((error) =>
        error.includes('JSON')
      )
  )

  const retryProvider = new TransientRetryProvider()
  const retryProgress: Array<Omit<HarnessProgressPayload, 'requestId'>> = []
  const retryResult = await runExplanationHarness(
    {
      requestId: 'ai-request-transient-retry',
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
      provider: retryProvider,
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
      onProgress: (event) => retryProgress.push(event)
    }
  )
  check(
    '暫時性 503 會自動重試一次後完成，不整個失敗',
    retryProvider.attempts === 2 && retryResult.warnings.length === 0
  )
  check(
    '服務重試會在 UI 進度流顯示安全的 HTTP 原因',
    retryProgress.some(
      (event) =>
        event.phase === 'provider_retry' && event.message.includes('HTTP 503')
    )
  )

  const lateTransientProvider = new LateTransientProvider()
  const lateTransientTraces: HarnessTrace[] = []
  const lateTransientProgress: Array<Omit<HarnessProgressPayload, 'requestId'>> = []
  let lateTransientError: unknown
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-late-transient',
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
        provider: lateTransientProvider,
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
        traceStore: {
          save: (trace: HarnessTrace) => lateTransientTraces.push(trace)
        } as never,
        signal: new AbortController().signal,
        onProgress: (event) => lateTransientProgress.push(event),
        timing: { initialMoveFirstCallTimeoutMs: 50 }
      }
    )
  } catch (error) {
    lateTransientError = error
  }
  check(
    '剩餘不到 30 秒時不啟動注定失敗的第二次模型請求',
    lateTransientProvider.attempts === 1 &&
      lateTransientError instanceof Error &&
      lateTransientError.message.includes('(503)') &&
      lateTransientTraces.at(-1)?.modelCalls === 1 &&
      !lateTransientProgress.some((event) => event.phase === 'provider_retry')
  )

  const cancelledTraces: HarnessTrace[] = []
  const cancelledController = new AbortController()
  cancelledController.abort()
  let cancelledError: unknown = null
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-cancelled',
        analysisId: session.analysisId,
        provider: 'openai',
        model: 'fake-model',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical',
        language: 'zh-TW'
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
          getAdapter: () => null
        } as never,
        traceStore: {
          save: (trace: HarnessTrace) => cancelledTraces.push(trace)
        } as never,
        signal: cancelledController.signal,
        onProgress: () => undefined
      }
    )
  } catch (error) {
    cancelledError = error
  }
  check(
    '取消訊號不會被模型 JSON fallback 吞掉',
    cancelledError instanceof DOMException && cancelledError.name === 'AbortError'
  )
  check('取消的 Harness trace 標示 cancelled', cancelledTraces.at(-1)?.status === 'cancelled')

  const stagnationProvider = new FakeProvider()
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
  check('首次實戰步比較直接回報既有快照深度與主線', progressEvents.some((item) => item.depth === 12 && (item.displayPrincipalVariation?.length ?? 0) > 0))
  check('首次實戰步比較不要求使用者決定是否加深', continuationRequests === 0)
  check('既有證據足夠時可直接完成兩項具體後果', stagnationResult.finalText.includes('黑方多完成一步部署'))

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

  for (const question of [
    '紅方三路兵現在過河了嗎？它現在能橫走嗎？請依目前棋盤回答，並區分棋規與引擎建議。',
    '黑方三路卒還沒過河，它可以橫走嗎？'
  ]) {
    const boardQuestionProvider = new FollowUpProvider('紅方三路兵是否過河要看目前位置；過河前不能橫走，過河後可橫走一格。引擎建議炮二平五，這是選擇著法的建議，兵的走法仍依棋規判斷。')
    const boardQuestion = await runExplanationHarness(
      { requestId: 'board-rules-follow-up', analysisId: noMoveSession.analysisId,
        provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
        explanationStyle: 'long_analytical', language: 'zh-TW',
        followUpQuestion: question, reuseEvidence: true,
        budget: { engineTimeMs: 100, maxEngineRounds: 1, maxModelCalls: 2, maxOutputTokens: 4000 } },
      { provider: boardQuestionProvider, apiKey: 'synthetic-test-key', model: 'fake-model',
        session: noMoveSession,
        registry: { list: () => ({ installations: [], activeEngineId: null, verificationEngineId: null }), getAdapter: () => null } as never,
        traceStore: { save: () => undefined } as never,
        signal: new AbortController().signal, onProgress: () => undefined }
    )
    check('具名棋子的棋規追問不要求指定著法', !boardQuestion.clarificationRequired, question)
    if (question.includes('引擎建議')) {
      check('混合棋規與引擎建議問題交給回答流程', boardQuestionProvider.calls > 0, question)
      check('回答提示保留完整棋規問題', boardQuestionProvider.prompts.some(p => p.includes(question)))
    } else {
      check('純棋規不浪費模型呼叫', boardQuestionProvider.calls === 0)
      check('回答包含未過河與不能橫走', /未過河/.test(boardQuestion.finalText) && /不能橫走/.test(boardQuestion.finalText))
    }
  }

  console.log('\n## 未提供使用者著法：目前局面解說')
  const noUserMoveProvider = new NoUserMoveProvider()
  const noUserMoveProgress: Array<Omit<HarnessProgressPayload, 'requestId'>> = []
  const noUserMoveResult = await runExplanationHarness(
    {
      requestId: 'ai-request-no-user-move',
      analysisId: noMoveSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      followUpQuestion: '請完整解釋目前局面',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 1,
        maxModelCalls: 4,
        maxOutputTokens: 4000
      }
    },
    {
      provider: noUserMoveProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: noMoveSession,
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
      onProgress: (payload) => noUserMoveProgress.push(payload)
    }
  )
  check(
    '沒有指定著法時只需審查與寫作兩次模型呼叫即可通過',
    noUserMoveProvider.calls === 2,
    noUserMoveProvider.calls
  )
  check(
    'Harness 每個模型階段都要求 Provider 回傳結構化 JSON',
    noUserMoveProvider.responseFormats.length === 2 &&
      noUserMoveProvider.responseFormats.every((format) => format === 'json'),
    noUserMoveProvider.responseFormats
  )
  check(
    'Harness JSON parser 接受 fenced audit 與單物件陣列 writer',
    noUserMoveResult.finalText.includes('目前局面應先看炮二平五') &&
      !noUserMoveResult.finalText.includes('保守版問答')
  )
  check(
    '審查提示明確切換成目前局面與最佳著法，且 userMoveProblem 必須留空',
    noUserMoveProvider.prompts[0]?.includes('本次沒有提供使用者著法') &&
      noUserMoveProvider.prompts[0]?.includes('"userMoveProblem":""')
  )
  check(
    '寫作提示不再要求解釋不存在的錯著',
    noUserMoveProvider.prompts[1]?.includes(
      '只解釋目前局面、最佳著法的目的、對手最強回應與最佳著法主線'
    ) &&
      !noUserMoveProvider.prompts[1]?.includes(
        '先用 directAnswer 寫一段短結論：這步為什麼不好'
      )
  )
  check(
    '成功答案只呈現目前局面、最佳著法與後續主線',
    noUserMoveResult.finalText.includes('目前局面應先看炮二平五') &&
      noUserMoveResult.finalText.includes('對手利用與後果') &&
      !/(使用者著法|你的著法|自己的著法|你(?:的)?這步|兩種著法|錯著)/.test(
        noUserMoveResult.finalText
      )
  )
  check(
    '沒有指定著法的成功答案通過專用品質訊息而非落入保守版',
    noUserMoveProgress.some(
      (item) =>
        item.phase === 'quality_check' &&
        item.message.includes('結構與引用關聯檢查') &&
        item.message.includes('未經獨立證實') &&
        !item.message.includes('可計算棋盤事實檢查')
    ) && !noUserMoveResult.finalText.includes('保守版問答')
  )

  const followUpProvider = new FollowUpProvider()
  let followUpEngineCalls = 0
  const followUpTraces: HarnessTrace[] = []
  const followUpResult = await runExplanationHarness(
    {
      requestId: 'ai-request-follow-up-concise',
      analysisId: noMoveSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      followUpQuestion: '請用三句話說明這個局面最需要注意什麼？',
      conversationHistory: [
        {
          id: 'prior-assistant-message',
          role: 'assistant',
          text: '先前的完整局面分析。',
          createdAt: new Date().toISOString(),
          provider: 'openai',
          model: 'fake-model'
        }
      ],
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 3,
        maxModelCalls: 4,
        maxOutputTokens: 4000
      }
    },
    {
      provider: followUpProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: noMoveSession,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => ({
          analyzePosition: async () => {
            followUpEngineCalls += 1
            return noMoveEngineAnalysis
          }
        })
      } as never,
      traceStore: {
        save: (trace: HarnessTrace) => followUpTraces.push(trace)
      } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      explanationPrompt
    }
  )
  check(
    '同一對話追問只呼叫一次模型且不重跑引擎研究',
    followUpProvider.calls === 1 &&
      followUpEngineCalls === 0 &&
      followUpTraces.at(-1)?.modelCalls === 1 &&
      followUpTraces.at(-1)?.engineRounds === 0
  )
  check(
    '追問使用較小輸出上限並要求只回答本次問題',
    followUpProvider.requestedMaxTokens[0] === 1200 &&
      followUpProvider.prompts[0]?.includes('只回答使用者這一次的問題') &&
      followUpProvider.prompts[0]?.includes('句數、長度、語氣或格式')
  )
  check(
    '追問仍保留 PromptBuilder 的既有對話上下文',
    followUpProvider.prompts[0]?.includes('Previous coach context marker')
  )
  check('正式追問的最終請求沒有共用提示的長文要求',
    !/長篇、仔細|逐點引用/.test(followUpProvider.prompts[0] ?? ''))
  check('正式追問也收到共同棋規，問原因不需要先問規則才能啟用',
    ['象眼', '馬腿', '恰好一枚', '不能後退'].every(rule => followUpProvider.prompts[0]?.includes(rule)))
  check(
    '追問保留原問題並遵守三句話要求，不重複完整教學模板',
    followUpResult.finalText.includes(
      '你問：請用三句話說明這個局面最需要注意什麼？'
    ) &&
      followUpResult.finalText.includes('第一，炮二平五') &&
      (followUpResult.finalText.split('\n\n')[2]?.match(/。/g)?.length ?? 0) === 3 &&
      !followUpResult.finalText.includes('下次遇到類似局面') &&
      !followUpResult.finalText.includes('保守版問答')
  )

  const invalidFollowUpProvider = new LocalizedNoUserMoveProvider(['not-json', '目前最需要注意中路的控制，炮二平五把炮移到中路。接下來出子前先檢查對手能否直接將軍或吃掉無根子。不要只顧進攻而讓自己的將帥失去保護。'])
  for (const scenario of [
    { name: '數字分數比較也不能回答決策原因', outputs: [JSON.stringify({ directAnswer: '炮二平五引擎評估400分，其他走法200分，所以這步更好。' }), '炮二平五引擎評估400分，其他走法200分，所以這步更好。'], accepted: false },
    { name: 'salvage 不能用分數高低回答決策原因', outputs: [JSON.stringify({ directAnswer: '炮二平五的評分較高，所以這步比其他著法更好。' }), '炮二平五的評分較高，所以這步比其他著法更好。'], accepted: false },
    { name: '文字 recovery 不能用分數高低回答決策原因', outputs: ['not-json', '炮二平五的評分較高，所以這步比其他著法更好。'], accepted: false },
    { name: '短追問不能將主線誇大為被迫', outputs: [JSON.stringify({ mode: 'research', title: '追問',
      directAnswer: '炮二平五建立中炮後，黑方被迫走馬8進7。', directAnswerEvidenceIds: ['E1'],
      sections: [{ id: 'follow_up', heading: '追問', claims: [{ id: 'FQ1', text: '炮二平五建立中炮後，黑方被迫走馬8進7。', evidenceIds: ['E1'] }] }], generalNotes: [], warnings: [] }), '炮二平五建立中炮後，黑方被迫走馬8進7。'], accepted: false },
    { name: '文字 recovery 不能聲稱只能被動應對', outputs: ['not-json', '炮二平五建立中炮後，黑方馬8進7只能被動應對。'], accepted: false },
    { name: 'salvage 不能豁免唯一回應斷言', outputs: [JSON.stringify({ directAnswer: '炮二平五建立中炮後，黑方馬8進7是唯一回應。' }), '炮二平五建立中炮後，黑方馬8進7是唯一回應。'], accepted: false },
    { name: '短追問可明確否定強迫主線', outputs: ['not-json', '炮二平五建立中炮後，主線選擇黑方馬8進7，但不是唯一回應。'], accepted: true }
  ]) {
    const provider = new LocalizedNoUserMoveProvider(scenario.outputs)
    let accepted = false
    let errorName: string | undefined
    try {
      const result = await runExplanationHarness({ requestId: scenario.name, analysisId: noMoveSession.analysisId,
        provider: 'openai', model: 'fake-model', userLevel: 'intermediate', explanationStyle: 'long_analytical',
        language: 'zh-TW', answerMode: 'research', followUpQuestion: '炮二平五後黑方怎麼應對？',
        conversationHistory: [{ id: 'certainty-context', role: 'user', text: '正在復盤這盤棋。', createdAt: new Date().toISOString() }] },
        { provider, apiKey: 'synthetic-test-key', model: 'fake-model', session: noMoveSession,
          registry: { list: () => ({ activeEngineId: 'engine-1' }), getAdapter: () => null } as never,
          traceStore: { save: () => undefined } as never, signal: new AbortController().signal, onProgress: () => undefined })
      accepted = result.finalText.includes('炮二平五')
    } catch (error) { errorName = error instanceof Error ? error.name : String(error) }
    check(scenario.name, accepted === scenario.accepted && (scenario.accepted || errorName === 'HarnessExplanationUnavailableError'), JSON.stringify({ accepted, calls: provider.calls, errorName }))
  }
  for (const scenario of [
    { name: '具體短答不強制兩步變例或後果', evidenceId: 'E2',
      text: '紅方馬八進七沒有吃子，只把左翼馬從底線移出發展。', accepted: true },
    { name: '短答仍拒絕跨變例引用', evidenceId: 'E1',
      text: '紅方馬八進七沒有吃子，只把左翼馬從底線移出發展。', accepted: false },
    { name: '短答仍拒絕錯誤方別', evidenceId: 'E2',
      text: '黑方馬八進七沒有吃子，只把左翼馬從底線移出發展。', accepted: false }
  ]) {
    const provider = new LocalizedNoUserMoveProvider([JSON.stringify({
      mode: 'research', title: '追問', directAnswer: scenario.text,
      directAnswerEvidenceIds: [scenario.evidenceId], sections: [{ id: 'follow_up', heading: '追問',
        claims: [{ id: 'FQ1', text: scenario.text, evidenceIds: [scenario.evidenceId] }] }], generalNotes: [], warnings: []
    }), '無法提供有效回答。'])
    let accepted = false
    let focusedTrace: HarnessTrace | undefined
    let failure: string | undefined
    try {
      const result = await runExplanationHarness({
        requestId: `focused-question-${scenario.name}`, analysisId: session.analysisId,
        provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
        explanationStyle: 'long_analytical', language: 'zh-TW', answerMode: 'research',
        attachedMove: 'b0c2', reuseEvidence: true,
        followUpQuestion: '紅方馬八進七是否吃子？請只用一句話回答。',
        conversationHistory: [{ id: 'focused-context', role: 'user', text: '正在復盤已走出的實戰著法。', createdAt: new Date().toISOString() }]
      }, { provider, apiKey: 'synthetic-test-key', model: 'fake-model', session,
        registry: { list: () => ({ activeEngineId: 'engine-1' }),
          getAdapter: () => ({ analyzePosition: async () => engineAnalysis }) } as never,
        traceStore: { save: (trace: HarnessTrace) => { focusedTrace = trace } } as never,
        signal: new AbortController().signal, onProgress: () => undefined })
      accepted = result.finalText.includes(scenario.text) && provider.calls === 1
    } catch (error) { accepted = false; failure = error instanceof Error ? error.message : String(error) }
    check(scenario.name, accepted === scenario.accepted, JSON.stringify({ failure, calls: provider.calls, errors: focusedTrace?.validationErrors }))
  }
  const invalidFollowUpResult = await runExplanationHarness(
    {
      requestId: 'ai-request-follow-up-invalid-json',
      analysisId: noMoveSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      followUpQuestion: '請用三句話說明這個局面最需要注意什麼？',
      conversationHistory: [
        {
          id: 'prior-assistant-message-fallback',
          role: 'assistant',
          text: '先前的完整局面分析。',
          createdAt: new Date().toISOString()
        }
      ],
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 3,
        maxModelCalls: 4,
        maxOutputTokens: 4000
      }
    },
    {
      provider: invalidFollowUpProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: noMoveSession,
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
      onProgress: () => undefined
    }
  )
  const invalidFollowUpDirect = invalidFollowUpResult.finalText
  check(
    '追問 JSON 無效時改用一次短文重試，回答本次問題並遵守三句話',
    invalidFollowUpProvider.calls === 2 &&
      (invalidFollowUpDirect.match(/。/g)?.length ?? 0) === 3 &&
      invalidFollowUpResult.finalText.includes('目前最需要注意中路的控制') &&
      !invalidFollowUpResult.finalText.includes('下次遇到類似局面')
  )

  for (const scenario of [
    { name: 'malformed', outputs: ['{broken', '炮二平五把炮轉到中路，開局應先檢查中兵的保護與馬的出路。'], calls: 2 },
    { name: 'plain', outputs: ['炮二平五把炮轉到中路，開局應先檢查中兵的保護與馬的出路。'], calls: 1 },
    { name: 'false-board-salvage', outputs: ['黑方炮二平五吃紅方車，開局中路取得優勢。', '紅方炮二平五把炮轉到中路，開局應先檢查中兵的保護與馬的出路。'], calls: 2 },
    { name: 'unrelated', outputs: [JSON.stringify({directAnswer: '先看引擎首選炮二平五。'}), '皮卡魚主線炮二平五把炮移到中路，這段開局變化顯示了中路子力的調動。'], calls: 2 },
    { name: 'unsupported-json', outputs: ['', '皮卡魚主線炮二平五把炮移到中路，這段開局變化顯示了中路子力的調動。'], calls: 2 }
  ]) {
    const requests: Array<Parameters<AIProvider['generateExplanation']>[0]> = []
    const provider = new LocalizedNoUserMoveProvider(scenario.outputs)
    const generate = provider.generateExplanation.bind(provider)
    const instrumented: AIProvider = {
      id: provider.id, displayName: provider.displayName,
      generateExplanation: async (request) => {
        requests.push(request)
        if (scenario.name === 'unsupported-json' && requests.length === 1) {
          provider.calls += 1
          throw Object.assign(new Error('response format unsupported'), {status:400})
        }
        return generate()
      },
      generateExplanationStream: provider.generateExplanationStream.bind(provider)
    }
    const result = await runExplanationHarness({
      requestId: 'focused-' + scenario.name, analysisId: noMoveSession.analysisId,
      provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
      explanationStyle: 'long_analytical', language: 'zh-TW', answerMode: 'research',
      followUpQuestion: '開局中路需要注意什麼？',
      budget: {engineTimeMs:100,maxEngineRounds:1,maxModelCalls:2,maxOutputTokens:3000}
    }, {
      provider: instrumented, apiKey: 'synthetic-test-key', model: 'fake-model', session: noMoveSession,
      registry: {list:()=>({installations:[],activeEngineId:null,verificationEngineId:null}),getAdapter:()=>null} as never,
      traceStore: {save:()=>undefined} as never, signal:new AbortController().signal,onProgress:()=>undefined
    })
    check('首次具體問題可恢復短文回答 ' + scenario.name, result.finalText.includes('中') && provider.calls === scenario.calls)
    if (scenario.name === 'false-board-salvage') {
      check('原始追問草稿的錯誤棋盤斷言不能被 salvage 交付',
        result.finalText === scenario.outputs[1] && !result.finalText.includes('吃紅方車'))
    }
    if (scenario.calls === 2) {
      check('恢復請求使用純文字且保留原問題 ' + scenario.name,
        requests[1].responseFormat === undefined && requests[1].prompt.includes('開局中路需要注意什麼？') && requests[1].maxOutputTokens === 1200)
    }
  }

  for (const scenario of [
    {name:'wrong-side', text:'黑方炮二平五把炮移到中路，開局應檢查中路子力。', accepted:false},
    {name:'fake-capture', text:'紅方炮二平五吃黑方車，開局控制中路並取得子力優勢。', accepted:false},
    {name:'correct-board', text:'紅方炮二平五把炮移到中路，開局應檢查中兵的保護與馬的出路。', accepted:true}
  ]) {
    const provider = new LocalizedNoUserMoveProvider(['{broken', scenario.text])
    let completed = false
    let reason: string | undefined
    try {
      const result = await runExplanationHarness({
        requestId:'question-recovery-board-' + scenario.name,analysisId:noMoveSession.analysisId,
        provider:'openai',model:'fake-model',userLevel:'intermediate',explanationStyle:'long_analytical',
        language:'zh-TW',followUpQuestion:'開局中路需要注意什麼？',
        budget:{engineTimeMs:100,maxEngineRounds:1,maxModelCalls:2,maxOutputTokens:3000}
      },{provider,apiKey:'synthetic-test-key',model:'fake-model',session:noMoveSession,
        registry:{list:()=>({installations:[],activeEngineId:null,verificationEngineId:null}),getAdapter:()=>null} as never,
        traceStore:{save:()=>undefined} as never,signal:new AbortController().signal,onProgress:()=>undefined})
      completed = result.finalText === scenario.text
    } catch (error) {
      if (error instanceof HarnessExplanationUnavailableError) reason = error.reason
      else throw error
    }
    check('短追問 recovery 核對實際棋盤事實 ' + scenario.name,
      provider.calls === 2 && (scenario.accepted ? completed : !completed && reason === 'quality_validation_failed'))
  }

  {
    let finishEngine!: (analysis: EngineAnalysis) => void
    const pendingEngine = new Promise<EngineAnalysis>(resolve => { finishEngine = resolve })
    const provider = new FollowUpProvider('皮卡魚主線炮二平五將炮移到中路，這段開局主線呈現了中路子力的調動。')
    const waitingSession = {...noMoveSession, engineAnalysis: {...noMoveSession.engineAnalysis,
      principalVariation:[noMoveSession.engineAnalysis.bestMove],
      displayPrincipalVariation:[noMoveSession.engineAnalysis.displayBestMove ?? '炮二平五']}}
    const resultPromise=runExplanationHarness({
      requestId:'wait-for-finished-pv',analysisId:waitingSession.analysisId,
      provider:'openai',model:'fake-model',userLevel:'intermediate',explanationStyle:'long_analytical',language:'zh-TW',
      followUpQuestion:'開局中路需要注意什麼？',
      budget:{engineTimeMs:100,maxEngineRounds:1,maxModelCalls:2,maxOutputTokens:3000}
    },{provider,apiKey:'synthetic-test-key',model:'fake-model',session:waitingSession,
      registry:{list:()=>({installations:[],activeEngineId:'engine-1',verificationEngineId:null}),getAdapter:()=>({analyzePosition:()=>pendingEngine})} as never,
      traceStore:{save:()=>undefined} as never,signal:new AbortController().signal,onProgress:()=>undefined})
    await Promise.resolve()
    check('皮卡魚尚未完成主線時不呼叫模型',provider.calls === 0)
    finishEngine(noMoveSession.engineAnalysis)
    const result=await resultPromise
    check('皮卡魚完成後依主線回答',provider.calls === 1 && result.finalText.includes('炮二平五'))
  }

  const englishFollowUpProvider = new LocalizedNoUserMoveProvider([
    EN_FOLLOW_UP_WRITER_JSON
  ])
  const englishFollowUpResult = await runExplanationHarness(
    {
      requestId: 'ai-request-follow-up-english-sentence-count',
      analysisId: noMoveSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'en',
      answerMode: 'research',
      followUpQuestion: 'Please answer in three sentences: what matters most here?',
      conversationHistory: [
        {
          id: 'prior-assistant-message-english',
          role: 'assistant',
          text: 'Previous position analysis.',
          createdAt: new Date().toISOString()
        }
      ],
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 3,
        maxModelCalls: 4,
        maxOutputTokens: 4000
      }
    },
    {
      provider: englishFollowUpProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: noMoveSession,
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
      onProgress: () => undefined
    }
  )
  const englishFollowUpDirect = englishFollowUpResult.finalText.split('\n\n')[2] ?? ''
  check(
    '英文 one..five 句數要求會正規化並驗證實際句界',
    englishFollowUpProvider.calls === 1 &&
      (englishFollowUpDirect.match(/\.(?=\s|$)/g)?.length ?? 0) === 3 &&
      englishFollowUpDirect.includes('Second,') &&
      englishFollowUpDirect.includes('Third,')
  )

  const noUserMoveAuditWithHallucination = {
    ...(JSON.parse(NO_USER_MOVE_AUDIT_JSON) as ConsequenceAudit),
    userMoveProblem: '你的著法錯失了控制中路的機會。'
  }
  const noUserMoveAuditErrors = validateConsequenceAudit(
    noUserMoveAuditWithHallucination,
    noUserMoveResult.evidence,
    false
  )
  check(
    '審查驗證器會擋下不存在的使用者著法分析',
    noUserMoveAuditErrors.some((error) => error.includes('不得補造'))
  )
  const noUserMoveAnswerWithHallucination: HarnessAnswer = {
    ...(JSON.parse(NO_USER_MOVE_WRITER_JSON) as HarnessAnswer),
    directAnswer: '你的著法錯失了控制中路的機會。',
    evidence: noUserMoveResult.evidence
  }
  const noUserMoveAnswerErrors = validateAnswer(
    noUserMoveAnswerWithHallucination,
    noUserMoveResult.evidence,
    {
      hasUserMove: false,
      requiredSectionIds: NO_USER_REQUIRED_SECTION_IDS,
      verifiedFindingIds: ['K1', 'K2']
    }
  )
  check(
    '答案驗證器會擋下不存在的著法批評與比較',
    noUserMoveAnswerErrors.some((error) => error.includes('不得補造'))
  )

  const noUserMoveFallbackProvider = new NoUserMoveProvider()
  const noUserMoveFallbackResult = await runExplanationHarness(
    {
      requestId: 'ai-request-no-user-move-fallback',
      analysisId: noMoveSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      followUpQuestion: '請完整解釋目前局面',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 1,
        maxModelCalls: 1,
        maxOutputTokens: 4000
      }
    },
    {
      provider: noUserMoveFallbackProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: noMoveSession,
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
      onProgress: () => undefined
    }
  )
  check(
    '沒有指定著法且寫作預算耗盡時會安全收斂到目前局面保守版',
    noUserMoveFallbackProvider.calls === 1 &&
      noUserMoveFallbackResult.finalText.includes('你問我答：目前局面分析') &&
      noUserMoveFallbackResult.finalText.includes('最佳著法主線') &&
      noUserMoveFallbackResult.finalText.includes('保守版問答')
  )
  check(
    '目前局面保守版不會補造或批評不存在的著法',
    !/(使用者著法|你的著法|自己的著法|你(?:的)?這步|兩種著法|錯著)/.test(
      noUserMoveFallbackResult.finalText
    )
  )

  const invalidJsonProvider = new LocalizedNoUserMoveProvider([
    'not-json-audit',
    'not-json-writer'
  ])
  let redundantNoUserEngineCalls = 0
  const invalidJsonTraces: HarnessTrace[] = []
  const invalidJsonResult = await runExplanationHarness(
    {
      requestId: 'ai-request-no-user-invalid-json',
      analysisId: noMoveSession.analysisId,
      provider: 'openai',
      model: 'fake-model',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW',
      answerMode: 'research',
      followUpQuestion: '請完整解釋目前局面',
      budget: {
        engineTimeMs: 3000,
        maxEngineRounds: 3,
        maxModelCalls: 4,
        maxOutputTokens: 4000
      }
    },
    {
      provider: invalidJsonProvider,
      apiKey: 'secret',
      model: 'fake-model',
      session: noMoveSession,
      registry: {
        list: () => ({
          installations: [],
          activeEngineId: 'engine-1',
          verificationEngineId: null
        }),
        getAdapter: () => ({
          analyzePosition: async () => {
            redundantNoUserEngineCalls += 1
            return noMoveEngineAnalysis
          }
        })
      } as never,
      traceStore: {
        save: (trace: HarnessTrace) => invalidJsonTraces.push(trace)
      } as never,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }
  )
  check(
    '目前局面解說直接使用持續分析快照，不重跑昂貴引擎研究',
    redundantNoUserEngineCalls === 0 &&
      invalidJsonTraces.at(-1)?.engineRounds === 0
  )
  check(
    '審查與寫作者回傳無效 JSON 時兩次呼叫即收斂，不再修復 fallback',
    invalidJsonProvider.calls === 2 &&
      invalidJsonResult.finalText.includes('保守版問答'),
    invalidJsonProvider.calls
  )

  const runLocalizedNoUserMove = async (
    language: 'en' | 'zh-CN',
    outputs: string[],
    maxModelCalls: number,
    requestId: string
  ) => {
    const localizedProvider = new LocalizedNoUserMoveProvider(outputs)
    const localizedResult = await runExplanationHarness(
      {
        requestId,
        analysisId: noMoveSession.analysisId,
        provider: 'openai',
        model: 'fake-model',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical',
        language,
        answerMode: 'research',
        followUpQuestion:
          language === 'en'
            ? 'Please explain the current position.'
            : '请完整解释当前局面。',
        budget: {
          engineTimeMs: 3000,
          maxEngineRounds: 1,
          maxModelCalls,
          maxOutputTokens: 4000
        }
      },
      {
        provider: localizedProvider,
        apiKey: 'secret',
        model: 'fake-model',
        session: noMoveSession,
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
        onProgress: () => undefined
      }
    )
    return { localizedProvider, localizedResult }
  }

  const englishSuccess = await runLocalizedNoUserMove(
    'en',
    [EN_NO_USER_MOVE_AUDIT_JSON, EN_NO_USER_MOVE_WRITER_JSON],
    4,
    'ai-request-no-user-move-en-success'
  )
  check(
    '英文目前局面答案可通過審查、deterministic validation 與品質評分，不會誤落 fallback',
    englishSuccess.localizedProvider.calls === 2 &&
      englishSuccess.localizedResult.finalText.includes(
        'Q&A: Current Position Analysis'
      ) &&
      englishSuccess.localizedResult.finalText.includes(
        'Opponent response and consequences'
      ) &&
      englishSuccess.localizedResult.finalText.includes('Direct conclusion') &&
      !englishSuccess.localizedResult.finalText.includes('conservative Q&A')
  )

  const simplifiedSuccess = await runLocalizedNoUserMove(
    'zh-CN',
    [ZH_CN_NO_USER_MOVE_AUDIT_JSON, ZH_CN_NO_USER_MOVE_WRITER_JSON],
    4,
    'ai-request-no-user-move-zh-cn-success'
  )
  check(
    '簡中目前局面答案可通過審查、deterministic validation 與品質評分，不會誤落 fallback',
    simplifiedSuccess.localizedProvider.calls === 2 &&
      simplifiedSuccess.localizedResult.finalText.includes('问答：当前局面分析') &&
      simplifiedSuccess.localizedResult.finalText.includes('对手利用与后果') &&
      simplifiedSuccess.localizedResult.finalText.includes('直接结论') &&
      !simplifiedSuccess.localizedResult.finalText.includes('保守版问答')
  )

  const englishFallback = await runLocalizedNoUserMove(
    'en',
    [EN_NO_USER_MOVE_AUDIT_JSON],
    1,
    'ai-request-no-user-move-en-fallback'
  )
  check(
    '英文 no-user fallback 使用英文具名區塊且不顯示原始引擎資料',
    englishFallback.localizedProvider.calls === 1 &&
      englishFallback.localizedResult.finalText.includes(
        'Q&A: Current Position Analysis'
      ) &&
      englishFallback.localizedResult.finalText.includes('Best-move line:') &&
      englishFallback.localizedResult.finalText.includes('conservative Q&A') &&
      !englishFallback.localizedResult.finalText.includes('Raw engine line') &&
      !englishFallback.localizedResult.finalText.includes('你問我答')
  )

  const simplifiedFallback = await runLocalizedNoUserMove(
    'zh-CN',
    [ZH_CN_NO_USER_MOVE_AUDIT_JSON],
    1,
    'ai-request-no-user-move-zh-cn-fallback'
  )
  check(
    '簡中 no-user fallback 使用簡中具名區塊且不顯示原始引擎資料',
    simplifiedFallback.localizedProvider.calls === 1 &&
      simplifiedFallback.localizedResult.finalText.includes('问答：当前局面分析') &&
      simplifiedFallback.localizedResult.finalText.includes('最佳着法主线：') &&
      simplifiedFallback.localizedResult.finalText.includes('保守版问答') &&
      !simplifiedFallback.localizedResult.finalText.includes('引擎原始主线') &&
      !simplifiedFallback.localizedResult.finalText.includes('你問我答')
  )

  const englishAuditHallucination = JSON.parse(
    EN_NO_USER_MOVE_AUDIT_JSON
  ) as ConsequenceAudit
  englishAuditHallucination.consequences[0].summary =
    'Your move was a blunder because it abandoned the central file.'
  const englishAuditHallucinationErrors = validateConsequenceAudit(
    englishAuditHallucination,
    englishSuccess.localizedResult.evidence,
    false,
    undefined,
    'en'
  )
  check(
    '英文審查驗證器會擋下對不存在使用者著法的補造與批評',
    englishAuditHallucinationErrors.some((error) => error.includes('不得補造'))
  )

  const simplifiedAnswerHallucination: HarnessAnswer = {
    ...(JSON.parse(ZH_CN_NO_USER_MOVE_WRITER_JSON) as HarnessAnswer),
    directAnswer: '你的着法错失了控制中路的机会。',
    evidence: simplifiedSuccess.localizedResult.evidence
  }
  const simplifiedAnswerHallucinationErrors = validateAnswer(
    simplifiedAnswerHallucination,
    simplifiedSuccess.localizedResult.evidence,
    {
      hasUserMove: false,
      language: 'zh-CN',
      requiredSectionIds: NO_USER_REQUIRED_SECTION_IDS,
      verifiedFindingIds: ['K1', 'K2']
    }
  )
  check(
    '簡中答案驗證器會擋下對不存在使用者著法的補造與批評',
    simplifiedAnswerHallucinationErrors.some((error) => error.includes('不得補造'))
  )

  const englishSafeGuidance: HarnessAnswer = {
    ...(JSON.parse(EN_NO_USER_MOVE_WRITER_JSON) as HarnessAnswer),
    directAnswer:
      "Before choosing your next move, check the central file. If you played 炮二平五 in a future position, then inspect the opponent's strongest continuation.",
    evidence: englishSuccess.localizedResult.evidence
  }
  const englishSafeGuidanceErrors = validateAnswer(
    englishSafeGuidance,
    englishSuccess.localizedResult.evidence,
    {
      hasUserMove: false,
      language: 'en',
      requiredSectionIds: NO_USER_REQUIRED_SECTION_IDS,
      verifiedFindingIds: ['K1', 'K2']
    }
  )
  const simplifiedSafeGuidance: HarnessAnswer = {
    ...(JSON.parse(ZH_CN_NO_USER_MOVE_WRITER_JSON) as HarnessAnswer),
    directAnswer: '轮到你走时，先检查中线；如果你走了炮二平五，再查看对手的最强后续。',
    evidence: simplifiedSuccess.localizedResult.evidence
  }
  const simplifiedSafeGuidanceErrors = validateAnswer(
    simplifiedSafeGuidance,
    simplifiedSuccess.localizedResult.evidence,
    {
      hasUserMove: false,
      language: 'zh-CN',
      requiredSectionIds: NO_USER_REQUIRED_SECTION_IDS,
      verifiedFindingIds: ['K1', 'K2']
    }
  )
  check(
    '多語系防幻覺規則不會把未來選著建議誤判成已存在的使用者著法',
    !englishSafeGuidanceErrors.some((error) => error.includes('不得補造')) &&
      !simplifiedSafeGuidanceErrors.some((error) => error.includes('不得補造'))
  )

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
    },
    {
      id: 'E2',
      engineId: 'engine-1',
      engineName: 'Test Engine',
      purpose: '初始主引擎使用者著法分析',
      positionFen: START_FEN,
      move: engineAnalysis.userMove,
      displayMove: engineAnalysis.displayUserMove,
      depth: 12,
      score: engineAnalysis.scoreAfterUserMove,
      displayPrincipalVariation:
        engineAnalysis.displayUserMovePrincipalVariation ?? [],
      analysis: engineAnalysis
    },
    {
      id: 'E3',
      engineId: 'engine-1',
      engineName: 'Test Engine',
      purpose: '候選兵三進一變例',
      positionFen: START_FEN,
      move: 'c3c4',
      displayMove: '兵三進一',
      depth: 12,
      score: engineAnalysis.candidateMoves[2]?.score ?? null,
      displayPrincipalVariation: ['兵三進一', '馬8進7'],
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
    evidenceIds: ['E2'],
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
    true, undefined, 'zh-TW', 'evidence_backed_difference'
  )
  check('具體的後果審查可通過全部檢查', baselineErrors.length === 0, baselineErrors)
  check('只有實戰步存在時，審查不把缺省比較狀態升格為已支持失誤',
    validateConsequenceAudit(makeAudit([makeFinding({}), goodSecondFinding]), validatorEvidence, true)
      .some(error => error.includes('比較證據不足')))
  for (const [text, asserted] of [
    ['目前比較證據不足，不能說馬八進七較差。', false],
    ['馬八進七並非失誤，這步的部署仍應沿主線觀察。', false],
    ['不能說馬八進七較差且更差。', true],
    ['馬八進七並非失誤，但這步較差。', true],
    ['馬八進七錯過中路部署，所以這步失去先手。', true]
  ] as const) {
    const errors = validateConsequenceAudit({
      ...makeAudit([makeFinding({}), goodSecondFinding]), userMoveProblem: text
    }, validatorEvidence, true, undefined, 'zh-TW', 'insufficient')
    check('不足比較的否定只約束自己的斷言 ' + text,
      errors.some(error => error.includes('比較證據不足')) === asserted, errors)
  }

  const realExchangeEvidence = boardFactEvidence(
    ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'g6g5', 'h0h6', 'c6c5',
      'b2c2', 'c9e7', 'b0a2', 'b9d8', 'a0b0', 'h7i7', 'h6h9', 'g7h9'],
    ['炮二平五', '馬8進7', '馬二進三', '車9平8', '車一平二', '卒7進1',
      '車二進六', '卒3進1', '炮八平七', '象3進5', '馬八進九', '馬2進4',
      '車九平八', '炮8平9', '車二進三', '馬7退8']
  )
  const exchangeFinding = makeFinding({
    summary: '紅方車二進三吃黑車，接著黑方馬7退8吃紅車，雙方各少一車。',
    opponentUse: '黑方以馬7退8吃掉紅車，回到黑車原位。',
    boardImpact: '車二進三與馬7退8之後，雙方的車各少一枚，黑馬留在原黑車所在格。',
    supportingMoves: ['車二進三', '馬7退8'], evidenceIds: [realExchangeEvidence.id]
  })
  const exchangeAudit: ConsequenceAudit = {
    bestMovePurpose: '炮二平五先把紅炮移到中路，後續出車再交換黑車。',
    userMoveProblem: '', consequences: [exchangeFinding], contradictions: [], enoughEvidence: true
  }
  const exchangeAuditErrors = validateConsequenceAudit(exchangeAudit, [realExchangeEvidence], false)
  check('真實中性換車通過具體性與棋盤檢查，只有單項後果的結構缺項仍拒絕',
    exchangeAuditErrors.length === 1 && exchangeAuditErrors[0]?.includes('至少需要兩項'), exchangeAuditErrors)
  const falseExchangeErrors = validateConsequenceAudit({ ...exchangeAudit, consequences: [
    { ...exchangeFinding, summary: exchangeFinding.summary.replace('吃黑車', '吃黑象') }
  ] }, [realExchangeEvidence], false)
  check('真實交換中的一個錯誤被吃棋子不能靠其他正確斷言豁免',
    falseExchangeErrors.some(error => error.includes('吃子斷言與逐手棋盤不一致')), falseExchangeErrors)

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
        supportingMoves: ['兵三進一', '馬8進7'],
        evidenceIds: ['E3']
      })
    ]),
    validatorEvidence,
    true
  )
  check(
    '候選著法變例中的著法以對應 evidence 引用時可以合法通過',
    !candidateLineErrors.some((error) => error.includes('引用變例中的著法')),
    candidateLineErrors
  )

  const crossVariationErrors = validateConsequenceAudit(
    makeAudit([
      makeFinding({ evidenceIds: ['E1'] }),
      goodSecondFinding
    ]),
    validatorEvidence,
    true
  )
  check(
    '存在於其他候選線的著法不能用錯誤 evidence 冒充同一變例',
    crossVariationErrors.some((error) =>
      error.includes('未出現在其引用變例中的著法')
    )
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
    requiredSectionIds: []
  })
  check(
    '一般棋理補充不得引用證據編號或聲稱經過引擎驗證',
    badNoteErrors.some((error) => error.includes('一般棋理補充不得'))
  )

  const leakedPlayerAnswer: HarnessAnswer = {
    ...badNoteAnswer,
    title: '你問我答：實戰步分析',
    directAnswer: '問：實戰步 h2e2 為何較差？請看 FEN、trace ID 與 [E1]。',
    directAnswerEvidenceIds: ['E1']
  }
  const leakedPlayerErrors = validateAnswer(leakedPlayerAnswer, validatorEvidence, {
    hasUserMove: true,
    requiredSectionIds: [HARNESS_SECTION_IDS.actualMoveProblem]
  })
  check(
    '一鍵正文的模擬提問或自問自答會被確定性驗證擋下',
    leakedPlayerErrors.some((error) => error.includes('不得使用模擬提問'))
  )
  check(
    '一鍵正文的 UCI、FEN、trace、token 或證據編號會被確定性驗證擋下',
    leakedPlayerErrors.some((error) => error.includes('內部格式或診斷資訊'))
  )
  for (const annotation of ['（E1）', 'E1 ply2', '落在 e2', '依照 C1']) {
    const errors = validateAnswer({ ...leakedPlayerAnswer,
      directAnswer: `炮二平五建立中炮${annotation}，要配合後續出子。`
    }, validatorEvidence, { hasUserMove: true, requiredSectionIds: [HARNESS_SECTION_IDS.actualMoveProblem] })
    check(`可見正文不能漏出內部標記 ${annotation}`, errors.some(error => error.includes('內部格式或診斷資訊')))
  }

  console.log('\n## 一鍵實戰步五段與完整度硬契約')

  const initialMoveRequirements = {
    hasUserMove: true,
    requiredSectionIds: [...INITIAL_MOVE_EXPLANATION_SECTION_IDS],
    enforceInitialMoveContract: true
  }
  const normalContractAnswer = (
    JSON.parse(
      combineAuditAndAnswer(GOOD_AUDIT_JSON, VAGUE_OPPONENT_WRITER_JSON)
    ) as { answer: HarnessAnswer }
  ).answer
  normalContractAnswer.title = '實戰著法解析'
  normalContractAnswer.generalNotes = []
  const normalContractErrors = validateAnswer(
    normalContractAnswer,
    validatorEvidence,
    initialMoveRequirements
  )
  check(
    '正好五段、單一非空原則且正文達 400 漢字的正常回答通過硬契約',
    normalContractErrors.length === 0,
    normalContractErrors
  )
  const fakeCaptureAnswer = JSON.parse(JSON.stringify(normalContractAnswer)) as HarnessAnswer
  fakeCaptureAnswer.sections[2]!.claims[0]!.text = '紅方炮二平五吃掉黑卒並將軍，後續黑方馬8進7保護中路。'
  fakeCaptureAnswer.sections[2]!.claims[0]!.evidenceIds = ['E1']
  check(
    '合法引用不能讓本步不存在的吃子與將軍斷言通過正文驗證',
    validateAnswer(fakeCaptureAnswer, validatorEvidence, initialMoveRequirements)
      .some((error) => error.includes('棋盤事實'))
  )
  const fakeCaptureAudit = JSON.parse(GOOD_AUDIT_JSON) as ConsequenceAudit
  fakeCaptureAudit.consequences[0]!.summary = '黑方炮二平五立即在中路吃掉紅方車。'
  fakeCaptureAudit.consequences[0]!.opponentUse = '紅方以馬8進7跳馬將軍並吃掉黑方炮。'
  fakeCaptureAudit.consequences[0]!.supportingMoves = ['炮二平五', '馬8進7']
  fakeCaptureAudit.consequences[0]!.evidenceIds = ['E1']
  check(
    '模型自填 verified 加合法 evidenceId 不能讓錯誤方別及假戰術通過審查',
    validateConsequenceAudit(fakeCaptureAudit, validatorEvidence, true)
      .some((error) => error.includes('棋盤事實'))
  )
  const sameVerdictAnswer = (JSON.parse(
    (await new SameMoveProvider().generateExplanation({ prompt: '' })).text
  ) as { answer: HarnessAnswer }).answer
  const sameVerdictEvidence = validatorEvidence.slice(0, 2).map((item) => ({
    ...item,
    move: 'h2e2',
    displayMove: '炮二平五',
    displayPrincipalVariation: sameMoveSession.engineAnalysis.displayPrincipalVariation,
    analysis: sameMoveSession.engineAnalysis
  }))
  const sameVerdictRequirements = { ...initialMoveRequirements, comparisonState: 'same_move' as const }
  check('同首選完整正文可通過正式 validator',
    validateAnswer(sameVerdictAnswer, sameVerdictEvidence, sameVerdictRequirements).length === 0)
  for (const directAnswer of ['實戰步不是好棋而是失誤。', '實戰步並非好棋而是敗著。']) {
    const contrastAnswer = structuredClone(sameVerdictAnswer)
    contrastAnswer.directAnswer = directAnswer
    check(`同首選完整正文不能把而是後的失誤判斷藏入前句否定：${directAnswer}`,
      validateAnswer(contrastAnswer, sameVerdictEvidence, sameVerdictRequirements)
        .some(error => error.includes('同一著法')))
  }
  const conditionalContrastAnswer = structuredClone(sameVerdictAnswer)
  conditionalContrastAnswer.directAnswer = '如果實戰步不是好棋而是失誤，仍需分析後續。炮二平五在此與首選相同。'
  check('同首選完整正文的而是仍保留外層條件語氣',
    validateAnswer(conditionalContrastAnswer, sameVerdictEvidence, sameVerdictRequirements).length === 0)
  const deniedOpeningEventsAnswer = structuredClone(sameVerdictAnswer)
  deniedOpeningEventsAnswer.sections[0]!.claims[0]!.text += '炮二平五在此未發生吃子或將軍。'
  const deniedOpeningEventsErrors = validateAnswer(
    deniedOpeningEventsAnswer, sameVerdictEvidence, sameVerdictRequirements)
  check('完整五段同首選正文的局部否定吃子及將軍可通過正式 validator',
    deniedOpeningEventsErrors.length === 0, deniedOpeningEventsErrors)
  deniedOpeningEventsAnswer.sections[0]!.claims[0]!.text += '但炮二平五這步已經將軍。'
  check('完整正文的局部否定不豁免後續虛構將軍',
    validateAnswer(deniedOpeningEventsAnswer, sameVerdictEvidence, sameVerdictRequirements)
      .some(error => error.includes('棋盤事實')))
  const replayedExchangeAnswer = JSON.parse(JSON.stringify(sameVerdictAnswer)
    .replaceAll('馬八進七', '馬二進三').replaceAll('馬2進3', '車9平8')) as HarnessAnswer
  const replayedExchangeEvidence = [{ ...realExchangeEvidence, id: 'E1' }]
  replayedExchangeAnswer.sections[3]!.claims[0]!.text =
    '炮二平五先把紅炮移到中線，黑方以馬8進7發展右翼馬；紅方接著馬二進三，黑方再走車9平8。這幾步反映雙方都在把後排棋子帶入可用線路，不能只看第一手的評分便認定對手沒有辦法應對。紅方後續車一平二，並在黑方卒7進1後走車二進六，將二路車送到較前的位置；黑方也有卒3進1與象3進5等部署。這段棋譜可以支持出子和調整線路的描述，但單一變例沒有窮盡其他應手，因此不能稱為對手必然會照走的完整攻防。紅方炮八平七、馬八進九、車九平八，也把另一翼的炮、馬和車逐步調整；黑方馬2進4、炮8平9則是這條線中可見的回應。理解這步的目的，需要沿這些具體著法觀察子力位置如何改變，再說明自己的計畫能否接上對方的應對，不能用得分替代原因。沿主線走到紅方車二進三吃黑車，黑方緊接馬7退8吃紅車，雙方各少一車，不能只把第一手吃車算成紅方淨多一車。最後黑馬停在剛完成交換的位置，兩方的車都已被移除；這是已重播主線的棋盤事實。至於交換後誰的子力更協調、攻勢能否延續，還需要更多變例和局面分析；這裡的吃子帳本只計算棋子數量，不替整體優劣作判定。實戰上應把移炮控制中路、雙方出子與後續換車連起來理解，同時保留對其他合理回應的觀察。'
  const replayedExchangeErrors = validateAnswer(
    replayedExchangeAnswer, replayedExchangeEvidence, sameVerdictRequirements)
  check('完整五段正文的真實吃車及反吃交換可通過正式 validator',
    replayedExchangeErrors.length === 0, replayedExchangeErrors)
  for (const text of [
    '紅方炮二平五當下可能吃黑方卒，然後黑方車9平8已經吃掉紅方炮。',
    '紅方炮二平五當下可能吃黑方卒，然後黑方車9平8已經將軍。'
  ]) {
    const falseSubsequentFact = structuredClone(replayedExchangeAnswer)
    falseSubsequentFact.sections[3]!.claims[0]!.text += text
    check(`完整五段正文的當下可能性不豁免後一手確定事件：${text}`,
      validateAnswer(falseSubsequentFact, replayedExchangeEvidence, sameVerdictRequirements)
        .some(error => error.includes('棋盤事實')))
  }
  const correctSubsequentFact = structuredClone(replayedExchangeAnswer)
  correctSubsequentFact.sections[3]!.claims[0]!.text +=
    '紅方炮二平五當下可能吃黑方卒，然後黑方車9平8沒有吃子。'
  check('完整五段正文可區分前手當下機會與後手真正沒有吃子的事實',
    validateAnswer(correctSubsequentFact, replayedExchangeEvidence, sameVerdictRequirements).length === 0)
  const chainedCaptureAnalysis: EngineAnalysis = {
    ...sameMoveAnalysis,
    principalVariation: realExchangeEvidence.analysis.principalVariation,
    displayPrincipalVariation: realExchangeEvidence.displayPrincipalVariation,
    userMovePrincipalVariation: realExchangeEvidence.analysis.principalVariation,
    displayUserMovePrincipalVariation: realExchangeEvidence.displayPrincipalVariation
  }
  const chainedCaptureSession: AnalysisSession = {
    ...sameMoveSession, analysisId: 'analysis-qualified-capture-chain',
    engineAnalysis: chainedCaptureAnalysis, moveComparison: compareMove(chainedCaptureAnalysis)
  }
  const captureChain = '炮二平五後，黑方車9平8，然後紅方車二進三吃黑車'
  for (const [name, text, expectedIssue] of [
    ['確定走法鏈通過具體關係檢查', `${captureChain}。`, ''],
    ['條件走法鏈不能充當已發生的具體關係', `如果${captureChain}，就應重新評估。`, '後續後果沒有使用具體象棋詞彙'],
    ['推測走法鏈不能充當已發生的具體關係', `或許${captureChain}。`, '後續後果沒有使用具體象棋詞彙'],
    ['條件走法鏈不能豁免獨立的錯誤吃子', `如果${captureChain}，但紅方車二進三這步已經吃黑象。`, '吃子斷言與逐手棋盤不一致'],
    ['推測走法鏈不能豁免獨立的錯誤吃子', `或許${captureChain}，但紅方車二進三這步已經吃黑象。`, '吃子斷言與逐手棋盤不一致']
  ]) {
    const chainAnswer = structuredClone(replayedExchangeAnswer)
    chainAnswer.sections[2]!.claims[0]!.text += chainAnswer.sections[3]!.claims[0]!.text
    chainAnswer.sections[3]!.claims[0]!.text = text!
    const chainProvider = new MutatedSameMoveProvider(answer => Object.assign(answer, chainAnswer))
    let chainTrace: HarnessTrace | undefined
    let delivered = ''
    let failure: unknown
    try {
      const result = await runExplanationHarness({
        requestId: `capture-chain-${name}`, analysisId: chainedCaptureSession.analysisId,
        provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
        explanationStyle: 'long_analytical', language: 'zh-TW',
        attachedMove: chainedCaptureAnalysis.userMove, answerMode: 'research',
        budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 2, maxOutputTokens: 4000 }
      }, {
        provider: chainProvider, apiKey: 'synthetic-test-key', model: 'fake-model', session: chainedCaptureSession,
        registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
        traceStore: { save: (trace: HarnessTrace) => { chainTrace = trace } } as never,
        signal: new AbortController().signal, onProgress: () => undefined
      })
      delivered = result.finalText
    } catch (error) { failure = error }
    check(`完整 Harness ${name}`, chainProvider.calls === (expectedIssue ? 2 : 1) && (expectedIssue
      ? failure instanceof HarnessExplanationUnavailableError && failure.reason === 'quality_validation_failed' &&
        chainProvider.prompt.includes(expectedIssue) &&
        delivered === '' && chainTrace?.status === 'failed' && chainTrace.finalText === undefined
      : failure === undefined && delivered.includes(text!) && chainTrace?.validationErrors.length === 0),
    JSON.stringify({ failure: String(failure), errors: chainTrace?.validationErrors }))
  }
  const falseNetMaterialAnswer = JSON.parse(JSON.stringify(replayedExchangeAnswer)) as HarnessAnswer
  falseNetMaterialAnswer.sections[3]!.claims[0]!.text =
    falseNetMaterialAnswer.sections[3]!.claims[0]!.text.replace(
      '雙方各少一車，不能只把第一手吃車算成紅方淨多一車', '紅方淨多一車')
  const falseNetMaterialErrors = validateAnswer(
    falseNetMaterialAnswer, replayedExchangeEvidence, sameVerdictRequirements)
  check('合格五段正文只改成錯誤淨多一車，即使保留真實吃子與有效引用也拒絕',
    falseNetMaterialErrors.some(error => error.includes('棋盤事實')), falseNetMaterialErrors)
  // A numerical difference must not require a negative explanation. These
  // two legal opening variations are mirror images; the engine classification
  // alone cannot establish a distinct tactical benefit for one cannon move.
  const mirrorFiles = 'ihgfedcba'
  const mirrorLine = realExchangeEvidence.analysis.principalVariation.map(move =>
    `${mirrorFiles[move.charCodeAt(0) - 97]}${move[1]}${mirrorFiles[move.charCodeAt(2) - 97]}${move[3]}`)
  const mirrorDisplay = ['炮八平五', '馬2進3', '馬八進七', '車1平2', '車九平八', '卒3進1',
    '車八進六', '卒7進1', '炮二平三', '象7進5', '馬二進一', '馬8進6',
    '車一平二', '炮2平1', '車八進三', '馬3退2']
  const neutralAnalysis: EngineAnalysis = {
    ...realExchangeEvidence.analysis, bestMove: 'b2e2', displayBestMove: '炮八平五',
    principalVariation: mirrorLine, displayPrincipalVariation: mirrorDisplay,
    userMove: 'h2e2', displayUserMove: '炮二平五',
    userMovePrincipalVariation: realExchangeEvidence.analysis.principalVariation,
    displayUserMovePrincipalVariation: realExchangeEvidence.displayPrincipalVariation
  }
  const neutralEvidence: HarnessEvidence[] = [
    { ...realExchangeEvidence, id: 'E1', move: 'b2e2', displayMove: '炮八平五',
      displayPrincipalVariation: mirrorDisplay, analysis: neutralAnalysis },
    { ...realExchangeEvidence, id: 'E2', move: 'h2e2', displayMove: '炮二平五', analysis: neutralAnalysis }
  ]
  const neutralAnswer = structuredClone(sameVerdictAnswer)
  neutralAnswer.directAnswer = '炮二平五與炮八平五都成中炮，兩條主線可支持共同作用，數值觀測不能代替具體優劣原因。'
  neutralAnswer.directAnswerEvidenceIds = ['E1', 'E2']
  const developmentCausal = {
    cause: '因為炮二平五先把紅炮移到中路',
    mechanism: '紅炮所在的中線與留下的邊炮線路不同',
    affected: '紅方兩枚炮與中兵所在的中路線路',
    opponentUse: '黑方馬8進7發展馬，再以車9平8調整車',
    consequence: '紅方馬二進三與黑方車9平8形成這條線的部署'
  }
  neutralAnswer.sections[0]!.claims = [{ id: 'N1', evidenceIds: ['E1', 'E2'], text:
    '炮二平五與炮八平五都把一枚紅炮移到中路，並留下另一翼炮。這個共同作用可以由第一手位置確認，不能說其中一步才有中炮計畫。兩條主線後續從不同一翼出馬、出車，顯示的是所選變例的部署；它們沒有證明對手必須照走，也沒有單憑第一手就建立某一步必有失誤。' }]
  neutralAnswer.sections[1]!.claims = [{ id: 'N2', evidenceIds: ['E1', 'E2'], findingIds: ['K1'], causal: developmentCausal, text:
    '實戰的炮二平五與首選炮八平五都有控制中路的想法，但控制不等於立即取得攻勢。實戰線中黑方馬8進7、紅方馬二進三、黑方車9平8依次出現，反映双方繼續出子；應將移炮與這些後續位置連起來理解。若要說實戰步比首選更容易受攻，仍缺少能區分兩線的具體攻擊及應對證據，不能由數值觀測自行補出原因。' }]
  neutralAnswer.sections[2]!.claims = [{ id: 'N3', evidenceIds: ['E1'], text:
    '首選炮八平五同樣先成中炮。這條線接著黑方馬2進3、紅方馬八進七、黑方車1平2，紅方再以車九平八調整車路，這些位置變化支持先出馬再出車的部署解讀。它與另一條線在選用的翼側不同，但此處沒有證據說中炮落點更內或更安全；一般出子原則是對這些變化的解釋，不能當成引擎已證明的唯一計畫。' }]
  neutralAnswer.sections[3]!.claims = [
    { id: 'N4a', evidenceIds: ['E2'], findingIds: ['K1'], causal: developmentCausal, text:
      '實戰線的黑方馬8進7離開原位後，黑方車9平8把車移到八路；紅方也有馬二進三與車一平二。這段主線展示兩邊如何調整子力及車路，黑方應手可以合理發展，不應自動解釋成對實戰步的懲罰。紅方後續車二進六把車推前時，仍須觀察對方子力及後續應手，不能把前進本身寫成必定獲利。' },
    { id: 'N4b', evidenceIds: ['E2'], findingIds: ['K2'], causal: {
      cause: '紅方車二進三吃黑車，黑方緊接馬7退8吃紅車',
      mechanism: '兩方的車在相同位置交換，再由黑馬回吃',
      affected: '紅方二路車、黑方車與回吃的黑馬',
      opponentUse: '黑方馬7退8收回剛到該位置的紅車',
      consequence: '車二進三與馬7退8後雙方各少一車'
    }, text: '這條線最後紅方車二進三吃掉黑車，黑方緊接馬7退8吃掉紅車，雙方各少一車。這是交換結果，不能只把第一手吃車算成紅方淨多一車。至於交換後其他棋子的協調與整體優劣，仍需分析相應局面及其他合理應手；吃子帳本能確認數量，不能替長期計畫作保證。' }
  ]
  neutralAnswer.sections[4]!.claims = [{ id: 'N5', evidenceIds: ['E1', 'E2'], text:
    '比較開局著法時，先確認共同落點與保留的子力，再沿各自的對手應手觀察部署和交換。每一項優劣都要指出不同的棋子關係與後續影響；若只有數值觀測，保留已知變化並列出未確認的原因，實戰仍應檢查對手其他可行回應。' }]
  const numericalDifferenceRequirements = { ...initialMoveRequirements, comparisonState: 'evidence_backed_difference' as const }
  const neutralComparisonErrors = validateAnswer(neutralAnswer, neutralEvidence, numericalDifferenceRequirements)
  check('有數值比較分類但尚無獨有優劣機制時，合法兩線的完整中性五段正文可通過',
    countHanCharacters(playerFacingAnswerText(neutralAnswer)) >= 400 && neutralComparisonErrors.length === 0, neutralComparisonErrors)
  const wrongNeutralExchange = structuredClone(neutralAnswer)
  wrongNeutralExchange.sections[3]!.claims[1]!.text =
    wrongNeutralExchange.sections[3]!.claims[1]!.text.replace('雙方各少一車', '紅方淨多一車')
  check('同一中性比較正文改成錯誤交換結論仍拒絕，數值分類不豁免棋盤事實',
    validateAnswer(wrongNeutralExchange, neutralEvidence, numericalDifferenceRequirements)
      .some(error => error.includes('棋盤事實')))
  sameVerdictAnswer.directAnswer = '炮二平五是較差著法，這步是失誤。'
  check('同首選的負面矛盾不能藏在 directAnswer 避過正文檢查',
    validateAnswer(sameVerdictAnswer, sameVerdictEvidence, sameVerdictRequirements)
      .some((error) => error.includes('同一著法')))
  sameVerdictAnswer.directAnswer = '炮二平五與首選一致，不能說這步是失誤。'
  check('同首選澄清不是失誤不會被負評篩選誤擋',
    !validateAnswer(sameVerdictAnswer, sameVerdictEvidence, sameVerdictRequirements)
      .some((error) => error.includes('同一著法')))
  for (const directAnswer of [
    '炮二平五與首選一致，實戰步不是失誤或敗著。',
    '如果實戰步失誤導致更差，還需要後續主線確認。炮二平五在此與首選相同。'
  ]) {
    const scopedVerdictAnswer = structuredClone(sameVerdictAnswer)
    scopedVerdictAnswer.directAnswer = directAnswer
    const errors = validateAnswer(scopedVerdictAnswer, sameVerdictEvidence, sameVerdictRequirements)
    check(`同首選完整五段的否定／條件說明通過正式 validator：${directAnswer}`,
      errors.length === 0, errors)
  }
  for (const directAnswer of [
    '炮二平五不是失誤而是敗著。',
    '炮二平五不是失誤或敗著，但仍是更差的著法。'
  ]) {
    const scopedVerdictAnswer = structuredClone(sameVerdictAnswer)
    scopedVerdictAnswer.directAnswer = directAnswer
    check(`同首選的前句否定不能豁免後續肯定負評：${directAnswer}`,
      validateAnswer(scopedVerdictAnswer, sameVerdictEvidence, sameVerdictRequirements)
        .some(error => error.includes('同一著法')))
  }

  const wrongSideEvidence: HarnessEvidence = {
    ...validatorEvidence[1]!,
    id: 'E4',
    positionFen: START_FEN.replace(' w ', ' b ')
  }
  const wrongSideAnswer = JSON.parse(
    JSON.stringify(normalContractAnswer)
  ) as HarnessAnswer
  wrongSideAnswer.sections[1]!.claims[0]!.evidenceIds = ['E4']
  const wrongSideErrors = validateAnswer(
    wrongSideAnswer,
    [...validatorEvidence, wrongSideEvidence],
    initialMoveRequirements
  )
  check(
    '另一輪走方的證據不能替目前局面主張背書',
    wrongSideErrors.some((error) => error.includes('另一個局面的證據'))
  )

  const unrelatedFindingAnswer = JSON.parse(
    JSON.stringify(normalContractAnswer)
  ) as HarnessAnswer
  const unrelatedCoreClaim = unrelatedFindingAnswer.sections[1]!.claims[0]!
  unrelatedCoreClaim.findingIds = ['K9']
  const unrelatedFinding = makeFinding({
    id: 'K9',
    category: 'piece_restriction',
    summary: '兵三進一後黑方以馬8進7控制河口。',
    opponentUse: '黑方馬8進7後增加中央子力。',
    boardImpact: '兵三進一與馬8進7形成另一條候選變例。',
    supportingMoves: ['兵三進一', '馬8進7'],
    evidenceIds: ['E3']
  })
  const unrelatedFindingErrors = validateAnswer(
    unrelatedFindingAnswer,
    validatorEvidence,
    {
      ...initialMoveRequirements,
      verifiedFindingIds: ['K9'],
      verifiedFindings: [unrelatedFinding]
    }
  )
  check(
    '有效 findingId 搭配無關變例內容仍會被擋下',
    unrelatedFindingErrors.some((error) =>
      error.includes('內容卻沒有連到該 finding 的變例與著法')
    )
  )

  const forcedLineAnswer = JSON.parse(
    JSON.stringify(normalContractAnswer)
  ) as HarnessAnswer
  forcedLineAnswer.directAnswer =
    '馬八進七後黑方被迫只能走馬8進7，這是唯一回應；其餘比較沿用下方引擎主線。'
  const forcedLineErrors = validateAnswer(
    forcedLineAnswer,
    validatorEvidence,
    initialMoveRequirements
  )
  check(
    '單一 PV 不得被寫成被迫、必然或唯一回應',
    forcedLineErrors.some((error) => error.includes('不得把單一引擎主線誇大'))
  )
  for (const text of [
    '主線顯示馬8進7，但不是唯一回應。',
    '不能說黑方被迫走馬8進7，主線只展示其中一種合理選擇。',
    '這不代表黑方只能走馬8進7。',
    '黑方不必被迫走馬8進7。',
    '黑方並不被迫走馬8進7。',
    '黑方馬8進7並未被迫防禦。',
    '黑方沒有被迫防禦。',
    '黑方沒被迫防禦。',
    '黑方未被迫防禦。',
    '黑方並沒有被迫防禦。',
    '紅方從未被迫退車。',
    'The principal variation does not mean Black must play this reply.'
  ]) {
    forcedLineAnswer.directAnswer = text
    check('否定必然應對的澄清不能被誇大斷言篩選誤擋 ' + text,
      !validateAnswer(forcedLineAnswer, validatorEvidence, initialMoveRequirements)
        .some(error => error.includes('不得把單一引擎主線誇大')))
  }
  forcedLineAnswer.directAnswer = '馬8進7不是唯一回應，但黑方被迫走馬2進3。'
  check('否定一句不能豁免另一句肯定的被迫斷言',
    validateAnswer(forcedLineAnswer, validatorEvidence, initialMoveRequirements)
      .some(error => error.includes('不得把單一引擎主線誇大')))
  forcedLineAnswer.directAnswer = '馬8進7不是唯一回應且黑方被迫走馬2進3。'
  check('同一分句的否定不能重用來豁免第二個肯定斷言',
    validateAnswer(forcedLineAnswer, validatorEvidence, initialMoveRequirements)
      .some(error => error.includes('不得把單一引擎主線誇大')))
  forcedLineAnswer.directAnswer = normalContractAnswer.directAnswer
  for (const text of [
    '黑方並未被迫防禦，但紅方被迫退車。',
    '黑方沒有被迫防禦且紅方被迫退車。',
    '黑方沒有吃子但被迫防禦。',
    '黑方未走馬8進7，卻被迫退車。'
  ]) {
    forcedLineAnswer.directAnswer = text
    check('局部否定不能豁免後面的強迫斷言 ' + text,
      validateAnswer(forcedLineAnswer, validatorEvidence, initialMoveRequirements)
        .some(error => error.includes('不得把單一引擎主線誇大')))
  }
  forcedLineAnswer.directAnswer = normalContractAnswer.directAnswer
  forcedLineAnswer.sections[1]!.claims[0]!.causal!.opponentUse = '黑方並未被迫防禦。'
  check('causal 欄位的明確局部否定同樣不被誤擋',
    !validateAnswer(forcedLineAnswer, validatorEvidence, initialMoveRequirements)
      .some(error => error.includes('不得把單一引擎主線誇大')))
  forcedLineAnswer.sections[1]!.claims[0]!.causal!.opponentUse = '黑方被迫走馬8進7。'
  check('隱藏 causal 也不能聲稱主線是被迫應對',
    validateAnswer(forcedLineAnswer, validatorEvidence, initialMoveRequirements)
      .some(error => error.includes('不得把單一引擎主線誇大')))

  const extraSectionAnswer = JSON.parse(
    JSON.stringify(normalContractAnswer)
  ) as HarnessAnswer
  extraSectionAnswer.sections.push({
    id: HARNESS_SECTION_IDS.followUp,
    heading: '追問',
    claims: [{ id: 'EXTRA', text: '這是不應出現在首次完整解說的額外區塊。', evidenceIds: ['E1'] }]
  })
  const extraSectionErrors = validateAnswer(
    extraSectionAnswer,
    validatorEvidence,
    initialMoveRequirements
  )
  check(
    '首次實戰步回答多出任何 known section 都會被擋下',
    extraSectionErrors.some((error) => error.includes('section id 必須正好依序'))
  )

  const emptyPrincipleAnswer = JSON.parse(
    JSON.stringify(normalContractAnswer)
  ) as HarnessAnswer
  const emptyPrinciple = emptyPrincipleAnswer.sections.find(
    (section) =>
      section.id === HARNESS_SECTION_IDS.practicalPrinciple ||
      section.heading.includes('下次遇到類似局面')
  )
  if (emptyPrinciple) emptyPrinciple.claims = []
  const emptyPrincipleErrors = validateAnswer(
    emptyPrincipleAnswer,
    validatorEvidence,
    initialMoveRequirements
  )
  check(
    '實戰原則為空會被擋下',
    emptyPrincipleErrors.some((error) => error.includes('恰好一條非空 claim'))
  )

  const multiplePrinciplesAnswer = JSON.parse(
    JSON.stringify(normalContractAnswer)
  ) as HarnessAnswer
  const multiplePrinciples = multiplePrinciplesAnswer.sections.find(
    (section) =>
      section.id === HARNESS_SECTION_IDS.practicalPrinciple ||
      section.heading.includes('下次遇到類似局面')
  )
  multiplePrinciples?.claims.push({
    id: 'SECOND-PRINCIPLE',
    text: '第二條原則不應混入首次解說。',
    evidenceIds: ['E1']
  })
  const multiplePrincipleErrors = validateAnswer(
    multiplePrinciplesAnswer,
    validatorEvidence,
    initialMoveRequirements
  )
  check(
    '實戰原則多於一條會被擋下',
    multiplePrincipleErrors.some((error) => error.includes('恰好一條非空 claim'))
  )

  const shortContractAnswer = JSON.parse(
    JSON.stringify(normalContractAnswer)
  ) as HarnessAnswer
  shortContractAnswer.directAnswer = '馬八進七錯失炮二平五先控中路。'
  for (const section of shortContractAnswer.sections) {
    for (const claim of section.claims) {
      claim.text =
        section.id === HARNESS_SECTION_IDS.practicalPrinciple ||
        section.heading.includes('下次遇到類似局面')
          ? '先檢查中路。'
          : '炮二平五優於馬八進七，黑方接著馬8進7。'
    }
  }
  const shortContractErrors = validateAnswer(
    shortContractAnswer,
    validatorEvidence,
    initialMoveRequirements
  )
  check(
    '形式齊全但不足 400 漢字的短答會被擋下並回報實際字數',
    shortContractErrors.some(
      (error) => error.includes('至少需要 400 個漢字') && error.includes('正文只有')
    )
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
    '首次比較不進入等待確認或逾時保守版',
    Boolean(
      timeoutResult &&
        timeoutTraces[0]?.engineRounds === 0 &&
        !timeoutResult.finalText.includes('等待使用者確認')
    )
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
    scoreSignatureResult.finalText.includes('AI 首選')
  )

  // 具體後果存在，但單次合併回答不完整時不得用固定模板冒充完整解說。
  const writerBudgetProvider = new WriterBudgetProvider()
  const writerBudgetTraces: HarnessTrace[] = []
  let writerBudgetError: unknown = null
  try {
    await runExplanationHarness(
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
  check(
    '單次合併回答不完整時明確失敗，不交付固定模板',
    writerBudgetError instanceof Error &&
      writerBudgetError.message.includes('沒有通過棋理與證據檢查'),
    writerBudgetError
  )
  check(
    '不完整首答只呼叫一次模型，不進入無界修正迴圈',
    writerBudgetProvider.calls === 1
  )
  check(
    '不完整首答 trace 標示 failed 且沒有玩家可見正文',
    writerBudgetTraces[0]?.status === 'failed' &&
      writerBudgetTraces[0]?.finalText === undefined
  )

  const outputTokenBoundaryProvider = new OutputTokenBoundaryProvider()
  let outputTokenBoundaryError: unknown
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-output-token-boundary',
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
          maxOutputTokens: 25
        }
      },
      {
        provider: outputTokenBoundaryProvider,
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
        onProgress: () => undefined
      }
    )
  } catch (error) {
    outputTokenBoundaryError = error
  }
  check(
    '每次 provider 請求的 maxOutputTokens 不會高於整輪真正剩餘額度',
    outputTokenBoundaryProvider.requestedMaxTokens.length === 1 &&
      outputTokenBoundaryProvider.requestedMaxTokens[0] === 25,
    outputTokenBoundaryProvider.requestedMaxTokens.join(',')
  )
  check(
    '輸出額度不足時不追加內容修正呼叫，也不交付保守模板',
    outputTokenBoundaryProvider.calls === 1 &&
      outputTokenBoundaryError instanceof Error &&
      outputTokenBoundaryError.message.includes('沒有通過棋理與證據檢查')
  )
  const failedAuditBudgets: number[] = []
  const failedAuditProvider = {
    id: 'openai' as const,
    displayName: 'Failed audit budget probe',
    generateExplanation: async (request: { maxOutputTokens?: number }) => {
      failedAuditBudgets.push(request.maxOutputTokens ?? -1)
      if (failedAuditBudgets.length === 1) {
        throw new AIResponseValidationError(
          'generation', 'generation_incomplete', 'Output reached its limit.',
          { reason: 'output_truncated', finishReason: 'length', outputTokens: 3_000 }
        )
      }
      return {
        text: '{}', provider: 'openai' as const, model: 'fake-model',
        createdAt: Date.now(), groundedOnEngineData: true as const,
        usage: { inputTokens: 10, outputTokens: 10 }
      }
    },
    async *generateExplanationStream(): AsyncIterable<never> { return }
  }
  try {
    await runExplanationHarness(
      {
        requestId: 'failed-audit-budget', analysisId: noMoveSession.analysisId,
        provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
        explanationStyle: 'long_analytical', language: 'zh-TW',
        answerMode: 'research', followUpQuestion: '請完整解釋目前局面',
        budget: { engineTimeMs: 100, maxEngineRounds: 1, maxModelCalls: 2, maxOutputTokens: 4_000 }
      },
      {
        provider: failedAuditProvider, apiKey: 'synthetic-test-key', model: 'fake-model',
        session: noMoveSession,
        registry: {
          list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }),
          getAdapter: () => null
        } as never,
        traceStore: { save: () => undefined } as never,
        signal: new AbortController().signal, onProgress: () => undefined
      }
    )
  } catch {
    // This probe exercises budgeting, not answer acceptance.
  }
  check(
    '截斷的審核呼叫已消耗 3000 tokens，後續寫作只能使用剩餘 1000',
    failedAuditBudgets.length === 2 &&
      failedAuditBudgets[0] === 3_000 &&
      failedAuditBudgets[1] === 1_000,
    failedAuditBudgets.join(',')
  )

  console.log('\n## 一鍵品質收斂（loop engineering）')

  // 一個區塊空泛：只許一次有明確診斷的整份修補，仍不交付空泛內容。
  const rewriteProvider = new RewriteLoopProvider()
  const rewriteProgress: Array<Omit<HarnessProgressPayload, 'requestId'>> = []
  let rewriteError: unknown
  try {
    await runExplanationHarness(
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
  } catch (error) {
    rewriteError = error
  }
  check(
    '空泛首答最多啟動一次有界修補呼叫',
    rewriteProvider.calls === 2,
    rewriteProvider.calls
  )
  check(
    '一鍵首答空泛時明確失敗，不把空泛文字或替代模板交付棋手',
    rewriteError instanceof Error &&
      rewriteError.message.includes('沒有通過棋理與證據檢查')
  )
  check(
    '一鍵首答失敗只回報實際啟動的一次修補',
    rewriteProgress.filter((item) => item.phase === 'repairing').length === 1
  )

  const validRepairText = (await new SameMoveProvider().generateExplanation({ prompt: '' })).text
  const invalidRepairDraft = JSON.parse(validRepairText) as {
    audit: ConsequenceAudit; answer: HarnessAnswer
  }
  invalidRepairDraft.answer.sections[3]!.claims[0]!.text = '黑方大致有機會。'
  const repairSuccessProvider = {
    id: 'openai' as const,
    displayName: 'Fake successful combined repair',
    calls: 0,
    prompts: [] as string[],
    async generateExplanation(request: { prompt: string; maxOutputTokens?: number }) {
      this.calls++
      this.prompts.push(request.prompt)
      return {
        text: this.calls === 1 ? JSON.stringify(invalidRepairDraft) : validRepairText,
        provider: 'openai' as const,
        model: 'fake-model',
        createdAt: Date.now(),
        groundedOnEngineData: true as const,
        usage: { inputTokens: 10, outputTokens: 20 }
      }
    },
    async *generateExplanationStream(): AsyncIterable<never> { return }
  }
  const repairedTraces: HarnessTrace[] = []
  let repairedResult: Awaited<ReturnType<typeof runExplanationHarness>> | null = null
  try { repairedResult = await runExplanationHarness(
    {
      requestId: 'ai-request-combined-repair-success',
      analysisId: sameMoveSession.analysisId,
      provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
      explanationStyle: 'long_analytical', language: 'zh-TW',
      attachedMove: sameMoveAnalysis.userMove,
      answerMode: 'research',
      budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 3, maxOutputTokens: 8000 }
    },
    {
      provider: repairSuccessProvider,
      apiKey: 'synthetic-test-key', model: 'fake-model', session: sameMoveSession,
      registry: {
        list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }),
        getAdapter: () => null
      } as never,
      traceStore: { save: (trace: HarnessTrace) => repairedTraces.push(trace) } as never,
      signal: new AbortController().signal, onProgress: () => undefined
    }
  ) } catch { /* The assertion reports the validator errors below. */ }
  check(
    '審核與正文修補後仍由正式 validator 驗收完整五段',
    repairSuccessProvider.calls === 2 &&
      repairSuccessProvider.prompts[1]?.includes('錯誤：') &&
      repairSuccessProvider.prompts[1]?.includes('"computedBoardFacts"') &&
      repairedTraces[0]?.modelCallDiagnostics?.[1]?.stage === 'repair' &&
      repairedResult !== null &&
      countHanCharacters(repairedResult.finalText) >= 400 &&
      repairedTraces[0]?.status === 'completed',
    JSON.stringify({ calls: repairSuccessProvider.calls, errors: repairedTraces[0]?.validationErrors })
  )
  check('修補只使用一份首選與實戰逐手來源，避免重複主線造成混淆',
    (repairSuccessProvider.prompts[1]?.match(/"role":"best_move"/g)?.length ?? 0) === 1 &&
      (repairSuccessProvider.prompts[1]?.match(/"role":"user_move"/g)?.length ?? 0) === 1)
  check('正式整份修補沿用棋規與交換摘要，無第二套省略規則的提示',
    ['象眼', '馬腿', '恰好一枚', '不能後退', '吃子摘要只涵蓋']
      .every(rule => repairSuccessProvider.prompts[1]?.includes(rule)))
  check('中性比較的提示與修補診斷不再強迫描述變差',
    !repairSuccessProvider.prompts[1]?.includes('後續具體變差在哪裡') &&
      !repairSuccessProvider.prompts[1]?.includes('必須說出具體變差在哪裡'))
  check(
    '修補保留失敗診斷與原局面但不回灌被拒絕的草稿斷言',
    repairSuccessProvider.prompts[1]?.includes('錯誤：') &&
      !repairSuccessProvider.prompts[1]?.includes('黑方大致有機會。') &&
      repairSuccessProvider.prompts[1]?.includes('direct_conclusion')
  )

  for (const budgetScenario of ['reported_usage', 'missing_usage', 'transport_failure'] as const) {
    const reportsUsage = budgetScenario === 'reported_usage'
    const requests: number[] = []
    const budgetTraces: HarnessTrace[] = []
    const budgetProvider: AIProvider = {
      id: 'openai', displayName: 'Combined response budget boundary fixture',
      async generateExplanation(request) {
        requests.push(request.maxOutputTokens ?? -1)
        if (budgetScenario === 'transport_failure' && requests.length === 1) throw new TypeError('fetch failed')
        return { text: requests.length === 1 ? JSON.stringify(invalidRepairDraft) : validRepairText,
          provider: 'openai', model: 'fake-model', createdAt: Date.now(), groundedOnEngineData: true,
          ...(reportsUsage ? { usage: { inputTokens: 10, outputTokens: requests.length === 1 ? 6_000 : 4_000 } } : {}) }
      },
      async *generateExplanationStream(): AsyncIterable<never> { return }
    }
    const budgetResult = await runExplanationHarness({
      requestId: `combined-budget-${budgetScenario}`, analysisId: sameMoveSession.analysisId,
      provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
      explanationStyle: 'long_analytical', language: 'zh-TW', attachedMove: sameMoveAnalysis.userMove,
      answerMode: 'research',
      budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 3, maxOutputTokens: 10_000 }
    }, {
      provider: budgetProvider, apiKey: 'synthetic-test-key', model: 'fake-model', session: sameMoveSession,
      registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
      traceStore: { save: trace => budgetTraces.push(trace) } as never,
      signal: new AbortController().signal, onProgress: () => undefined
    })
    check(`combined JSON has a bounded allocation and repair/retry shares the 10000 total (${budgetScenario})`,
      requests.join(',') === '6000,4000' && countHanCharacters(budgetResult.finalText) >= 400 &&
      budgetTraces[0]?.modelCalls === 2)
    check(`budget accounting never invents unreported provider token usage (${budgetScenario})`,
      reportsUsage ? budgetResult.usage?.outputTokens === 10_000
        : budgetResult.usage === undefined && budgetTraces[0]?.modelCallDiagnostics?.every(call => call.outputTokens === undefined) === true)
  }

  for (const budgetCase of [{ mode: 'quick' as const, tokens: 4000 }, { mode: 'research' as const, tokens: 6000 }]) {
    const originalNetworkError = new TypeError('fetch failed')
    let attemptedCalls = 0
    let unavailableError: unknown
    const unavailableTraces: HarnessTrace[] = []
    const unavailableProgress: HarnessProgressPayload[] = []
    const unavailableProvider: AIProvider = {
      id: 'openai', displayName: 'Network failure with no remaining tokens',
      async generateExplanation() { attemptedCalls += 1; throw originalNetworkError },
      async *generateExplanationStream(): AsyncIterable<never> { return }
    }
    try {
      await runExplanationHarness({
        requestId: `network-budget-${budgetCase.mode}`, analysisId: sameMoveSession.analysisId,
        provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
        explanationStyle: 'long_analytical', language: 'zh-TW', attachedMove: sameMoveAnalysis.userMove,
        answerMode: budgetCase.mode,
        budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 3, maxOutputTokens: budgetCase.tokens }
      }, {
        provider: unavailableProvider, apiKey: 'synthetic-test-key', model: 'fake-model', session: sameMoveSession,
        registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
        traceStore: { save: trace => unavailableTraces.push(trace) } as never,
        signal: new AbortController().signal, onProgress: progress => unavailableProgress.push(progress)
      })
    } catch (error) { unavailableError = error }
    check(`exhausted token reservation preserves the actual network failure (${budgetCase.mode})`,
      unavailableError === originalNetworkError && unavailableTraces[0]?.providerDiagnostic?.category === 'network')
    check(`exhausted token reservation does not promise or issue a retry (${budgetCase.mode})`,
      attemptedCalls === 1 && !unavailableProgress.some(progress => progress.phase === 'provider_retry'))
  }

  const originalFetch = globalThis.fetch
  const partialUsageRequests: number[] = []
  const partialUsageTraces: HarnessTrace[] = []
  const partialUsageModel = 'nvidia/nemotron-3-super-120b-a12b:free'
  try {
    globalThis.fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as { max_tokens: number }
      partialUsageRequests.push(requestBody.max_tokens)
      return new Response(JSON.stringify({
        model: partialUsageModel,
        choices: [{ message: { content: partialUsageRequests.length === 1 ? JSON.stringify(invalidRepairDraft) : validRepairText }, finish_reason: 'stop' }],
        usage: partialUsageRequests.length === 1 ? { prompt_tokens: 10 } : { prompt_tokens: 20, completion_tokens: 500 }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const partialUsageResult = await runExplanationHarness({
      requestId: 'partial-provider-usage-budget', analysisId: sameMoveSession.analysisId,
      provider: 'openrouter', model: partialUsageModel, userLevel: 'intermediate',
      explanationStyle: 'long_analytical', language: 'zh-TW', attachedMove: sameMoveAnalysis.userMove,
      answerMode: 'research',
      budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 3, maxOutputTokens: 10_000 }
    }, {
      provider: new OpenRouterProvider(), apiKey: 'synthetic-test-key', model: partialUsageModel, session: sameMoveSession,
      registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
      traceStore: { save: trace => partialUsageTraces.push(trace) } as never,
      signal: new AbortController().signal, onProgress: () => undefined
    })
    check('partial OpenRouter usage reserves unknown completion before a formally validated repair',
      partialUsageRequests.join(',') === '6000,4000' && countHanCharacters(partialUsageResult.finalText) >= 400)
    check('partial OpenRouter usage preserves reported input and finish but never invents aggregate output',
      partialUsageResult.usage?.inputTokens === 30 && partialUsageResult.usage.outputTokens === undefined &&
      partialUsageTraces[0]?.modelCallDiagnostics?.[0]?.outputTokens === undefined &&
      partialUsageTraces[0]?.modelCallDiagnostics?.[0]?.finishReason === 'stop' &&
      partialUsageTraces[0]?.modelCallDiagnostics?.[1]?.outputTokens === 500)
  } finally { globalThis.fetch = originalFetch }

  const reportedThenMissingRequests: number[] = []
  const reportedThenMissingTraces: HarnessTrace[] = []
  try {
    globalThis.fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as { max_tokens: number }
      reportedThenMissingRequests.push(requestBody.max_tokens)
      return new Response(JSON.stringify({
        model: partialUsageModel,
        choices: [{ message: { content: reportedThenMissingRequests.length === 1 ? JSON.stringify(invalidRepairDraft) : validRepairText } }],
        ...(reportedThenMissingRequests.length === 1 ? { usage: { prompt_tokens: 10, completion_tokens: 500 } } : {})
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const reportedThenMissingResult = await runExplanationHarness({
      requestId: 'reported-then-missing-provider-usage', analysisId: sameMoveSession.analysisId,
      provider: 'openrouter', model: partialUsageModel, userLevel: 'intermediate',
      explanationStyle: 'long_analytical', language: 'zh-TW', attachedMove: sameMoveAnalysis.userMove,
      answerMode: 'research',
      budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 3, maxOutputTokens: 10_000 }
    }, {
      provider: new OpenRouterProvider(), apiKey: 'synthetic-test-key', model: partialUsageModel, session: sameMoveSession,
      registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
      traceStore: { save: trace => reportedThenMissingTraces.push(trace) } as never,
      signal: new AbortController().signal, onProgress: () => undefined
    })
    check('missing repair usage clears apparent complete aggregate totals but retains first-call evidence',
      reportedThenMissingResult.usage?.inputTokens === undefined && reportedThenMissingResult.usage?.outputTokens === undefined &&
      reportedThenMissingTraces[0]?.modelCallDiagnostics?.[0]?.outputTokens === 500 &&
      reportedThenMissingTraces[0]?.modelCallDiagnostics?.[1]?.outputTokens === undefined &&
      countHanCharacters(reportedThenMissingResult.finalText) >= 400)
  } finally { globalThis.fetch = originalFetch }

  const compactCombined = JSON.parse(validRepairText) as { audit: ConsequenceAudit; answer: HarnessAnswer }
  const originalConsequenceClaim = compactCombined.answer.sections[3]!.claims[0]!
  const secondFinding = compactCombined.audit.consequences[1]!
  compactCombined.answer.sections[3]!.claims = [
    { ...originalConsequenceClaim, id: 'C4a', findingIds: ['K1'] },
    {
      ...originalConsequenceClaim, id: 'C4b', findingIds: ['K2'],
      text: `${secondFinding.supportingMoves.join('、')}：${secondFinding.summary}${secondFinding.boardImpact}`,
      causal: { ...originalConsequenceClaim.causal!, opponentUse: secondFinding.opponentUse, consequence: secondFinding.boardImpact }
    }
  ]
  const compactAudit = {
    ...compactCombined.audit,
    consequences: compactCombined.audit.consequences.map((finding, index) => ({
      id: finding.id, category: finding.category, claimId: index === 0 ? 'C4a' : 'C4b', verified: true
    }))
  }
  const compactProvider = {
    id: 'openai' as const, displayName: 'Complete answer with compact audit references', calls: 0,
    async generateExplanation() {
      this.calls++
      return { text: JSON.stringify({ answer: compactCombined.answer, audit: compactAudit }), provider: this.id,
        model: 'fake-model', usage: { inputTokens: 100, outputTokens: 2000 } }
    },
    async *generateExplanationStream(): AsyncIterable<never> { return }
  }
  let compactResult: Awaited<ReturnType<typeof runExplanationHarness>> | null = null
  const compactTraces: HarnessTrace[] = []
  const runCompactScenario = async (): Promise<void> => {
    compactResult = null
    compactProvider.calls = 0
    compactTraces.length = 0
    try {
    compactResult = await runExplanationHarness({
      requestId: 'compact-audit-full-body', analysisId: sameMoveSession.analysisId,
      provider: 'openai', model: 'fake-model', userLevel: 'intermediate', explanationStyle: 'long_analytical',
      language: 'zh-TW', answerMode: 'research', attachedMove: 'h2e2',
      budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 2, maxOutputTokens: 8000 }
    }, {
      provider: compactProvider, apiKey: 'synthetic-test-key', model: 'fake-model', session: sameMoveSession,
      registry: { list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }), getAdapter: () => null } as never,
      traceStore: { save: (trace: HarnessTrace) => compactTraces.push(trace) } as never,
      signal: new AbortController().signal, onProgress: () => undefined
    })
    } catch { /* The assertion exposes the actual validator verdict. */ }
  }
  await runCompactScenario()
  check('完整正文可用 audit claim 引用通過同一正式審查，沒有補字或省略因果',
    compactProvider.calls === 1 && compactResult !== null && countHanCharacters(compactResult.finalText) >= 400,
    compactTraces.at(-1)?.validationErrors)
  compactAudit.consequences[1]!.claimId = 'missing-claim'
  await runCompactScenario()
  check('不存在的 audit claim 引用不能填造後果或交付正文', compactResult === null && compactProvider.calls === 2)
  compactAudit.consequences[1]!.claimId = 'C4a'
  await runCompactScenario()
  check('同一 claim 不能冒充兩個不同後果', compactResult === null && compactProvider.calls === 2)
  compactAudit.consequences[1]!.claimId = 'C4b'
  const originalCompactCausal = compactCombined.answer.sections[3]!.claims[1]!.causal
  const originalCompactEvidenceIds = compactCombined.answer.sections[3]!.claims[1]!.evidenceIds
  compactCombined.answer.sections[3]!.claims[1]!.evidenceIds = ['E404']
  await runCompactScenario()
  check('compact audit 不能用不在本次證據內的引用替實戰後果背書', compactResult === null && compactProvider.calls === 2)
  compactCombined.answer.sections[3]!.claims[1]!.evidenceIds = originalCompactEvidenceIds
  delete compactCombined.answer.sections[3]!.claims[1]!.causal
  await runCompactScenario()
  check('compact audit 不替缺少 causal 的正文補造因果', compactResult === null && compactProvider.calls === 2)
  compactCombined.answer.sections[3]!.claims[1]!.causal = originalCompactCausal

  const repairOutageProvider = {
    id: 'openai' as const,
    displayName: 'Fake repair outage',
    calls: 0,
    async generateExplanation() {
      this.calls++
      if (this.calls > 1) throw new AIHttpError(503, 'generation', 'Provider unavailable (503)')
      return {
        text: JSON.stringify(invalidRepairDraft), provider: 'openai' as const,
        model: 'fake-model', createdAt: Date.now(), groundedOnEngineData: true as const,
        usage: { inputTokens: 10, outputTokens: 20 }
      }
    },
    async *generateExplanationStream(): AsyncIterable<never> { return }
  }
  const repairOutageTraces: HarnessTrace[] = []
  let repairOutageError: unknown
  try {
    await runExplanationHarness(
      {
        requestId: 'ai-request-repair-outage', analysisId: sameMoveSession.analysisId,
        provider: 'openai', model: 'fake-model', userLevel: 'intermediate',
        explanationStyle: 'long_analytical', language: 'zh-TW',
        attachedMove: sameMoveAnalysis.userMove, answerMode: 'research',
        budget: { engineTimeMs: 3000, maxEngineRounds: 1, maxModelCalls: 3, maxOutputTokens: 8000 }
      },
      {
        provider: repairOutageProvider, apiKey: 'synthetic-test-key', model: 'fake-model',
        session: sameMoveSession,
        registry: {
          list: () => ({ installations: [], activeEngineId: 'engine-1', verificationEngineId: null }),
          getAdapter: () => null
        } as never,
        traceStore: { save: (trace: HarnessTrace) => repairOutageTraces.push(trace) } as never,
        signal: new AbortController().signal, onProgress: () => undefined
      }
    )
  } catch (error) { repairOutageError = error }
  check(
    '修補階段 503 保留服務錯誤分類，不能吞成正文品質失敗',
    repairOutageError instanceof AIHttpError &&
      repairOutageError.status === 503 &&
      repairOutageProvider.calls === 2 &&
      repairOutageTraces[0]?.providerDiagnostic?.category === 'provider_unavailable',
    JSON.stringify({ calls: repairOutageProvider.calls, error: repairOutageError instanceof Error ? repairOutageError.name : null,
      diagnostic: repairOutageTraces[0]?.providerDiagnostic })
  )

  // 模型第二次仍空泛時，不得進入第三次內容重試。
  const stubbornProvider = new StubbornVagueProvider()
  const stubbornTraces: HarnessTrace[] = []
  let stubbornError: unknown
  try {
    await runExplanationHarness(
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
  } catch (error) {
    stubbornError = error
  }
  check(
    '初次內容不合格且修補仍錯 → 恰好兩次模型呼叫後停止',
    stubbornProvider.calls === 2,
    stubbornProvider.calls
  )
  check(
    '首輪不合格後回傳可重試失敗，不交付引擎證據模板',
    stubbornError instanceof Error &&
      stubbornError.message.includes('沒有通過棋理與證據檢查')
  )
  check(
    'trace 記錄未交付模板的品質失敗原因',
    stubbornTraces[0]?.status === 'failed' &&
    (stubbornTraces[0]?.validationErrors ?? []).some((error) =>
      error.includes('未交付五段模板')
    )
  )

  const verificationScore = convertCpScore(-120, 'score cp -120')
  const verificationAnalysis: EngineAnalysis = {
    ...engineAnalysis,
    engineId: 'engine-2',
    engineName: 'Verification Engine',
    bestMove: 'b0c2',
    displayBestMove: '馬八進七',
    scoreAfterBestMove: verificationScore,
    evaluationAfterBestMove: verificationScore.comparableValue,
    principalVariation: ['b0c2', 'h9g7', 'h2e2', 'b9c7'],
    displayPrincipalVariation: ['馬八進七', '馬8進7', '炮二平五', '馬2進3']
  }
  const dualComparison = buildDualEngineComparison(
    engineAnalysis,
    verificationAnalysis
  )
  const dualEvidence: HarnessEvidence[] = [
    {
      id: 'E1',
      engineId: 'engine-1',
      engineName: engineAnalysis.engineName,
      purpose: '主引擎根局面',
      positionFen: START_FEN,
      depth: engineAnalysis.depth,
      score: engineAnalysis.scoreAfterBestMove,
      displayPrincipalVariation:
        engineAnalysis.displayPrincipalVariation ?? [],
      analysis: engineAnalysis
    },
    {
      id: 'E2',
      engineId: 'engine-1',
      engineName: engineAnalysis.engineName,
      purpose: '主引擎使用者著法',
      positionFen: START_FEN,
      move: engineAnalysis.userMove,
      displayMove: engineAnalysis.displayUserMove,
      depth: engineAnalysis.depth,
      score: engineAnalysis.scoreAfterUserMove,
      displayPrincipalVariation:
        engineAnalysis.displayUserMovePrincipalVariation ?? [],
      analysis: engineAnalysis
    },
    {
      id: 'E3',
      engineId: 'engine-2',
      engineName: verificationAnalysis.engineName,
      purpose: '複核引擎根局面',
      positionFen: START_FEN,
      depth: verificationAnalysis.depth,
      score: verificationAnalysis.scoreAfterBestMove,
      displayPrincipalVariation:
        verificationAnalysis.displayPrincipalVariation ?? [],
      analysis: verificationAnalysis
    }
  ]
  const dualAudit: ConsequenceAudit = {
    ...(JSON.parse(GOOD_AUDIT_JSON) as ConsequenceAudit),
    dualEngineAdjudication: {
      preferredMove: 'h2e2',
      preferredDisplayMove: '炮二平五',
      verdict: 'primary',
      humanControlComparison:
        '炮二平五的中路計畫較直接、分支較少且較可控；馬八進七容錯較低，若後續沒有補中炮容易讓對手完成部署而走歪。',
      longTermComparison:
        '炮二平五後續先限制中卒並保留中路攻勢；馬八進七的長期發展會讓黑方雙馬先完成部署，紅方子力與陣形節奏落後。',
      decisionReason:
        '兩條線都能走，但炮二平五的計畫較容易由人類控盤，馬八進七則需要後續精準補回中路。',
      evidenceIds: ['E1', 'E3']
    }
  }
  const dualAuditErrors = validateConsequenceAudit(
    dualAudit,
    dualEvidence,
    true,
    dualComparison, 'zh-TW', 'evidence_backed_difference'
  )
  check(
    '雙引擎裁決同時比較可控性、長期發展與兩邊證據時通過',
    dualAuditErrors.length === 0,
    dualAuditErrors.join('；')
  )
  const scoreOnlyDualAudit: ConsequenceAudit = {
    ...dualAudit,
    dualEngineAdjudication: {
      ...dualAudit.dualEngineAdjudication!,
      humanControlComparison: '炮二平五分數比較高，所以比馬八進七好。',
      longTermComparison: '炮二平五後續分數高，馬八進七分數低。',
      decisionReason: '因為引擎分數較高。',
      evidenceIds: ['E1']
    }
  }
  const scoreOnlyErrors = validateConsequenceAudit(
    scoreOnlyDualAudit,
    dualEvidence,
    true,
    dualComparison
  )
  check(
    '雙引擎裁決只講分數或只引用單一引擎時會被擋下',
    scoreOnlyErrors.some((error) => error.includes('分數')) &&
      scoreOnlyErrors.some((error) => error.includes('兩個不同引擎')),
    scoreOnlyErrors.join('；')
  )

  console.log(`結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exitCode = 1
}

void main()
