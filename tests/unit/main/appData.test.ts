import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APP_DATA_SCHEMA_VERSION,
  EMPTY_APP_DATA,
  mergeAppData,
  sanitizeAppData
} from '../../../src/shared/types/AppData'
import {
  APP_DATA_FILE,
  StorageService
} from '../../../src/main/storage/StorageService'
import { MAX_APP_DATA_BYTES } from '../../../src/main/security/InputValidation'

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
  conversations: [
    {
      id: 'conversation-1',
      analysisId: 'analysis-1',
      positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:01:00.000Z',
      messages: [
        {
          id: 'message-valid',
          role: 'assistant',
          text: 'Valid provenance',
          createdAt: '2026-06-12T00:00:00.000Z',
          provider: 'gemini',
          model: 'gemini-3.5-flash'
        },
        {
          id: 'message-invalid',
          role: 'assistant',
          text: 'Invalid provenance',
          createdAt: '2026-06-12T00:01:00.000Z',
          provider: { unsafe: true },
          model: { unsafe: true }
        }
      ]
    }
  ],
  mistakeBookEntries: 'invalid'
})

check('import pins current schemaVersion', sanitized.schemaVersion === APP_DATA_SCHEMA_VERSION)
check('invalid array entries are skipped', sanitized.savedPositions.length === 1)
check('wrong collection type falls back to empty array', sanitized.mistakeBookEntries.length === 0)
check('import sanitizer strips top-level apiKey fields', !JSON.stringify(sanitized).includes('should-not-survive'))
check('import sanitizer strips nested token fields', !JSON.stringify(sanitized).includes('nested-secret'))
check(
  'import sanitizer preserves valid conversation provenance',
  sanitized.conversations[0]?.messages[0]?.provider === 'gemini' &&
    sanitized.conversations[0]?.messages[0]?.model === 'gemini-3.5-flash'
)
check(
  'import sanitizer drops invalid conversation provenance without dropping the message',
  sanitized.conversations[0]?.messages[1]?.text === 'Invalid provenance' &&
    sanitized.conversations[0]?.messages[1]?.provider === undefined &&
    sanitized.conversations[0]?.messages[1]?.model === undefined
)

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

const storageDir = mkdtempSync(join(tmpdir(), 'xiangqi-app-data-'))
const appDataPath = join(storageDir, APP_DATA_FILE)
try {
  const storage = new StorageService(storageDir)
  const missing = storage.readAppData()
  check(
    'app-data.json 不存在時才使用空白資料',
    missing.schemaVersion === APP_DATA_SCHEMA_VERSION &&
      missing.savedPositions.length === 0 &&
      missing.conversations.length === 0
  )

  writeFileSync(
    appDataPath,
    JSON.stringify({
      ...EMPTY_APP_DATA,
      conversations: [
        {
          id: 'conversation-read',
          analysisId: 'analysis-read',
          positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
          createdAt: '2026-06-12T00:00:00.000Z',
          updatedAt: '2026-06-12T00:00:00.000Z',
          messages: [
            {
              id: 'message-read-valid',
              role: 'assistant',
              text: 'Valid read provenance',
              createdAt: '2026-06-12T00:00:00.000Z',
              provider: 'gemini',
              model: 'gemini-3.5-flash'
            },
            {
              id: 'message-read',
              role: 'assistant',
              text: 'Read boundary',
              createdAt: '2026-06-12T00:00:00.000Z',
              provider: 'not-a-provider',
              model: { unsafe: true }
            }
          ]
        }
      ]
    }),
    'utf8'
  )
  const normalizedRead = storage.readAppData()
  check(
    'app-data read boundary preserves valid provenance',
    normalizedRead.conversations[0]?.messages[0]?.provider === 'gemini' &&
      normalizedRead.conversations[0]?.messages[0]?.model === 'gemini-3.5-flash'
  )
  check(
    'app-data read boundary drops invalid provenance but preserves the conversation',
    normalizedRead.conversations[0]?.messages[1]?.text === 'Read boundary' &&
      normalizedRead.conversations[0]?.messages[1]?.provider === undefined &&
      normalizedRead.conversations[0]?.messages[1]?.model === undefined
  )

  storage.writeAppData(merged.snapshot)
  check(
    '有效 app-data.json 可正常讀回',
    storage.readAppData().savedPositions.length === merged.snapshot.savedPositions.length
  )

  const invalidJson = '{"schemaVersion":3,"savedPositions":['
  writeFileSync(appDataPath, invalidJson, 'utf8')
  let invalidJsonRejected = false
  try {
    storage.readAppData()
  } catch {
    invalidJsonRejected = true
  }
  check('既有 JSON 毀損時讀取會失敗', invalidJsonRejected)
  check('JSON 毀損讀取失敗後原檔保持不變', readFileSync(appDataPath, 'utf8') === invalidJson)

  const oversized = ' '.repeat(MAX_APP_DATA_BYTES + 1)
  writeFileSync(appDataPath, oversized, 'utf8')
  const oversizedBytes = statSync(appDataPath).size
  let oversizedRejected = false
  try {
    storage.readAppData()
  } catch {
    oversizedRejected = true
  }
  check('既有資料超過大小上限時讀取會失敗', oversizedRejected)
  check('超限讀取失敗後原檔大小保持不變', statSync(appDataPath).size === oversizedBytes)

  rmSync(appDataPath, { force: true })
  mkdirSync(appDataPath)
  let unreadableRejected = false
  try {
    storage.readAppData()
  } catch {
    unreadableRejected = true
  }
  check('既有 app-data 路徑不是一般檔案時讀取會失敗', unreadableRejected)
  check('讀取錯誤不會移除原始路徑', statSync(appDataPath).isDirectory())
} finally {
  rmSync(storageDir, { recursive: true, force: true })
}

console.log(`Result: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
