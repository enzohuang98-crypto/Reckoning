import {
  XIANGQI_KNOWLEDGE_BASE,
  selectXiangqiKnowledge
} from '../../../src/shared/logic/ai/xiangqiKnowledge'

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
const selected = selectXiangqiKnowledge(
  '馬走到臥槽位置，準備攻擊九宮與將帥',
  { limit: 8 }
)
check(
  '檢索會把臥槽馬排入相關知識',
  selected.some((entry) => entry.term === '臥槽馬')
)
check('檢索結果受數量上限約束', selected.length <= 8)

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
