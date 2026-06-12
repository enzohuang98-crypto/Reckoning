import {
  APP_DATA_SCHEMA_VERSION,
  EMPTY_APP_DATA,
  mergeAppData,
  sanitizeAppData
} from '../src/shared/types/AppData'

let passed = 0
let failed = 0

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

console.log('\n## AppData 永久資料與備份')

const sanitized = sanitizeAppData({
  schemaVersion: 999,
  savedPositions: [
    {
      id: 'p1',
      name: '測試局面',
      fen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z'
    },
    { invalid: true }
  ],
  mistakeBookEntries: 'invalid'
})

check('匯入時固定目前 schemaVersion', sanitized.schemaVersion === APP_DATA_SCHEMA_VERSION)
check('無效陣列內容被略過', sanitized.savedPositions.length === 1)
check('錯誤型別回復空陣列', sanitized.mistakeBookEntries.length === 0)

const merged = mergeAppData(
  sanitized,
  {
    ...EMPTY_APP_DATA,
    savedPositions: [
      sanitized.savedPositions[0],
      {
        id: 'p2',
        name: '第二局面',
        fen: '9/9/9/9/9/9/9/9/9/9 b - - 0 1',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z'
      }
    ]
  }
)

check('重複保存局面不重複匯入', merged.summary.savedPositions === 1)
check('合併後保留原資料並加入新資料', merged.snapshot.savedPositions.length === 2)
check('備份結構不含 API Key 欄位', !JSON.stringify(merged.snapshot).includes('apiKey'))

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exit(1)
