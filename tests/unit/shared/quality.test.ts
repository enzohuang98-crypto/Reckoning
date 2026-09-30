/**
 * AI 解釋品質評分器評測集
 *
 * 驗證產品標準：
 * - 空泛回答會被擋下
 * - 只講分數會被擋下
 * - 只有術語但沒有因果鏈會被擋下
 * - 具體回答才會通過
 * - 八大錯誤類型（緩手／錯失先手／對手完成部署／棋子受限／王區變弱／
 *   陣形變差／錯過戰術）各有合格與不合格樣本
 * - PV 不足時必須誠實承認，不能亂講
 * - 使用者著法不在候選著法時仍可完成比較
 * - 使用者回饋回歸案例（tests/fixtures/harness-regression-cases.json）全部被擋下
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  scoreExplanationAnswer,
  screenExplanationText,
  scoreUsedAsReason,
  validateClaimCausalChain,
  type ScorableAnswer,
  type ScorableSection
} from '../../../src/shared/logic/ai/ExplanationQualityScorer'
import {
  moveComparisonEvidenceState,
  hasAssertedMoveCriticism,
  type MoveComparisonEvidenceState
} from '../../../src/shared/logic/ai/MoveComparisonEvidence'
import type { MoveComparisonResult } from '../../../src/shared/types/MoveComparisonResult'
import {
  HARNESS_SECTION_IDS,
  INITIAL_MOVE_EXPLANATION_MIN_HAN_CHARACTERS,
  type CausalChain,
  type HarnessSectionId
} from '../../../src/shared/types/Harness'

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

const AVAILABLE_MOVES = [
  '炮二平五',
  '馬8進7',
  '馬八進七',
  '馬2進3',
  '車九平八',
  '卒3進1'
]
check('numeric score comparison cannot stand in for the reason for a move',
  scoreUsedAsReason('炮二平五引擎評估400分，你的馬八進七只有200分，所以炮二平五更好。'))
check('Chinese numeric score comparison cannot stand in for the reason for a move',
  scoreUsedAsReason('因為炮二平五有四百分，馬八進七只有兩百分，這就是不能這樣走的理由。'))
check('reported scores do not condemn a separate concrete board explanation',
  !scoreUsedAsReason('兩條線的參考評估分別為400分與200分。炮二平五把炮移到中路，所以中兵的防守要重新檢查。'))
check('explicitly denying a numeric score as the reason is not a score-based reason',
  !scoreUsedAsReason('不能因為炮二平五400分、馬八進七200分就說前者更好，還要比較黑方的應手與中路棋子。'))
for (const [best, actual, bestScore, actualScore] of [
  ['炮八平五', '兵三進一', '800', '200'],
  ['車九平八', '馬二進三', '+1500', '-300'],
  ['炮8平5', '馬2進3', '八百', '兩百']
]) {
  check(`same causal policy applies to other moves and values: ${best}/${actual}`,
    scoreUsedAsReason(`因為${best}有${bestScore}分，${actual}只有${actualScore}分，所以前者比較好。`))
}
check('a single numeric evaluation is also not a board mechanism',
  scoreUsedAsReason('因為炮八平五的引擎評估是800分，所以這一步好。'))
check('English decimal evaluations obey the same causal policy',
  scoreUsedAsReason('Pikafish gives 炮八平五 4.5 points versus 馬二進三 2.0 points, therefore the first move is better.'))
check('centipawn score values obey the same causal policy',
  scoreUsedAsReason('Pikafish gives 炮八平五 800cp versus 馬二進三 200cp, so the first move is better.'))
check('denying score causation cannot exempt a later asserted score conclusion',
  scoreUsedAsReason('不能只因為分數決定走法，首選100分而實戰20分，所以實戰一定較差。'))
check('semicolon separates reported score from an actual board cause',
  !scoreUsedAsReason('Pikafish評估100分；選擇炮二平五是因為中炮瞄準中卒，並為兩翼子力爭取協同。'))
check('a board cause is not replaced by a score reported in the preceding clause',
  !scoreUsedAsReason('Pikafish評估100分，選擇炮二平五是因為中炮瞄準中卒，並為兩翼子力爭取協同。'))
check('a later negation cannot erase an earlier asserted score cause',
  scoreUsedAsReason('因為炮八平五的評估800分，所以這步好，不能用空泛詞代替解釋。'))
check('local negation of a qualitative score cause remains a valid correction',
  !scoreUsedAsReason('不能因為評分較高就稱它更好，還需說明炮的位置與對手應手。'))
check('a reason introducing a numeric evaluation is still score causation',
  scoreUsedAsReason('選擇炮八平五的理由是Pikafish評估800分。'))
check('reporting a higher reference evaluation alone does not assert its cause',
  !scoreUsedAsReason('這條線的參考評分較高。盤面理由是炮轉到中路後瞄準中卒。'))
check('English qualitative score cause shares the same policy',
  scoreUsedAsReason('The evaluation is higher, therefore this move is better.'))
check('English local score denial shares the same scope',
  !scoreUsedAsReason('This is not because the evaluation is higher; the cannon targets the central pawn.'))
check('English score reporting does not taint a separate board cause',
  !scoreUsedAsReason('The evaluation is higher; the cannon move is useful because it targets the central pawn.'))

const GOOD_CAUSAL: CausalChain = {
  cause: '因為先走馬八進七而不是炮二平五',
  mechanism: '開局第一時間的中路壓制被推遲',
  affected: '紅方中炮與中路攻勢',
  opponentUse: '黑方趁機馬8進7完成出子',
  consequence: '紅方補走炮二平五時黑方已多完成一步部署'
}

function sectionIdForLegacyHeading(heading: string): HarnessSectionId {
  if (heading.includes('最佳著法')) return HARNESS_SECTION_IDS.bestMovePlan
  if (heading.includes('錯失') || heading.includes('完整比較')) {
    return HARNESS_SECTION_IDS.actualMoveProblem
  }
  if (heading.includes('對手如何利用') || heading.includes('後續主線')) {
    return HARNESS_SECTION_IDS.opponentExploitation
  }
  return HARNESS_SECTION_IDS.practicalPrinciple
}

function section(heading: string, id: string, text: string, causal?: CausalChain): ScorableSection {
  return { id: sectionIdForLegacyHeading(heading), heading, claims: [{ id, text, causal }] }
}

/** 五個具名區塊皆合格的基準答案；舊測試 key 只用來替換內容片段。 */
function buildAnswer(overrides: Partial<Record<string, ScorableSection>> = {}): ScorableAnswer {
  const directAnswer =
    '馬八進七先走，錯過炮二平五立即控制中路的機會；黑方可趁機完成兩翼馬的部署，使紅方之後補走中炮時已失去先手。'
  const purpose = overrides.purpose ??
    section('AI 首選', 'C1', '炮二平五立即控制中路並保留先手。')
  const missed = overrides.missed ??
    section(
      '實戰步問題',
      'C2',
      '馬八進七先出子，錯過立即控制中路的時機。',
      GOOD_CAUSAL
    )
  const comparison = overrides.comparison ??
    section(
      '實戰步問題',
      'C5',
      '炮二平五先控制中路；馬八進七則讓黑方先完成出子，之後紅方仍要補走中炮。',
      {
        cause: '因為炮二平五與馬八進七的次序互換',
        mechanism: '中路控制與出子節奏易手',
        affected: '紅方先手與黑方陣形',
        opponentUse: '黑方按馬8進7、馬2進3從容應對',
        consequence: '紅方需要多花一手補回中炮，黑方部署領先'
      }
    )
  const opponent = overrides.opponent ??
    section(
      '對手利用與後果',
      'C3',
      '黑方以馬8進7和馬2進3完成兩翼馬部署。',
      {
        cause: '因為馬八進七沒有立即施壓',
        mechanism: '黑方獲得連續出子的節奏，完成兩翼部署',
        affected: '黑方雙馬與整體陣形',
        opponentUse: '黑方接連走馬8進7與馬2進3',
        consequence: '黑方陣形完整，紅方中路計畫慢一拍'
      }
    )
  const consequences = overrides.consequences ??
    section(
      '對手利用與後果',
      'C4',
      '馬八進七後黑方馬8進7，紅方再補炮二平五，黑方馬2進3；結果是紅方中路計畫延後，黑方多完成一步部署。',
      {
        cause: '因為馬八進七後黑方馬8進7',
        mechanism: '紅方被迫在第三手才補炮二平五控制中路',
        affected: '紅方中路與先手節奏',
        opponentUse: '黑方再走馬2進3補齊另一翼',
        consequence: '黑方多完成一步部署，紅方攻勢延後'
      }
    )
  const checklist = overrides.checklist ??
    section(
      '實戰原則',
      'C6',
      '先問是否有需要立即爭取的中路或先手機會，再檢查普通出子是否會讓對手從容部署。'
    )
  return {
    directAnswer,
    sections: [
      {
        id: HARNESS_SECTION_IDS.directConclusion,
        heading: '直接結論',
        claims: [{ id: 'DIRECT', text: directAnswer }]
      },
      {
        id: HARNESS_SECTION_IDS.actualMoveProblem,
        heading: '實戰步問題',
        claims: [...missed.claims, ...comparison.claims]
      },
      { id: HARNESS_SECTION_IDS.bestMovePlan, heading: 'AI 首選', claims: purpose.claims },
      {
        id: HARNESS_SECTION_IDS.opponentExploitation,
        heading: '對手利用與後果',
        claims: [...opponent.claims, ...consequences.claims]
      },
      {
        id: HARNESS_SECTION_IDS.practicalPrinciple,
        heading: '實戰原則',
        claims: checklist.claims
      }
    ],
  }
}

function score(
  answer: ScorableAnswer,
  moves = AVAILABLE_MOVES,
  minimumHanCharacters?: number,
  comparisonState: MoveComparisonEvidenceState = 'evidence_backed_difference',
  bestMoveDisplay = '炮二平五',
  userMoveDisplay = '馬八進七'
) {
  return scoreExplanationAnswer({
    answer,
    availableMoves: moves,
    bestMoveDisplay,
    userMoveDisplay,
    hasUserMove: true,
    comparisonState,
    minimumHanCharacters
  })
}

function buildSameMoveAnswer(): ScorableAnswer {
  const causal: CausalChain = {
    cause: '因為炮二平五先架起中炮',
    mechanism: '中炮立即控制中路並限制黑方中卒活動',
    affected: '紅方中炮、黑方中卒與中央線路',
    opponentUse: '黑方可用馬8進7正常發展右翼馬',
    consequence: '紅方接著馬八進七時仍保有協調出子的計畫'
  }
  return {
    directAnswer: '炮二平五就是引擎首選；這步立即控制中路，黑方可用馬8進7合理出子。',
    sections: [
      {
        id: HARNESS_SECTION_IDS.directConclusion,
        heading: '直接結論',
        claims: [{ id: 'DIRECT', text: '炮二平五就是引擎首選，兩者是同一著法。' }]
      },
      {
        id: HARNESS_SECTION_IDS.actualMoveProblem,
        heading: '與首選一致',
        claims: [{ id: 'C2', text: '實戰的炮二平五與首選一致，能立即控制中路。', causal }]
      },
      {
        id: HARNESS_SECTION_IDS.bestMovePlan,
        heading: '這步的好處',
        claims: [{ id: 'C3', text: '炮二平五先建立中炮，直接控制中路。' }]
      },
      {
        id: HARNESS_SECTION_IDS.opponentExploitation,
        heading: '對手合理應對',
        claims: [{
          id: 'C4',
          text: '炮二平五之後，黑方可走馬8進7，紅方接著馬八進七；雙方依序發展子力並保持中路張力。',
          causal
        }]
      },
      {
        id: HARNESS_SECTION_IDS.practicalPrinciple,
        heading: '實戰原則',
        claims: [{ id: 'C5', text: '著法與首選一致時，重點是理解計畫與對手的合理應對。' }]
      }
    ]
  }
}

function criterionFailed(report: ReturnType<typeof score>, id: string): boolean {
  return report.criteria.some((criterion) => criterion.id === id && !criterion.pass)
}

async function main(): Promise<void> {
  console.log('\n## 品質評分器：核心守門行為')

  const comparisonFixture: MoveComparisonResult = {
    positionFen: 'fixture',
    sideToMove: 'red',
    userMove: 'h2e2',
    engineBestMove: 'h2e2',
    evaluationAfterUserMove: 0.3,
    evaluationAfterBestMove: 0.3,
    scoreDifference: 0,
    mistakeLevel: 'acceptable_or_tiny_inaccuracy',
    depth: 18,
    confidence: 'high',
    uncertaintyReasons: []
  }
  check(
    '同一著法由實際比較欄位判定，不以候選排名推論',
    moveComparisonEvidenceState(comparisonFixture) === 'same_move'
  )
  check(
    '既有可接受分級映射為近似等值，不另造分差門檻',
    moveComparisonEvidenceState({
      ...comparisonFixture,
      userMove: 'b0c2',
      engineBestMove: 'h2e2'
    }) === 'near_equivalent'
  )
  check(
    '低可信比較明確落入證據不足',
    moveComparisonEvidenceState({
      ...comparisonFixture,
      userMove: 'b0c2',
      confidence: 'low'
    }) === 'insufficient'
  )

  const sameMoveReport = score(
    buildSameMoveAnswer(),
    AVAILABLE_MOVES,
    undefined,
    'same_move',
    '炮二平五',
    '炮二平五'
  )
  check('同首選可用正向計畫與合理應對通過，不強制負面解釋', sameMoveReport.pass, sameMoveReport.summary)
  const hiddenConsequences = buildSameMoveAnswer()
  const hiddenSection = hiddenConsequences.sections.find(section => section.id === 'opponent_exploitation')!
  const removedBody = hiddenSection.claims[0]!.text
  hiddenConsequences.sections.find(section => section.id === 'best_move_plan')!.claims[0]!.text += removedBody
  hiddenSection.claims[0]!.text = '黑方馬8進7發展。'
  check('其他段落移入長文且保留隱藏因果，仍不能代替後果段的可閱讀兩步主線',
    criterionFailed(score(hiddenConsequences, AVAILABLE_MOVES, undefined, 'same_move', '炮二平五', '炮二平五'), 'concrete_consequences'))
  const deniedCriticism = buildSameMoveAnswer()
  deniedCriticism.sections[1]!.claims[0]!.text += '這不是失誤，也沒有錯失機會。'
  check('同首選澄清不是失誤且沒有錯失不被 scorer 當成負評',
    score(deniedCriticism, AVAILABLE_MOVES, undefined, 'same_move', '炮二平五', '炮二平五').pass)
  check('否定一個負評不能豁免逗號後同一著法的實質負評',
    hasAssertedMoveCriticism('炮二平五不是失誤，但仍是較差的著法。', ['炮二平五']))
  check('同句逗號延續著法主詞時仍攔截負評',
    hasAssertedMoveCriticism('炮二平五與首選相同，仍是較差失誤。', ['炮二平五']))
  check('另一著法的負評不歸給使用者同首選著法',
    !hasAssertedMoveCriticism('炮二平五與首選一致，但馬八進七較差。', ['炮二平五']))
  check('明確否定的負評不變成實質負評',
    !hasAssertedMoveCriticism('炮二平五不是失誤，也沒有錯失機會。', ['炮二平五']))
  const falselyNegativeSameMove = buildSameMoveAnswer()
  falselyNegativeSameMove.sections[1]!.claims[0]!.text =
    '炮二平五雖與首選相同，仍是較差失誤，必然受到懲罰。'
  check(
    '同首選卻硬寫較差或懲罰會被擋下',
    criterionFailed(
      score(
        falselyNegativeSameMove,
        AVAILABLE_MOVES,
        undefined,
        'same_move',
        '炮二平五',
        '炮二平五'
      ),
      'missed_opportunity'
    )
  )

check(
  '不足字樣不能豁免同段仍存在的確定戰術斷言',
    validateClaimCausalChain(
      {
        id: 'mixed-insufficiency',
        text: '目前證據不足，但這步必然丟車。'
      },
      AVAILABLE_MOVES
    ).length > 0
)
check(
  '不足字樣與確定斷言之間沒有標點也不能整段豁免',
  validateClaimCausalChain(
    { id: 'mixed-no-punctuation', text: '證據不足但這步必然丟車' },
    ['炮二平五', '馬８進７']
  ).length > 0
)
check(
  '不足聲明後接正面確定錯著不能豁免因果鏈',
  validateClaimCausalChain(
    { id: 'mixed-positive-certainty', text: '證據不足，目前能確定這步是錯著。' },
    AVAILABLE_MOVES
  ).length > 0
)
check(
  '不足聲明及分析需求不能吞掉同句其餘將軍斷言',
  validateClaimCausalChain(
    { id: 'mixed-analysis-request', text: '證據不足，需要進一步分析，炮二平五已經將軍。' },
    AVAILABLE_MOVES
  ).length > 0
)
check(
  '沒有逗號的不足聲明與分析需求也不能吞掉將軍斷言',
  validateClaimCausalChain(
    { id: 'mixed-analysis-no-comma', text: '證據不足需要進一步分析炮二平五已經將軍' },
    AVAILABLE_MOVES
  ).length > 0
)
check(
  '正文只有不足聲明時，另附的實質因果欄位仍須接受檢查',
  validateClaimCausalChain(
    {
      id: 'insufficiency-with-causal-assertion', text: '目前引擎證據不足。',
      causal: { cause: '炮二平五已經將軍', mechanism: '', affected: '', opponentUse: '', consequence: '' }
    },
    AVAILABLE_MOVES
  ).length > 0
)
check(
  '僅指出證據不足與需要進一步分析仍可豁免',
  validateClaimCausalChain(
    { id: 'limited-analysis-request', text: '證據不足，需要進一步分析。' },
    AVAILABLE_MOVES
  ).length === 0
)
check(
  '單純證據不足與無法確認不必填入虛構因果',
  validateClaimCausalChain(
    { id: 'limited-unconfirmed', text: '目前引擎證據不足，無法確認。' },
    AVAILABLE_MOVES
  ).length === 0
)
check(
  '無法確認的純不足正文不能豁免另附的實質因果',
  validateClaimCausalChain(
    {
      id: 'limited-unconfirmed-with-causal', text: '目前引擎證據不足，無法確認。',
      causal: { cause: '炮二平五已經將軍', mechanism: '', affected: '', opponentUse: '', consequence: '' }
    },
    AVAILABLE_MOVES
  ).length > 0
)
check(
  '單純指出缺少主線仍可免不適用的因果鏈',
  validateClaimCausalChain(
    { id: 'limited-insufficiency', text: '目前引擎證據不足，無法確認錯失的具體機會。' },
    AVAILABLE_MOVES
  ).length === 0
)

  const good = score(buildAnswer())
  check('具體回答（含完整因果鏈）通過全部準則', good.pass, good.summary)
  check('通過時沒有失敗區塊', good.failedSections.length === 0)

  const emptyPrincipleAnswer = buildAnswer()
  const emptyPrinciple = emptyPrincipleAnswer.sections.find(
    (section) => section.id === HARNESS_SECTION_IDS.practicalPrinciple
  )
  if (emptyPrinciple) emptyPrinciple.claims = []
  check(
    '實戰原則為空會被品質評分器擋下',
    criterionFailed(score(emptyPrincipleAnswer), 'practical_principle')
  )

  const multiplePrinciplesAnswer = buildAnswer()
  multiplePrinciplesAnswer.sections
    .find((section) => section.id === HARNESS_SECTION_IDS.practicalPrinciple)
    ?.claims.push({ id: 'C7', text: '第二條原則不應混入首次完整解說。' })
  check(
    '實戰原則多於一條會被品質評分器擋下',
    criterionFailed(score(multiplePrinciplesAnswer), 'practical_principle')
  )

  const shortDepthReport = score(
    buildAnswer(),
    AVAILABLE_MOVES,
    INITIAL_MOVE_EXPLANATION_MIN_HAN_CHARACTERS
  )
  check(
    '五段形式齊全但不足 400 漢字仍會被完整度門檻擋下',
    criterionFailed(shortDepthReport, 'sufficient_depth') &&
      shortDepthReport.failedSections.some((section) =>
        section.issues.some((issue) => issue.includes('至少需要 400 個漢字'))
      )
  )

  const deepAnswer = buildAnswer()
  const deepConsequence = deepAnswer.sections.find(
    (section) => section.id === HARNESS_SECTION_IDS.opponentExploitation
  )
  if (deepConsequence?.claims.at(-1)) {
    deepConsequence.claims.at(-1)!.text +=
      '沿著實戰主線逐步看，馬八進七先出子後，黑方以馬8進7發展右翼馬；紅方到下一回合才補炮二平五，中炮壓到中線的時間因此延後。黑方接著馬2進3，另一匹馬也取得自然發展，兩翼馬在紅方只完成中炮部署時已經就位。這個差別不是抽象的分數高低，而是走子次序讓黑方多得到一個完整出子節奏；紅方原本可用炮二平五先限制中卒並迫使黑方先處理中路，實戰卻讓黑方按照馬8進7、馬2進3連續改善子力。後續判斷時要比較中炮壓力是否仍能限制黑方出車與中卒活動，也要檢查紅方補走炮二平五後是否還保有主動進攻的速度。若黑方已從容完成雙馬部署，紅方往後每一步都要同時顧及中路與兩翼，原先可直接建立的先手壓力便轉成追趕部署。'
  }
  const deepReport = score(
    deepAnswer,
    AVAILABLE_MOVES,
    INITIAL_MOVE_EXPLANATION_MIN_HAN_CHARACTERS
  )
  check(
    '具體五段正文達到 400 漢字後可通過完整度與既有棋理準則',
    deepReport.pass,
    deepReport.summary
  )
  const renamedHeadings = score({
    ...buildAnswer(),
    sections: buildAnswer().sections.map((item, index) => ({
      ...item,
      heading: `任意顯示標題 ${index + 1}`
    }))
  })
  check(
    '品質評分只依穩定 section id，不依賴「問：」或標題文字',
    renamedHeadings.pass,
    renamedHeadings.summary
  )

  const vague = score(
    buildAnswer({
      opponent: section('問：對手如何利用？', 'C3', '黑方大致上可以獲得不錯的機會。')
    })
  )
  check('空泛回答被擋下', !vague.pass)
  check(
    '空泛回答被定位到正確區塊',
    vague.failedSections.some(
      (item) => item.sectionId === HARNESS_SECTION_IDS.opponentExploitation
    )
  )

  const scoreOnly = score(
    buildAnswer({
      missed: section(
        '問：你的著法錯失什麼？',
        'C2',
        '馬八進七之後引擎分數較低，炮二平五分數較高，所以馬八進七比較差。',
        GOOD_CAUSAL
      )
    })
  )
  check('只講分數被擋下', criterionFailed(scoreOnly, 'no_score_as_reason'))

  const termsNoChain = score(
    buildAnswer({
      missed: section(
        '問：你的著法錯失什麼？',
        'C2',
        '這步棋牽制不足，陣形鬆散，王區薄弱。'
      )
    })
  )
  check('只有術語但沒有因果鏈被擋下', criterionFailed(termsNoChain, 'causal_chains'))

  const labelOnly = score(
    buildAnswer({
      consequences: section(
        '問：後續主線與具體後果是什麼？',
        'C4',
        '紅方失去先手。'
      )
    })
  )
  check('只貼結論標籤被擋下', !labelOnly.pass)

  const brokenPunctuationIssues = screenExplanationText(
    '馬八進七未能控制中路。。因此黑方馬8進7從容出子。；紅方之後才補炮二平五。',
    ['馬八進七', '馬8進7', '炮二平五']
  )
  check(
    '連續或衝突的中文標點會被文字品質篩檢擋下',
    brokenPunctuationIssues.some((issue) => issue.includes('中文標點'))
  )

  const missingComparison = score({
    ...buildAnswer(),
    sections: buildAnswer().sections.filter(
      (item) => item.id !== HARNESS_SECTION_IDS.actualMoveProblem
    )
  })
  check('缺少完整比較區塊被擋下', criterionFailed(missingComparison, 'full_comparison'))

  const comparisonNoUserMove = score(
    buildAnswer({
      comparison: section(
        '問：兩種著法完整比較後，差別在哪裡？',
        'C5',
        '炮二平五先控制中路，之後紅方可以車九平八出車。',
        GOOD_CAUSAL
      )
    })
  )
  check(
    '比較區塊沒有同時提到兩種著法被擋下',
    criterionFailed(comparisonNoUserMove, 'full_comparison')
  )

  console.log('\n## 因果鏈驗證')

  check(
    '完整因果鏈通過',
    validateClaimCausalChain({ id: 'C2', text: '說明', causal: GOOD_CAUSAL }, AVAILABLE_MOVES)
      .length === 0
  )
  check(
    '缺欄位的因果鏈被擋下',
    validateClaimCausalChain(
      { id: 'C2', text: '說明', causal: { ...GOOD_CAUSAL, opponentUse: '' } },
      AVAILABLE_MOVES
    ).some((issue) => issue.includes('對手利用'))
  )
  check(
    '原因沒有逐字主線著法被擋下',
    validateClaimCausalChain(
      { id: 'C2', text: '說明', causal: { ...GOOD_CAUSAL, cause: '因為這步走得太慢' } },
      AVAILABLE_MOVES
    ).some((issue) => issue.includes('哪一步主線著法'))
  )
  check(
    '後果是空泛標籤被擋下',
    validateClaimCausalChain(
      { id: 'C2', text: '說明', causal: { ...GOOD_CAUSAL, consequence: '失去先手' } },
      AVAILABLE_MOVES
    ).some((issue) => issue.includes('空泛標籤'))
  )
  check(
    '正文自帶「著法＋機制詞＋因果連接」可免結構化因果鏈',
    validateClaimCausalChain(
      {
        id: 'C2',
        text: '因為馬八進七延後了中炮，導致紅方中路攻勢慢一拍。'
      },
      AVAILABLE_MOVES
    ).length === 0
  )
  check(
    '誠實承認證據不足的 claim 免因果鏈',
    validateClaimCausalChain(
      { id: 'C2', text: '目前引擎證據不足，無法確認錯失的具體機會。' },
      AVAILABLE_MOVES
    ).length === 0
  )

  console.log('\n## 評測集：八大錯誤類型（合格 vs 不合格）')

  interface EvalCase {
    name: string
    goodText: string
    goodCausal: CausalChain
    badText: string
  }
  const evalCases: EvalCase[] = [
    {
      name: '緩手',
      goodText: '馬八進七是緩手：錯過炮二平五立即壓制中路的一手，黑方馬8進7先出子。',
      goodCausal: GOOD_CAUSAL,
      badText: '這步下得偏慢，整體而言節奏不太好。'
    },
    {
      name: '錯失先手',
      goodText: '因為先走馬八進七，紅方讓出先手；黑方馬8進7後，紅方炮二平五已慢一拍。',
      goodCausal: {
        cause: '因為馬八進七讓出先手',
        mechanism: '中路壓制延後，攻勢節奏易手',
        affected: '紅方先手與中路攻勢',
        opponentUse: '黑方馬8進7搶先出子',
        consequence: '紅方炮二平五慢一拍，只能跟著應對'
      },
      badText: '這步棋基本上讓對方比較舒服，主動性不足。'
    },
    {
      name: '讓對手完成部署',
      goodText: '馬八進七不含威脅，黑方馬8進7、馬2進3接連出動，兩翼馬完成部署。',
      goodCausal: {
        cause: '因為馬八進七不含威脅',
        mechanism: '黑方獲得連續兩手自由出子完成部署',
        affected: '黑方雙馬與陣形',
        opponentUse: '黑方馬8進7、馬2進3接連出動',
        consequence: '黑方陣形完整，紅方再無干擾機會'
      },
      badText: '對手因此可以慢慢發展，各方面都還可以。'
    },
    {
      name: '棋子受限',
      goodText: '馬八進七後紅馬被卒3進1蹩馬腿，這匹馬受制無法過河。',
      goodCausal: {
        cause: '因為馬八進七跳到易被攻擊的位置',
        mechanism: '卒3進1形成蹩馬腿，紅馬受制',
        affected: '紅方左翼馬與河口通路',
        opponentUse: '黑方卒3進1限制馬路',
        consequence: '紅馬無法過河參戰，左翼攻勢停滯'
      },
      badText: '這步之後棋子受限。'
    },
    {
      name: '王區變弱',
      goodText: '因為車九平八調離，紅方九宮少了保護，黑方炮鎮中路形成空頭炮威脅。',
      goodCausal: {
        cause: '因為車九平八調離防守位置',
        mechanism: '九宮防護減弱，中路出現空頭炮威脅',
        affected: '紅方九宮與中路士象',
        opponentUse: '黑方沉底炮叫將，攻勢集中王區',
        consequence: '紅帥受攻，被迫棄子解圍'
      },
      badText: '王區變弱，需要注意安全。'
    },
    {
      name: '陣形變差',
      goodText: '因為馬八進七與炮二平五次序顛倒，紅方陣形脫節：中炮無根，馬又擋住出車路線。',
      goodCausal: {
        cause: '因為馬八進七先走造成次序顛倒',
        mechanism: '中炮無根且馬擋住車路，陣形脫節',
        affected: '紅方炮、馬與出車路線',
        opponentUse: '黑方卒3進1繼續壓制紅方出子',
        consequence: '紅方各子無法呼應，只能被動調整'
      },
      badText: '陣形變差，結構鬆散。'
    },
    {
      name: '錯過戰術',
      goodText: '錯過炮二平五後的抽將戰術：主線炮二平五、馬8進7、車九平八可形成捉雙，得子機會消失。',
      goodCausal: {
        cause: '因為沒走炮二平五',
        mechanism: '抽將帶捉雙的戰術組合不再成立',
        affected: '紅方中炮與車的戰術配合',
        opponentUse: '黑方馬2進3補防後戰術點消失',
        consequence: '紅方失去得子機會，只能轉入普通陣地戰'
      },
      badText: '這裡其實有更好的下法，值得注意。'
    }
  ]

  for (const evalCase of evalCases) {
    const goodReport = score(
      buildAnswer({
        missed: section('問：你的著法錯失什麼？', 'C2', evalCase.goodText, evalCase.goodCausal)
      })
    )
    check(`${evalCase.name}：具體版本通過`, goodReport.pass, goodReport.summary)
    const badReport = score(
      buildAnswer({
        missed: section('問：你的著法錯失什麼？', 'C2', evalCase.badText)
      })
    )
    check(`${evalCase.name}：空泛版本被擋下`, !badReport.pass)
  }

  console.log('\n## PV 不足與使用者著法不在候選')

  // 主線不足（可引用著法 < 2）：亂講會被擋、誠實承認會通過。
  const thinMoves = ['炮二平五']
  const fabricated = score(
    buildAnswer({
      consequences: section(
        '問：後續主線與具體後果是什麼？',
        'C4',
        '接下來紅方會炮二平五、再出車、然後臥槽馬絕殺。',
        GOOD_CAUSAL
      )
    }),
    thinMoves
  )
  check(
    'PV 不足時亂講後續變化被擋下',
    criterionFailed(fabricated, 'concrete_consequences')
  )
  const honest = score(
    buildAnswer({
      missed: section(
        '問：你的著法錯失什麼？',
        'C2',
        '目前引擎主線不足，尚不能確認錯失的具體機會。'
      ),
      opponent: section(
        '問：對手如何利用？',
        'C3',
        '目前引擎主線不足，無法確認對手的具體利用方式。'
      ),
      consequences: section(
        '問：後續主線與具體後果是什麼？',
        'C4',
        '目前引擎主線不足，無法確認後續具體變化，請加深分析後再看結論。'
      ),
      comparison: section(
        '問：兩種著法完整比較後，差別在哪裡？',
        'C5',
        '目前引擎主線不足，尚不能完成兩種著法的完整比較。'
      )
    }),
    thinMoves
  )
  check('PV 不足時誠實承認可通過', honest.pass, honest.summary)

  // 使用者著法不在引擎候選/主線中（引擎另行二次分析的情形）：比較仍要成立。
  const offCandidateReport = scoreExplanationAnswer({
    answer: buildAnswer({
      missed: section(
        '問：你的著法錯失什麼？',
        'C2',
        '兵九進一錯過炮二平五立即控制中路的機會，黑方馬8進7先出子。',
        GOOD_CAUSAL
      ),
      comparison: section(
        '問：兩種著法完整比較後，差別在哪裡？',
        'C5',
        '炮二平五直接壓制中路；而兵九進一只推邊兵，黑方馬8進7後紅方中路攻勢慢一拍。',
        GOOD_CAUSAL
      )
    }),
    availableMoves: AVAILABLE_MOVES,
    bestMoveDisplay: '炮二平五',
    userMoveDisplay: '兵九進一',
    hasUserMove: true
  })
  check(
    '使用者著法不在候選著法時，比較與因果仍可通過',
    offCandidateReport.pass,
    offCandidateReport.summary
  )

  console.log('\n## 使用者回饋回歸案例（tests/fixtures/harness-regression-cases.json）')

  const fixture = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'fixtures', 'harness-regression-cases.json'), 'utf8')
  ) as {
    availableMoves: string[]
    cases: Array<{
      name: string
      expectRejected: boolean
      finalText: string
    }>
  }
  for (const regression of fixture.cases) {
    const issues = screenExplanationText(regression.finalText, fixture.availableMoves)
    if (regression.expectRejected) {
      check(`回歸案例被擋下：${regression.name}`, issues.length > 0)
    } else {
      check(`合格樣本不被誤殺：${regression.name}`, issues.length === 0, issues)
    }
  }

  console.log(`結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exitCode = 1
}

void main()
