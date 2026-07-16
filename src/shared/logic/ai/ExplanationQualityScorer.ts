/**
 * AI 解釋品質評分器 (ExplanationQualityScorer)
 *
 * Harness 品質迴圈的守門員：對寫作者輸出的結構化回答逐項評分，
 * 回報「哪一個準則失敗、失敗在哪個區塊、具體缺什麼」，
 * 讓修正迴圈可以只重寫失敗的區塊，而不是整篇重生。
 *
 * 十項準則（全部通過才算合格）：
 *  1. best_move_purpose      — 說明最佳著法的具體目的
 *  2. missed_opportunity     — 說明使用者著法錯失什麼
 *  3. why_bad                — 說明為什麼不好（要有因果連接，不是貼標籤）
 *  4. opponent_exploitation  — 說明對手如何利用
 *  5. concrete_consequences  — 後續具體盤面後果（主線不足時必須誠實說不足）
 *  6. full_comparison        — 完成最佳著法 vs 使用者著法的完整比較
 *  7. practical_principle    — 恰好一條非空、可帶走的實戰原則
 *  8. sufficient_depth       — 一鍵完整解說不得短於設定的漢字下限
 *  9. no_score_as_reason     — 不得用分數高低代替棋理
 * 10. no_vague_wording       — 不得用空泛詞帶過
 *
 * 另含因果鏈驗證：核心 claim 必須具備
 * 原因（因為哪一步）→ 機制（造成什麼棋理/盤面變化）→ 受影響對象 →
 * 對手利用 → 後果，五段齊備且各自具體。
 *
 * 純函式模組：不呼叫模型、不讀引擎，main 與測試皆可直接使用。
 */

import { containsConcreteXiangqiTerm } from './xiangqiTerms'
import {
  HARNESS_SECTION_IDS,
  type CausalChain,
  type HarnessSectionId
} from '../../types/Harness'

/* ---------- 共用文字工具（Harness 驗證與評分器共用，單一事實來源） ---------- */

export function compactChineseText(text: string): string {
  return text.replace(/[，。！？；：、,.!?:;\s]/g, '')
}

export function mentionsAnyMove(text: string, moves: string[]): boolean {
  return moves.some((move) => move.trim() && text.includes(move))
}

/** 正文中逐字出現的不同著法數：只提一步等於沒把因果沿主線走完。 */
export function distinctMentionedMoves(text: string, moves: string[]): number {
  return new Set(moves.filter((move) => move.trim() && text.includes(move))).size
}

function characterBigrams(text: string): Map<string, number> {
  const bigrams = new Map<string, number>()
  for (let index = 0; index < text.length - 1; index++) {
    const gram = text.slice(index, index + 2)
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1)
  }
  return bigrams
}

/** 字元 bigram Dice 相似度（0~1），用來擋不同欄位互相改寫湊字數。 */
export function textSimilarity(a: string, b: string): number {
  const left = compactChineseText(a)
  const right = compactChineseText(b)
  if (left.length < 2 || right.length < 2) {
    return left.length > 0 && left === right ? 1 : 0
  }
  const leftGrams = characterBigrams(left)
  const rightGrams = characterBigrams(right)
  let shared = 0
  for (const [gram, count] of leftGrams) {
    shared += Math.min(count, rightGrams.get(gram) ?? 0)
  }
  return (2 * shared) / (left.length - 1 + (right.length - 1))
}

/** 以分數高低當理由的敘述（含直述句型，不只「因為…分數高」）。 */
export function scoreUsedAsReason(text: string): boolean {
  if (
    /(因為|理由|所以|代表).{0,30}(分數|評分|數值).{0,20}(較高|較低|比較高|比較低|領先|落後)/.test(
      text
    )
  ) {
    return true
  }
  // 直述句型：「分數較高所以較好」「評分比較低，因此不好」「差了 0.35 個兵」
  if (/(分數|評分|評估值?|數值)(明顯)?(較|更|比較)(高|低|好|差)/.test(text)) return true
  if (/(高|低)出?\s*[0-9.]+\s*(分|个兵|個兵|cp)/i.test(text)) return true
  return false
}

export const GENERIC_CONSEQUENCE_LABELS = [
  '失去先手',
  '棋子受限',
  '王區變弱',
  '王区变弱',
  '陣形變差',
  '阵形变差',
  '讓對手完成部署',
  '让对手完成部署'
]

export const GENERIC_PURPOSE_PHRASES = [
  '好棋',
  '不錯',
  '正常',
  '沒問題',
  '沒有問題',
  '比較好',
  '比較不好',
  '較好',
  '較差',
  '有優勢',
  '有劣勢'
]

/** 空泛詞：出現且句中沒有任何具體著法或象棋機制詞時，視為帶過。 */
const VAGUE_PHRASES = [
  '大致上',
  '基本上',
  '總體而言',
  '总体而言',
  '整體而言',
  '整体而言',
  '總的來說',
  '总的来说',
  '形勢不錯',
  '形势不错',
  '局面複雜',
  '局面复杂',
  '各有優劣',
  '各有千秋',
  '差不多',
  '還可以',
  '还可以',
  '不太好',
  '不夠好',
  '不够好',
  '略有不足',
  '稍顯不足',
  '稍显不足',
  '有待加強',
  '有待加强',
  '值得注意',
  '需要注意',
  '靈活性',
  '灵活性',
  '主動性不足',
  '主动性不足'
]

/** 誠實承認證據不足的句型：主線不足時這是唯一合格的寫法，不能硬掰。 */
const INSUFFICIENCY_PATTERNS =
  /(證據不足|证据不足|資料不足|资料不足|主線(還)?不足|主线(还)?不足|尚不能|無法確認|无法确认|不足以)/

export function acknowledgesInsufficiency(text: string): boolean {
  return INSUFFICIENCY_PATTERNS.test(text)
}

/** 用於目的／問題描述：門檻較低（不強制逐字引用著法），只擋空泛帶過。 */
export function looksVaguePurposeText(text: string): boolean {
  const compact = compactChineseText(text)
  if (!compact) return true
  if (
    GENERIC_PURPOSE_PHRASES.some((phrase) => compact === compactChineseText(phrase))
  ) {
    return true
  }
  return compact.length < 10
}

export function looksVagueConsequenceText(
  text: string,
  supportingMoves: string[]
): boolean {
  const compact = compactChineseText(text)
  if (!compact) return true
  if (
    GENERIC_CONSEQUENCE_LABELS.some((label) => compact === compactChineseText(label))
  ) {
    return true
  }
  if (/^(紅方|黑方)?(失去先手|棋子受限|王區變弱|陣形變差)$/.test(compact)) {
    return true
  }
  if (/^(紅方|黑方)?.{0,4}(完成|順利完成).{0,4}(部署|出子)$/.test(compact)) {
    return true
  }
  return compact.length < 10 && !mentionsAnyMove(text, supportingMoves)
}

/* ---------- 因果鏈驗證 ---------- */

export interface CausalChainIssue {
  claimId: string
  issues: string[]
}

/** 因果鏈五段的中文名稱（診斷訊息用）。 */
const CAUSAL_FIELD_LABELS: Record<keyof CausalChain, string> = {
  cause: '原因（因為哪一步）',
  mechanism: '機制（造成什麼棋理或盤面變化）',
  affected: '受影響對象（棋子、線路、王區、陣形或威脅）',
  opponentUse: '對手利用（對手下一步如何利用）',
  consequence: '後果（後續具體變差在哪裡）'
}

/**
 * 驗證單一 claim 的因果鏈：
 * 五段皆須非空；原因必須逐字含至少一步主線著法；
 * 機制或受影響對象必須用到具體象棋詞彙（或著法本身）；後果不得是空泛標籤。
 * 有誠實承認證據不足的 claim 可免附因果鏈。
 */
export function validateClaimCausalChain(
  claim: { id: string; text: string; causal?: CausalChain },
  availableMoves: string[]
): string[] {
  if (acknowledgesInsufficiency(claim.text)) return []
  const issues: string[] = []
  const causal = claim.causal
  if (!causal) {
    // 文字後備判定：沒有結構化因果鏈時，claim 正文必須同時具備
    // 主線著法（原因）、具體機制詞（機制/對象）與因果連接詞（後果），缺一即退回。
    const textHasChain =
      mentionsAnyMove(claim.text, availableMoves) &&
      containsConcreteXiangqiTerm(claim.text) &&
      CAUSAL_CONNECTIVES.test(claim.text)
    if (textHasChain) return []
    return [
      '缺少因果鏈：必須提供 原因→機制→受影響對象→對手利用→後果 五段結構（causal 欄位），或在正文中同時給出主線著法、具體機制與因果連接。'
    ]
  }
  for (const key of Object.keys(CAUSAL_FIELD_LABELS) as Array<keyof CausalChain>) {
    if (!causal[key] || !compactChineseText(String(causal[key]))) {
      issues.push(`因果鏈缺少${CAUSAL_FIELD_LABELS[key]}。`)
    }
  }
  if (issues.length > 0) return issues
  if (!mentionsAnyMove(causal.cause, availableMoves)) {
    issues.push('因果鏈的原因沒有逐字指出是哪一步主線著法造成的。')
  }
  const mechanismText = `${causal.mechanism} ${causal.affected}`
  if (
    !containsConcreteXiangqiTerm(mechanismText) &&
    !mentionsAnyMove(mechanismText, availableMoves)
  ) {
    issues.push('因果鏈的機制與受影響對象沒有使用具體象棋詞彙或主線著法。')
  }
  if (looksVagueConsequenceText(causal.consequence, availableMoves)) {
    issues.push('因果鏈的後果仍是空泛標籤，必須說出具體變差在哪裡。')
  }
  if (!compactChineseText(causal.opponentUse) || causal.opponentUse.length < 6) {
    issues.push('因果鏈的對手利用描述太短，必須說明對手下一步怎麼走、利用什麼。')
  }
  return issues
}

/* ---------- 品質評分 ---------- */

export type QualityCriterionId =
  | 'best_move_purpose'
  | 'missed_opportunity'
  | 'why_bad'
  | 'opponent_exploitation'
  | 'concrete_consequences'
  | 'full_comparison'
  | 'practical_principle'
  | 'sufficient_depth'
  | 'no_score_as_reason'
  | 'no_vague_wording'
  | 'causal_chains'

export interface QualityCriterionResult {
  id: QualityCriterionId
  label: string
  pass: boolean
  issues: string[]
}

export interface SectionDiagnosis {
  /** Stable machine-readable repair key; DIRECT represents directAnswer. */
  sectionId: HarnessSectionId | 'DIRECT'
  /** User-facing label used only in diagnostics. */
  heading: string
  issues: string[]
}

export interface QualityReport {
  pass: boolean
  criteria: QualityCriterionResult[]
  /** 只列失敗區塊與其具體問題，供修正迴圈做「只重寫失敗段落」。 */
  failedSections: SectionDiagnosis[]
  /** 一句話摘要（進度訊息用），例如「解釋太空泛」「缺少對手利用」。 */
  summary: string
}

export interface ScorableClaim {
  id: string
  text: string
  causal?: CausalChain
}

export interface ScorableSection {
  id: HarnessSectionId
  heading: string
  claims: ScorableClaim[]
}

export interface ScorableAnswer {
  directAnswer: string
  sections: ScorableSection[]
}

export interface QualityScorerInput {
  answer: ScorableAnswer
  /** 引擎主線可引用的全部中文著法。 */
  availableMoves: string[]
  bestMoveDisplay?: string | null
  userMoveDisplay?: string | null
  hasUserMove: boolean
  /** 只計玩家實際看得到的正文漢字；未設定時不套用篇幅門檻。 */
  minimumHanCharacters?: number
}

/** Stable ids used by validation and repair; headings are display-only. */
export const SECTION_IDS = HARNESS_SECTION_IDS

export function countHanCharacters(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? 0
}

/** renderAnswer 會略過 direct_conclusion claim，避免把 directAnswer 顯示兩次。 */
export function playerFacingAnswerText(answer: ScorableAnswer): string {
  return [
    answer.directAnswer,
    ...answer.sections
      .filter((section) => section.id !== SECTION_IDS.directConclusion)
      .flatMap((section) => section.claims.map((claim) => claim.text))
  ].join('\n')
}

function findSection(
  answer: ScorableAnswer,
  id: HarnessSectionId
): ScorableSection | undefined {
  return answer.sections.find((section) => section.id === id)
}

/** 只取使用者看得到的 claim 正文（不含 causal 欄位）。 */
function sectionPlainText(section: ScorableSection | undefined): string {
  if (!section) return ''
  return section.claims.map((claim) => claim.text).join(' ')
}

function sectionText(section: ScorableSection | undefined): string {
  if (!section) return ''
  return section.claims
    .map((claim) =>
      [
        claim.text,
        claim.causal?.cause,
        claim.causal?.mechanism,
        claim.causal?.affected,
        claim.causal?.opponentUse,
        claim.causal?.consequence
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join(' ')
}

export const CAUSAL_CONNECTIVES =
  /(因為|因为|由於|由于|導致|导致|使得|使|造成|讓|让|迫使|所以|因此|於是|于是|結果|结果)/

export function scoreExplanationAnswer(input: QualityScorerInput): QualityReport {
  const {
    answer,
    availableMoves,
    bestMoveDisplay,
    userMoveDisplay,
    hasUserMove,
    minimumHanCharacters
  } = input
  const criteria: QualityCriterionResult[] = []
  const sectionIssues = new Map<
    HarnessSectionId | 'DIRECT',
    { heading: string; issues: string[] }
  >()
  const addSectionIssue = (
    sectionId: HarnessSectionId | 'DIRECT',
    heading: string,
    issue: string
  ): void => {
    const current = sectionIssues.get(sectionId) ?? { heading, issues: [] }
    const list = current.issues
    list.push(issue)
    sectionIssues.set(sectionId, { heading: current.heading, issues: list })
  }
  const record = (
    id: QualityCriterionId,
    label: string,
    issues: string[],
    section?: ScorableSection,
    missingSection?: { id: HarnessSectionId; heading: string }
  ): void => {
    criteria.push({ id, label, pass: issues.length === 0, issues })
    const target = section ?? missingSection
    if (target) {
      for (const issue of issues) addSectionIssue(target.id, target.heading, issue)
    }
  }

  const purposeSection = findSection(answer, SECTION_IDS.bestMovePlan)
  const missedSection = findSection(answer, SECTION_IDS.actualMoveProblem)
  const opponentSection = findSection(answer, SECTION_IDS.opponentExploitation)
  const consequenceSection = opponentSection
  const comparisonSection = missedSection
  const principleSection = findSection(answer, SECTION_IDS.practicalPrinciple)

  // 1. 最佳著法目的
  {
    const issues: string[] = []
    const text = sectionText(purposeSection)
    if (!purposeSection) {
      issues.push('缺少「最佳著法想做什麼」區塊。')
    } else if (looksVaguePurposeText(text)) {
      issues.push('最佳著法的目的太空泛，必須說出具體要達成什麼。')
    } else if (
      !containsConcreteXiangqiTerm(text) &&
      !mentionsAnyMove(text, availableMoves)
    ) {
      issues.push('最佳著法的目的沒有連到具體著法或象棋機制詞。')
    }
    record(
      'best_move_purpose',
      '說明最佳著法的目的',
      issues,
      purposeSection,
      { id: SECTION_IDS.bestMovePlan, heading: 'AI 首選' }
    )
  }

  // 2. 錯失什麼（僅在有使用者著法時要求）
  if (hasUserMove) {
    const issues: string[] = []
    const text = sectionText(missedSection)
    if (!missedSection) {
      issues.push('缺少「你的著法錯失什麼」區塊。')
    } else if (acknowledgesInsufficiency(text)) {
      // 誠實承認不足是合格的
    } else {
      if (looksVaguePurposeText(text)) {
        issues.push('錯失機會的描述太空泛，必須具體說明錯失了什麼。')
      }
      if (!mentionsAnyMove(text, availableMoves)) {
        issues.push('錯失機會沒有逐字連回任何一步主線著法。')
      }
    }
    record(
      'missed_opportunity',
      '說明錯失什麼',
      issues,
      missedSection,
      { id: SECTION_IDS.actualMoveProblem, heading: '實戰步問題' }
    )
  }

  // 3. 為什麼不好：錯失/比較區塊必須有因果連接詞，而不是貼標籤
  if (hasUserMove) {
    const issues: string[] = []
    const text = `${sectionText(missedSection)} ${sectionText(comparisonSection)} ${answer.directAnswer}`
    if (!acknowledgesInsufficiency(text) && !CAUSAL_CONNECTIVES.test(text)) {
      issues.push(
        '沒有用因果語句說明為什麼不好（需要「因為／導致／使得／讓」等把著法與後果接起來）。'
      )
    }
    record(
      'why_bad',
      '說明為什麼不好',
      issues,
      missedSection,
      { id: SECTION_IDS.actualMoveProblem, heading: '實戰步問題' }
    )
  }

  // 4. 對手如何利用
  if (hasUserMove) {
    const issues: string[] = []
    const text = sectionText(opponentSection)
    if (!opponentSection) {
      issues.push('缺少「對手如何利用」區塊。')
    } else if (acknowledgesInsufficiency(text)) {
      // 合格的誠實回答
    } else {
      if (looksVaguePurposeText(text)) {
        issues.push('對手利用的描述太空泛。')
      }
      if (!mentionsAnyMove(text, availableMoves)) {
        issues.push('對手利用沒有指出對手實際會走的主線著法。')
      }
      if (!/(對手|对手|黑方|紅方|红方)/.test(text)) {
        issues.push('對手利用沒有以對手為主詞說明其計畫。')
      }
    }
    record(
      'opponent_exploitation',
      '說明對手如何利用',
      issues,
      opponentSection,
      { id: SECTION_IDS.opponentExploitation, heading: '對手利用與後果' }
    )
  }

  // 5. 後續具體盤面後果（主線不足時必須誠實說不足）
  {
    const issues: string[] = []
    const text = sectionText(consequenceSection)
    const pvSufficient = availableMoves.length >= 2
    if (!consequenceSection) {
      issues.push('缺少「後續主線與具體後果」區塊。')
    } else if (!pvSufficient) {
      if (!acknowledgesInsufficiency(text)) {
        issues.push('引擎主線不足時，必須明確說明資料不足，不能自行編造後續變化。')
      }
    } else if (!acknowledgesInsufficiency(text)) {
      if (distinctMentionedMoves(text, availableMoves) < 2) {
        issues.push('後續後果沒有逐字連回至少兩步主線著法。')
      }
      if (!containsConcreteXiangqiTerm(text)) {
        issues.push('後續後果沒有使用具體象棋詞彙指出位置、棋子關係或威脅。')
      }
      if (!CAUSAL_CONNECTIVES.test(text) && !/(之後|接著|接下來|然後)/.test(text)) {
        issues.push('後續後果缺少因果或時序連接，看不出盤面如何一步步變差。')
      }
    }
    record(
      'concrete_consequences',
      '後續具體盤面後果',
      issues,
      consequenceSection,
      { id: SECTION_IDS.opponentExploitation, heading: '對手利用與後果' }
    )
  }

  // 6. 完整比較（僅在有使用者著法時要求）：檢查使用者看得到的正文本身
  if (hasUserMove) {
    const issues: string[] = []
    const text = sectionPlainText(comparisonSection)
    if (!comparisonSection) {
      issues.push('缺少「兩種著法完整比較」區塊。')
    } else if (!acknowledgesInsufficiency(text)) {
      const mentionsBest = bestMoveDisplay ? text.includes(bestMoveDisplay) : false
      const mentionsUser = userMoveDisplay ? text.includes(userMoveDisplay) : false
      if (bestMoveDisplay && userMoveDisplay && !(mentionsBest && mentionsUser)) {
        issues.push(
          `完整比較必須同時逐字提到最佳著法（${bestMoveDisplay}）與你的著法（${userMoveDisplay}）。`
        )
      } else if (
        !(bestMoveDisplay && userMoveDisplay) &&
        distinctMentionedMoves(text, availableMoves) < 2
      ) {
        issues.push('完整比較至少要對照兩步不同著法。')
      }
      if (!/(而|則|则|相比|對照|对照|但|反之)/.test(text)) {
        issues.push('完整比較缺少對照語句，看不出兩種著法差在哪裡。')
      }
    }
    record(
      'full_comparison',
      '最佳著法 vs 你的著法完整比較',
      issues,
      comparisonSection,
      { id: SECTION_IDS.actualMoveProblem, heading: '實戰步問題' }
    )
  }

  // 7. 實戰原則：initial actual-move 解說固定只給一條非空原則
  if (hasUserMove) {
    const issues: string[] = []
    if (!principleSection) {
      issues.push('缺少「實戰原則」區塊。')
    } else if (principleSection.claims.length !== 1) {
      issues.push(
        `「實戰原則」必須恰好一條，目前有 ${principleSection.claims.length} 條。`
      )
    } else if (!principleSection.claims[0]?.text.trim()) {
      issues.push('「實戰原則」不可為空白。')
    }
    record(
      'practical_principle',
      '提供恰好一條實戰原則',
      issues,
      principleSection,
      { id: SECTION_IDS.practicalPrinciple, heading: '實戰原則' }
    )
  }

  // 8. 完整度：只計 render 後玩家真正會看到的正文，不把標題或 causal metadata 灌水
  if (hasUserMove && minimumHanCharacters !== undefined) {
    const issues: string[] = []
    const hanCharacters = countHanCharacters(playerFacingAnswerText(answer))
    if (hanCharacters < minimumHanCharacters) {
      issues.push(
        `一鍵完整解說正文只有 ${hanCharacters} 個漢字，至少需要 ${minimumHanCharacters} 個漢字；目標約 500–900 個中文字，請補足棋理因果與具體主線。`
      )
    }
    record(
      'sufficient_depth',
      `完整解說至少 ${minimumHanCharacters} 個漢字`,
      issues,
      opponentSection,
      { id: SECTION_IDS.opponentExploitation, heading: '對手利用與後果' }
    )
  }

  // 9. 不得用分數當理由（全篇檢查，逐區塊定位）
  {
    const issues: string[] = []
    if (scoreUsedAsReason(answer.directAnswer)) {
      issues.push('直接回答以分數高低代替棋理原因。')
      addSectionIssue(
        'DIRECT',
        '直接結論',
        '直接回答以分數高低代替棋理原因，必須改寫為盤面因果。'
      )
    }
    for (const section of answer.sections) {
      const text = sectionText(section)
      if (scoreUsedAsReason(text)) {
        issues.push(`「${section.heading}」以分數高低代替棋理原因。`)
        addSectionIssue(
          section.id,
          section.heading,
          '此區塊以分數高低代替棋理原因，必須改寫為盤面因果。'
        )
      }
    }
    record('no_score_as_reason', '不以分數代替理由', issues)
  }

  // 10. 不得空泛帶過（逐 claim 檢查）
  {
    const issues: string[] = []
    const inspect = (
      sectionId: HarnessSectionId | 'DIRECT',
      heading: string,
      id: string,
      text: string
    ): void => {
      const hasVaguePhrase = VAGUE_PHRASES.some((phrase) => text.includes(phrase))
      const hasSubstance =
        mentionsAnyMove(text, availableMoves) || containsConcreteXiangqiTerm(text)
      if (hasVaguePhrase && !hasSubstance) {
        issues.push(`${id} 使用空泛詞而沒有任何具體著法或機制詞。`)
        addSectionIssue(
          sectionId,
          heading,
          `${id} 使用空泛詞帶過，必須改為具體著法與盤面因果。`
        )
      }
    }
    inspect('DIRECT', '直接結論', '直接回答', answer.directAnswer)
    for (const section of answer.sections) {
      for (const claim of section.claims) {
        inspect(section.id, section.heading, claim.id, claim.text)
      }
    }
    record('no_vague_wording', '不用空泛詞帶過', issues)
  }

  // 9. 因果鏈：核心區塊（錯失／對手利用／後果／比較）每個 claim 都要有完整因果鏈
  if (hasUserMove) {
    const issues: string[] = []
    const coreSections = [...new Map(
      [missedSection, opponentSection]
        .filter((section): section is ScorableSection => section !== undefined)
        .map((section) => [section.id, section])
    ).values()]
    for (const section of coreSections) {
      for (const claim of section.claims) {
        const claimIssues = validateClaimCausalChain(claim, availableMoves)
        for (const issue of claimIssues) {
          issues.push(`${claim.id} ${issue}`)
          addSectionIssue(section.id, section.heading, `${claim.id} ${issue}`)
        }
      }
    }
    record('causal_chains', '核心主張具備完整因果鏈', issues)
  }

  const failedSections: SectionDiagnosis[] = [...sectionIssues.entries()].map(
    ([sectionId, diagnosis]) => ({
      sectionId,
      heading: diagnosis.heading,
      issues: diagnosis.issues
    })
  )
  const failedCriteria = criteria.filter((criterion) => !criterion.pass)
  const summary =
    failedCriteria.length === 0
      ? '已通過品質檢查'
      : failedCriteria.map((criterion) => criterion.label).join('、') + '未達標'
  return {
    pass: failedCriteria.length === 0,
    criteria,
    failedSections,
    summary
  }
}

/* ---------- 回歸案例文字級篩檢 ---------- */

/**
 * 對「最終顯示文字」做文字級品質篩檢（完整評分器的子集）：
 * 供回歸評測集重放使用者標記過的壞解說（trace 只保存 finalText，沒有結構化答案）。
 * 任何會被完整評分器擋下的空泛／唯分數／無因果輸出，在這裡也必須被擋下。
 */
export function screenExplanationText(
  text: string,
  availableMoves: string[]
): string[] {
  const issues: string[] = []
  if (!compactChineseText(text)) {
    return ['解說內容為空。']
  }
  if (scoreUsedAsReason(text)) {
    issues.push('以分數高低代替棋理原因。')
  }
  if (/(?:。；|；。|。。|，。)/u.test(text)) {
    issues.push('出現連續或互相衝突的中文標點，影響閱讀流暢度。')
  }
  const honest = acknowledgesInsufficiency(text)
  if (!honest) {
    if (
      availableMoves.length >= 2 &&
      distinctMentionedMoves(text, availableMoves) < 2
    ) {
      issues.push('沒有把因果連回至少兩步主線著法。')
    }
    if (!containsConcreteXiangqiTerm(text)) {
      issues.push('沒有使用具體象棋詞彙指出位置、棋子關係或威脅。')
    }
    if (!CAUSAL_CONNECTIVES.test(text)) {
      issues.push('缺少因果語句，看不出著法如何造成後果。')
    }
  }
  const hasSubstance =
    mentionsAnyMove(text, availableMoves) || containsConcreteXiangqiTerm(text)
  if (VAGUE_PHRASES.some((phrase) => text.includes(phrase)) && !hasSubstance) {
    issues.push('使用空泛詞而沒有任何具體著法或機制詞。')
  }
  return issues
}
