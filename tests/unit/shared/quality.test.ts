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
  validateClaimCausalChain,
  type ScorableAnswer,
  type ScorableSection
} from '../../../src/shared/logic/ai/ExplanationQualityScorer'
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
  minimumHanCharacters?: number
) {
  return scoreExplanationAnswer({
    answer,
    availableMoves: moves,
    bestMoveDisplay: '炮二平五',
    userMoveDisplay: '馬八進七',
    hasUserMove: true,
    minimumHanCharacters
  })
}

function criterionFailed(report: ReturnType<typeof score>, id: string): boolean {
  return report.criteria.some((criterion) => criterion.id === id && !criterion.pass)
}

async function main(): Promise<void> {
  console.log('\n## 品質評分器：核心守門行為')

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
