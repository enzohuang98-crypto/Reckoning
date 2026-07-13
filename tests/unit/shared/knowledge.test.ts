import {
  XIANGQI_KNOWLEDGE_BASE,
  findXiangqiKnowledgeEntry,
  formatXiangqiKnowledgeForPrompt,
  selectXiangqiKnowledge
} from '../../../src/shared/logic/ai/xiangqiKnowledge'
import { containsConcreteXiangqiTerm } from '../../../src/shared/logic/ai/xiangqiTerms'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  }
}

console.log('\n## 結構化中國象棋知識庫')
check(
  '知識庫至少涵蓋 100 條可檢索知識',
  XIANGQI_KNOWLEDGE_BASE.length >= 100,
  XIANGQI_KNOWLEDGE_BASE.length
)
check(
  '每一條知識都有唯一 id',
  new Set(XIANGQI_KNOWLEDGE_BASE.map((entry) => entry.id)).size ===
    XIANGQI_KNOWLEDGE_BASE.length
)
const categories = new Set(XIANGQI_KNOWLEDGE_BASE.map((entry) => entry.category))
for (const category of [
  'official_rule',
  'board',
  'piece_state',
  'tactic',
  'mate_pattern',
  'opening',
  'strategy',
  'endgame'
] as const) {
  check(`涵蓋 ${category} 類別`, categories.has(category))
}
check(
  '繁簡別名可找到臥槽馬',
  findXiangqiKnowledgeEntry('卧槽马')?.term === '臥槽馬'
)
const selected = selectXiangqiKnowledge(
  '馬走到臥槽位置，準備攻擊九宮與將帥',
  { limit: 8 }
)
check(
  '檢索會把臥槽馬排入相關知識',
  selected.some((entry) => entry.term === '臥槽馬')
)
check('檢索結果受數量上限約束', selected.length <= 8)
const prompt = formatXiangqiKnowledgeForPrompt(selected)
check('prompt 明示知識不能冒充引擎證據', prompt.includes('不得冒充引擎證據'))
check(
  'prompt 包含證據使用規則',
  selected.every((entry) => prompt.includes(entry.evidenceRule))
)
check(
  '緩手、失先、陣形變差等評價標籤不能冒充具體機制',
  !containsConcreteXiangqiTerm('這步是緩手，會失去先手，陣形也會變差。')
)
check(
  '具體棋子、線路或位置關係可通過術語檢查',
  containsConcreteXiangqiTerm('中炮壓住中路，讓正馬的馬路受到限制。')
)

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
