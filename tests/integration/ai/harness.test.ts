import type { AIProvider } from '../../../src/shared/types/AIProviderTypes'
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
  runExplanationHarness,
  validateAnswer,
  validateConsequenceAudit
} from '../../../src/main/ai/HarnessOrchestrator'
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

  constructor(private readonly ensureCompleteDepth = true) {}

  async generateExplanation(request: { prompt: string }) {
    this.calls++
    this.prompts.push(request.prompt)
    const outputs = [
      '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E1"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E1"],"verified":true}],"contradictions":[],"enoughEvidence":true}',
      '{"mode":"research","title":"你問我答：著法分析","directAnswer":"馬八進七先走，錯過炮二平五立即控制中路的機會；黑方可趁機完成兩翼馬的部署，使紅方之後補走中炮時已失去先手。","directAnswerEvidenceIds":["E1"],"sections":[{"heading":"問：最佳著法想做什麼？","claims":[{"id":"C1","text":"炮二平五立即控制中路並保留先手。","evidenceIds":["E1"]}]},{"heading":"問：你的著法錯失什麼？","claims":[{"id":"C2","text":"馬八進七先出子，錯過立即控制中路的時機。","evidenceIds":["E1"],"causal":{"cause":"因為先走馬八進七而不是炮二平五","mechanism":"開局第一時間的中路壓制被推遲","affected":"紅方中炮與中路攻勢","opponentUse":"黑方趁機馬8進7完成出子","consequence":"紅方補走炮二平五時黑方已多完成一步部署"}}]},{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方以馬8進7和馬2進3完成兩翼馬部署。","evidenceIds":["E1"],"causal":{"cause":"因為馬八進七沒有立即施壓","mechanism":"黑方獲得連續出子的節奏，完成兩翼部署","affected":"黑方雙馬與整體陣形","opponentUse":"黑方接連走馬8進7與馬2進3","consequence":"黑方陣形完整，紅方中路計畫慢一拍"}}]},{"heading":"問：後續主線與具體後果是什麼？","claims":[{"id":"C4","text":"馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3；結果是紅方中路計畫延後，黑方多完成一步部署。","evidenceIds":["E1"],"causal":{"cause":"因為馬八進七後黑方馬8進7","mechanism":"紅方被迫在第三手才補炮二平五控制中路","affected":"紅方中路與先手節奏","opponentUse":"黑方再走馬2進3補齊另一翼","consequence":"黑方多完成一步部署，紅方攻勢延後"}}]},{"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[{"id":"C5","text":"炮二平五先控制中路；馬八進七則讓黑方先完成出子，之後紅方仍要補走中炮。","evidenceIds":["E1"],"causal":{"cause":"因為炮二平五與馬八進七的次序互換","mechanism":"中路控制與出子節奏易手","affected":"紅方先手與黑方陣形","opponentUse":"黑方按馬8進7、馬2進3從容應對","consequence":"紅方需要多花一手補回中炮，黑方部署領先"}}]},{"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[{"id":"C6","text":"先問是否有需要立即爭取的中路或先手機會，再檢查普通出子是否會讓對手從容部署。","evidenceIds":["E1"]}]}],"generalNotes":["一般而言，先出正馬再補中炮，容易讓對手搶先完成部署。"],"warnings":[]}',
      '{"unsupportedClaimIds":[],"reasons":[]}'
    ]
    return {
      text:
        this.calls === 1
          ? combineAuditAndAnswer(
              outputs[0],
              outputs[1],
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
      text:
        this.calls === 1
          ? combineAuditAndAnswer(outputs[1], outputs[2])
          : outputs[3] ?? '{}',
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
  '{"bestMovePurpose":"炮二平五立即控制中路並保留先手。","userMoveProblem":"馬八進七先出子，錯過立即控制中路的機會。","consequences":[{"id":"K1","category":"initiative_loss","summary":"紅方失去立即控制中路的先手。","opponentUse":"黑方以馬8進7順利完成出子。","boardImpact":"紅方之後仍要補走炮二平五，等於讓黑方多完成一步部署。","supportingMoves":["馬八進七","馬8進7","炮二平五"],"evidenceIds":["E1"],"verified":true},{"id":"K2","category":"opponent_development","summary":"黑方獲得從容部署另一匹馬的時間。","opponentUse":"黑方接著走馬2進3，兩翼馬都完成發展。","boardImpact":"紅方補走炮二平五後中路計畫延後，黑方陣形更完整。","supportingMoves":["炮二平五","馬2進3"],"evidenceIds":["E1"],"verified":true}],"contradictions":[],"enoughEvidence":true}'

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
      text: JSON.stringify(FOLLOW_UP_WRITER_JSON),
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
  '{"mode":"research","title":"你問我答：著法分析","directAnswer":"馬八進七先走，錯過炮二平五立即控制中路的機會；黑方可趁機完成兩翼馬的部署，使紅方之後補走中炮時已失去先手。","directAnswerEvidenceIds":["E1"],"sections":[{"heading":"問：最佳著法想做什麼？","claims":[{"id":"C1","text":"炮二平五立即控制中路並保留先手。","evidenceIds":["E1"]}]},{"heading":"問：你的著法錯失什麼？","claims":[{"id":"C2","text":"馬八進七先出子，錯過立即控制中路的時機。","evidenceIds":["E1"],"causal":{"cause":"因為先走馬八進七而不是炮二平五","mechanism":"開局第一時間的中路壓制被推遲","affected":"紅方中炮與中路攻勢","opponentUse":"黑方趁機馬8進7完成出子","consequence":"紅方補走炮二平五時黑方已多完成一步部署"}}]},{"heading":"問：對手如何利用？","claims":[{"id":"C3","text":"黑方大致上可以獲得不錯的機會。","evidenceIds":["E1"]}]},{"heading":"問：後續主線與具體後果是什麼？","claims":[{"id":"C4","text":"馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3；結果是紅方中路計畫延後，黑方多完成一步部署。","evidenceIds":["E1"],"causal":{"cause":"因為馬八進七後黑方馬8進7","mechanism":"紅方被迫在第三手才補炮二平五控制中路","affected":"紅方中路與先手節奏","opponentUse":"黑方再走馬2進3補齊另一翼","consequence":"黑方多完成一步部署，紅方攻勢延後"}}]},{"heading":"問：兩種著法完整比較後，差別在哪裡？","claims":[{"id":"C5","text":"炮二平五先控制中路；馬八進七則讓黑方先完成出子，之後紅方仍要補走中炮。","evidenceIds":["E1"],"causal":{"cause":"因為炮二平五與馬八進七的次序互換","mechanism":"中路控制與出子節奏易手","affected":"紅方先手與黑方陣形","opponentUse":"黑方按馬8進7、馬2進3從容應對","consequence":"紅方需要多花一手補回中炮，黑方部署領先"}}]},{"heading":"問：下次遇到類似局面要先問自己什麼？","claims":[{"id":"C6","text":"先問是否有需要立即爭取的中路或先手機會，再檢查普通出子是否會讓對手從容部署。","evidenceIds":["E1"]}]}],"generalNotes":[],"warnings":[]}'

const FIXED_OPPONENT_SECTION_JSON = JSON.stringify({
  sections: [
    {
      id: HARNESS_SECTION_IDS.opponentExploitation,
      heading: '對手利用與後果',
      claims: [
        {
          id: 'C3',
          text: `黑方以馬8進7搶先出子，再馬2進3完成兩翼部署。${DEEP_INITIAL_EXPLANATION_EXTENSION}`,
          evidenceIds: ['E1'],
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
  check('PromptBuilder 實際納入既有對話', explanationPrompt.includes('Previous coach context marker'))
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
      onProgress: (event) => initialProgressEvents.push(event),
      explanationPrompt
    }
  )

  check('首次實戰步比較以一次結構化模型呼叫同時完成審查與寫作', provider.calls === 1)
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
    '首次比較 prompt 禁止把跨引擎分歧或主線外後續寫成確定事實',
    provider.prompts[0]?.includes('若兩個引擎的對手首應不同') &&
      provider.prompts[0]?.includes('主線未出現的後續不得寫成已經發生') &&
      provider.prompts[0]?.includes('避免「完全、全面、嚴重、必然」等誇大語氣')
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
  check('棋手正文不顯示證據編號', !result.finalText.includes('[E1]'))
  check('回答先顯示直接結論', result.finalText.indexOf('### 直接結論') < result.finalText.indexOf('### 實戰步問題'))
  check('回答使用五個具名內容區塊', ['直接結論', '實戰步問題', 'AI 首選', '對手利用與後果', '實戰原則'].every((heading) => result.finalText.includes(`### ${heading}`)))
  check(
    '首次實戰步 render 正好只有五個棋手標題且順序固定',
    (result.finalText.match(/^### .+$/gm) ?? []).join('|') ===
      [
        '### 直接結論',
        '### 實戰步問題',
        '### AI 首選',
        '### 對手利用與後果',
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
      traces[0]?.provider === 'openai' &&
      traces[0]?.model === 'fake-model' &&
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
  const completedShortResult = await runExplanationHarness(
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
  )
  check(
    '內容正確但過短的首答只用同一證據包補足，不再呼叫模型',
    shortProvider.calls === 1 && completedShortResult.warnings.length === 0
  )
  check(
    '本機補足後達到 500 漢字目標並保留真實兩條主線',
    countHanCharacters(completedShortResult.finalText) >= 500 &&
      completedShortResult.finalText.includes('馬八進七') &&
      completedShortResult.finalText.includes('炮二平五') &&
      completedShortResult.finalText.includes('馬8進7')
  )
  check(
    '補足後 trace 完成且保留原始短答診斷供責任判定',
    shortTraces.at(-1)?.status === 'completed' &&
      shortTraces.at(-1)?.validationErrors.some((error) =>
        error.includes('一鍵完整解說正文只有')
      )
  )
  check(
    '本機補足不產生連續或衝突的中文標點',
    !/(?:。；|。。|，。)/u.test(completedShortResult.finalText),
    completedShortResult.finalText
  )
  check(
    '本機補足不拼出「對手接著紅方」一類重複主詞病句',
    !/對手(?:接著|後續)(?:紅方|黑方)/u.test(completedShortResult.finalText),
    completedShortResult.finalText
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
    '400–499 漢字的合格首答也會用同一證據包補到 500 字產品目標',
    nearTargetProvider.calls === 1 &&
      countHanCharacters(nearTargetResult.finalText) >= 500 &&
      nearTargetTraces.at(-1)?.validationErrors.some((error) =>
        error.includes('低於 500 個漢字的產品目標')
      ),
    JSON.stringify({
      calls: nearTargetProvider.calls,
      finalHan: countHanCharacters(nearTargetResult.finalText),
      errors: nearTargetTraces.at(-1)?.validationErrors
    })
  )

  const hangingProvider = new HangingInitialProvider()
  const softTimeoutTraces: HarnessTrace[] = []
  const softTimeoutStartedAt = Date.now()
  const softTimeoutResult = await runExplanationHarness(
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
  check(
    '首輪服務卡住時在內部軟截止後用引擎證據完成，不等外層 30 秒取消',
    hangingProvider.calls === 1 &&
      Date.now() - softTimeoutStartedAt < 500 &&
      softTimeoutResult.warnings.some((warning) => warning.includes('引擎證據版'))
  )
  check(
    '首輪軟截止屬安全收尾，trace 為 completed 且正文仍有完整五段',
    softTimeoutTraces.at(-1)?.status === 'completed' &&
      INITIAL_MOVE_EXPLANATION_SECTION_IDS.every((id) =>
        softTimeoutResult.finalText.includes(
          `### ${
            {
              [HARNESS_SECTION_IDS.directConclusion]: '直接結論',
              [HARNESS_SECTION_IDS.actualMoveProblem]: '實戰步問題',
              [HARNESS_SECTION_IDS.bestMovePlan]: 'AI 首選',
              [HARNESS_SECTION_IDS.opponentExploitation]: '對手利用與後果',
              [HARNESS_SECTION_IDS.practicalPrinciple]: '實戰原則'
            }[id]
          }`
        )
      )
  )

  const permanentErrorProvider = new PermanentProviderErrorProvider()
  const permanentErrorTraces: HarnessTrace[] = []
  const permanentErrorResult = await runExplanationHarness(
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
  check(
    '模型服務錯誤會安全收尾但不再誤記成無效 JSON',
    permanentErrorProvider.calls === 1 &&
      permanentErrorResult.warnings.some((warning) => warning.includes('引擎證據版')) &&
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
  const rateLimitedResult = await runExplanationHarness(
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
  const rateLimitedFallbackHeadings = [
    '### 直接結論',
    '### 實戰步問題',
    '### AI 首選',
    '### 對手利用與後果',
    '### 實戰原則'
  ]
  const rateLimitedFallbackBody = rateLimitedResult.finalText
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
  check(
    '429 限流不會以 600ms 重試繼續撞額度',
    rateLimitedProvider.calls === 1 &&
      !rateLimitedProgress.some((event) => event.phase === 'provider_retry')
  )
  check(
    '429 限流會安全交付完整五段引擎證據版',
    rateLimitedResult.warnings.some((warning) => warning.includes('引擎證據版')) &&
      rateLimitedFallbackHeadings.every((heading) =>
        rateLimitedResult.finalText.includes(heading)
      ) &&
      countHanCharacters(rateLimitedFallbackBody) >= 400
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
    '服務重試會在 UI 進度流顯示原因',
    retryProgress.some((event) => event.phase === 'provider_retry')
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
  check('首次實戰步比較直接回報既有快照深度與主線', progressEvents.some((item) => item.depth === 12 && (item.displayPrincipalVariation?.length ?? 0) > 0))
  check('首次實戰步比較不要求使用者決定是否加深', continuationRequests === 0)
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
        item.message.includes('目前局面、最佳著法目的與後續主線')
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
      explanationPrompt: 'Previous coach context marker'
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

  const invalidFollowUpProvider = new LocalizedNoUserMoveProvider(['not-json'])
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
  const invalidFollowUpDirect = invalidFollowUpResult.finalText.split('\n\n')[2] ?? ''
  check(
    '追問 JSON 無效時仍只呼叫一次，並以引擎快照精確輸出三句話',
    invalidFollowUpProvider.calls === 1 &&
      (invalidFollowUpDirect.match(/。/g)?.length ?? 0) === 3 &&
      invalidFollowUpResult.finalText.includes('直接使用引擎證據產生精簡回答') &&
      !invalidFollowUpResult.finalText.includes('下次遇到類似局面')
  )

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

  // 具體後果審查成功，但預算只夠一次呼叫；寫作階段撞到上限時要走保守版問答，不能讓整個請求失敗。
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
    '撞到上限前只呼叫具體後果審查器，沒有嘗試呼叫寫作模型',
    writerBudgetProvider.calls === 1
  )
  check(
    '單次輸出未通過且無修正預算時改用引擎證據版',
    Boolean(writerBudgetResult?.warnings.some((warning) => warning.includes('引擎證據版')))
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
  const fallbackHeadingIndexes = [
    '### 直接結論',
    '### 實戰步問題',
    '### AI 首選',
    '### 對手利用與後果',
    '### 實戰原則'
  ].map((heading) => writerBudgetResult?.finalText.indexOf(heading) ?? -1)
  check(
    '引擎證據版 fallback 仍維持五個區塊的固定顯示順序',
    fallbackHeadingIndexes.every(
      (index, position) => index >= 0 && (position === 0 || index > fallbackHeadingIndexes[position - 1])
    ),
    fallbackHeadingIndexes.join(',')
  )
  const fallbackBody = (writerBudgetResult?.finalText ?? '')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
  check(
    '引擎證據版 fallback 本身也維持至少 400 個漢字的完整正文',
    countHanCharacters(fallbackBody) >= 400,
    countHanCharacters(fallbackBody)
  )
  check('撞到上限後完成狀態仍寫入 completed', writerBudgetTraces[0]?.status === 'completed')

  const outputTokenBoundaryProvider = new OutputTokenBoundaryProvider()
  const outputTokenBoundaryResult = await runExplanationHarness(
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
  check(
    '每次 provider 請求的 maxOutputTokens 不會高於整輪真正剩餘額度',
    outputTokenBoundaryProvider.requestedMaxTokens.length === 1 &&
      outputTokenBoundaryProvider.requestedMaxTokens[0] === 25,
    outputTokenBoundaryProvider.requestedMaxTokens.join(',')
  )
  check(
    '一鍵首輪不追加內容修正呼叫，並安全收斂到保守版',
    outputTokenBoundaryProvider.calls === 1 &&
      outputTokenBoundaryResult.warnings.some((warning) => warning.includes('引擎證據版'))
  )

  console.log('\n## 一鍵品質收斂（loop engineering）')

  // 一個區塊空泛：不得再花第二輪內容呼叫而撞上 30 秒硬截止。
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
    '空泛首答不啟動第二次內容呼叫',
    rewriteProvider.calls === 1,
    rewriteProvider.calls
  )
  check(
    '一鍵首答失敗後直接使用引擎證據版，不把空泛文字交付棋手',
    rewriteResult.warnings.some((warning) => warning.includes('引擎證據版')) &&
      !rewriteResult.finalText.includes('黑方大致上可以獲得不錯的機會')
  )
  check(
    '引擎證據版仍保留首輪已驗證的具體後果',
    rewriteResult.finalText.includes('黑方以馬8進7順利完成出子')
  )
  check(
    '一鍵首答失敗不回報虛假的局部重寫進度',
    !rewriteProgress.some((item) => item.phase === 'repairing')
  )

  // 模型即使願意再回空泛內容，也不得進入內容重試迴圈。
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
    '初次內容不合格 → 恰好一次模型呼叫後停止',
    stubbornProvider.calls === 1,
    stubbornProvider.calls
  )
  check(
    '首輪不合格後改用引擎證據版',
    stubbornResult.warnings.some((warning) => warning.includes('引擎證據版'))
  )
  check(
    '保守版問答仍保留已驗證的具體後果',
    stubbornResult.finalText.includes('黑方以馬8進7順利完成出子')
  )
  check(
    'trace 記錄不追加模型呼叫的收斂原因',
    (stubbornTraces[0]?.validationErrors ?? []).some((error) =>
      error.includes('不再追加模型呼叫')
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
    dualComparison
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
