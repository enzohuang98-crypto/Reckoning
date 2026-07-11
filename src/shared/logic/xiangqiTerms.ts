import { XIANGQI_KNOWLEDGE_BASE } from './xiangqiKnowledge'

/**
 * 這些詞適合放在教練結論裡，但本身只是評價標籤，不足以證明盤面機制。
 * 驗證器必須另外看到棋子、線路、位置或戰術關係，不能讓「失先／緩手」單獨過關。
 */
const NON_CONCRETE_LABELS = new Set([
  '先手',
  '主動',
  '失先',
  '失去先手',
  '丟先',
  '搶先',
  '爭先',
  '空间',
  '空間',
  '王區安全',
  '王区安全',
  '九宮安全',
  '九宫安全',
  '陣形',
  '阵形',
  '陣型',
  '阵型',
  '控盤',
  '控盘',
  '局面控制',
  '可控性',
  '人類可控性',
  '人类可控性',
  '容錯',
  '容错',
  '緩手',
  '缓手',
  '軟著',
  '软着',
  '棋子受限',
  '活動度',
  '活动度',
  '子力活動度',
  '子力活动度',
  '部署',
  '發展子力',
  '发展子力'
])

/**
 * 驗證器用的具體詞彙索引。資料改由結構化知識庫產生，避免「提示詞詞表」與
 * 「使用者可查的術語知識」各維護一份後逐漸不一致。
 */
export const XIANGQI_CONCRETE_TERMS: readonly string[] = [
  ...new Set(
    XIANGQI_KNOWLEDGE_BASE.flatMap((entry) => [entry.term, ...entry.aliases])
      .map((term) => term.trim())
      // 單字棋例詞容易在一般句子誤中，仍維持舊驗證器「至少兩字」規則。
      .filter((term) => term.length >= 2)
      .filter((term) => !NON_CONCRETE_LABELS.has(term))
  )
]

/** 提示與驗證錯誤訊息共用的示例片段（完整清單見 XIANGQI_CONCRETE_TERMS）。 */
export const CONCRETE_TERM_EXAMPLES =
  '牽制、蹩馬腿、塞象眼、空頭炮、沉底車、巡河、肋道、中路、亮車、抽將、雙將、失根'

export function containsConcreteXiangqiTerm(text: string): boolean {
  return XIANGQI_CONCRETE_TERMS.some((term) => text.includes(term))
}

export function findConcreteXiangqiTerms(text: string): string[] {
  return XIANGQI_CONCRETE_TERMS.filter((term) => text.includes(term))
}
