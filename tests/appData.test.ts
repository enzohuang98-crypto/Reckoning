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

console.log('\n## AppData persistence and backup')

const sanitized = sanitizeAppData({
  schemaVersion: 999,
  savedPositions: [
    {
      id: 'p1',
      name: 'Test position',
      fen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
      apiKey: 'should-not-survive'
    },
    { invalid: true }
  ],
  misunderstoodPositions: [
    {
      id: 'm1',
      positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      reason: 'test',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
      engineAnalysis: {
        bestMove: 'a0a1',
        nested: { token: 'nested-secret' }
      }
    }
  ],
  mistakeBookEntries: 'invalid'
})

check('import pins current schemaVersion', sanitized.schemaVersion === APP_DATA_SCHEMA_VERSION)
check('invalid array entries are skipped', sanitized.savedPositions.length === 1)
check('wrong collection type falls back to empty array', sanitized.mistakeBookEntries.length === 0)
check('import sanitizer strips top-level apiKey fields', !JSON.stringify(sanitized).includes('should-not-survive'))
check('import sanitizer strips nested token fields', !JSON.stringify(sanitized).includes('nested-secret'))

const merged = mergeAppData(
  sanitized,
  {
    ...EMPTY_APP_DATA,
    savedPositions: [
      sanitized.savedPositions[0],
      {
        id: 'p2',
        name: 'Second position',
        fen: '9/9/9/9/9/9/9/9/9/9 b - - 0 1',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z'
      }
    ]
  }
)

check('duplicate saved positions are not imported twice', merged.summary.savedPositions === 1)
check('merge keeps old data and adds new data', merged.snapshot.savedPositions.length === 2)
check('backup snapshot does not contain API Key field names', !JSON.stringify(merged.snapshot).includes('apiKey'))

console.log(`Result: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
