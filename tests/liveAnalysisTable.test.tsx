import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { EngineAnalysisResultPayload } from '../src/shared/types/ipc'
import {
  analysisStatusLabel,
  appendThought,
  continuationAfterBestMove,
  MAX_ENGINE_THOUGHTS,
  newestFirst,
  resultNotice,
  type EngineThoughtEntry
} from '../src/renderer/src/features/analysis/LiveAnalysisTable'

let passed = 0
let failed = 0

function check(name: string, run: () => void): void {
  try {
    run()
    console.log('  ✓ ' + name)
    passed += 1
  } catch (error) {
    console.error('  ✗ ' + name)
    console.error(error)
    failed += 1
  }
}

function thought(
  id: string,
  overrides: Partial<EngineThoughtEntry> = {}
): EngineThoughtEntry {
  return {
    id,
    phase: 'root_analysis',
    elapsedMs: 1_200,
    depth: 12,
    displayScore: '+0.36',
    displayMove: '炮二平五',
    displayPrincipalVariation: ['炮二平五', '馬８進７'],
    engineRole: 'primary',
    engineName: 'Pikafish',
    ...overrides
  }
}

const readyStatus = {
  available: true,
  engineName: 'Pikafish'
}

const completeResult = {
  engineAnalysis: {
    incomplete: false,
    warnings: []
  },
  moveComparison: {
    confidence: 'high'
  }
} as EngineAnalysisResultPayload

console.log('\n## 即時局面分析表')

check('深度資料以最新一筆優先顯示', () => {
  const rows = newestFirst([thought('one', { depth: 8 }), thought('two', { depth: 9 })])
  assert.deepEqual(rows.map((item) => item.id), ['two', 'one'])
})

check('最佳著不會在主要變化中重複顯示', () => {
  assert.deepEqual(continuationAfterBestMove(thought('same')), ['馬８進７'])
  assert.deepEqual(
    continuationAfterBestMove(thought('different', { displayMove: '炮二平五', displayPrincipalVariation: ['馬８進７'] })),
    ['馬８進７']
  )
})

check('任意位置的相同深度資料不會重複新增', () => {
  const first = thought('first')
  const second = thought('second', { depth: 13 })
  const repeated = thought('repeated', {
    phase: 'user_move_analysis',
    selDepth: 19,
    elapsedMs: 4_200
  })
  const entries = appendThought(appendThought([first], second), repeated)
  assert.deepEqual(entries.map((item) => item.id), ['first', 'second'])
})

check('前端歷程維持最多 80 筆並保留最新資料', () => {
  let entries: EngineThoughtEntry[] = []
  for (let index = 0; index <= MAX_ENGINE_THOUGHTS; index += 1) {
    entries = appendThought(entries, thought(String(index), { depth: index }))
  }
  assert.equal(entries.length, MAX_ENGINE_THOUGHTS)
  assert.equal(entries[0]?.id, '1')
  assert.equal(entries.at(-1)?.id, String(MAX_ENGINE_THOUGHTS))
})

check('狀態只使用分析中、已暫停與未就緒', () => {
  assert.equal(analysisStatusLabel(readyStatus, true), '分析中')
  assert.equal(analysisStatusLabel(readyStatus, false), '已暫停')
  assert.equal(analysisStatusLabel(null, false), '未就緒')
})

check('表格以語意欄位顯示主／複核、缺值與最新列', () => {
  const source = readFileSync(
    resolve('src/renderer/src/features/analysis/LiveAnalysisTable.tsx'),
    'utf8'
  )
  assert.match(source, /<table/)
  assert.match(source, /<thead>/)
  assert.match(source, /<tbody>/)
  assert.match(source, /類型／引擎/)
  assert.match(source, /深度/)
  assert.match(source, /時間/)
  assert.match(source, /局面評估/)
  assert.match(source, /局面分析/)
  assert.match(source, /engineRole === 'verification'/)
  assert.match(source, /className={index === 0 \? 'latest' : undefined}/)
  assert.match(source, /displayScore \?\? '—'/)
})

check('未就緒、錯誤與雙引擎分歧都有精簡且可行動的訊息', () => {
  const source = readFileSync(
    resolve('src/renderer/src/features/analysis/LiveAnalysisTable.tsx'),
    'utf8'
  )
  assert.match(source, /尚無分析資料；按「開始分析」建立局面分析/)
  assert.match(source, /請到「設定」完成引擎設定或重新測試/)
  assert.match(source, /請檢查引擎設定後再重新分析/)
  assert.match(source, /engineDisagreement/)
  assert.equal(
    resultNotice({ ...completeResult, engineDisagreement: true }),
    '主引擎與複核引擎出現分歧，請交叉確認局面分析與 AI 解說。'
  )
})

console.log('結果：' + passed + ' 通過，' + failed + ' 失敗')
if (failed > 0) process.exitCode = 1
