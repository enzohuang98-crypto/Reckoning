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
  cloneAppDataSnapshot,
  EMPTY_APP_DATA,
  extractRetiredStudyData,
  mergeAppData,
  parseAppDataSnapshot,
  sanitizeAppData
} from '../../../src/shared/types/AppData'
import { exportDataBackup } from '../../../src/main/ipc/dataExport'
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
check('retired collections are absent from schema v2', !('mistakeBookEntries' in sanitized) && !('misunderstoodPositions' in sanitized))
check('import sanitizer strips top-level apiKey fields', !JSON.stringify(sanitized).includes('should-not-survive'))
const retired = extractRetiredStudyData(
  {
    schemaVersion: 1,
    mistakeBookEntries: [{ id: 'old', apiKey: 'secret' }],
    misunderstoodPositions: [{ id: 'old-2', nested: { token: 'nested-secret' } }]
  },
  '2026-08-25T00:00:00.000Z'
)
check('retired data is extracted before migration', retired?.mistakeBookEntries.length === 1 && retired.misunderstoodPositions.length === 1)
check('retired backup strips sensitive fields', !JSON.stringify(retired).includes('secret'))
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
const cloned = cloneAppDataSnapshot(merged.snapshot)
cloned.savedPositions[0]!.name = 'mutated clone'
cloned.conversations[0]!.messages[0]!.text = 'mutated clone message'
check(
  'current data snapshot is deeply cloned before export',
  merged.snapshot.savedPositions[0]?.name !== 'mutated clone' &&
    merged.snapshot.conversations[0]?.messages[0]?.text !== 'mutated clone message'
)
check(
  'complete current snapshot passes strict export validation',
  parseAppDataSnapshot(merged.snapshot)?.savedPositions.length === 2
)
check(
  'malformed export snapshot is rejected instead of sanitized to empty data',
  parseAppDataSnapshot({
    ...merged.snapshot,
    savedPositions: [{ invalid: true }]
  }) === null
)

async function runBackupChecks(): Promise<void> {
let backupWriteCount = 0
let writtenBackup: unknown = null
const liveSnapshot = {
  ...merged.snapshot,
  savedPositions: [
    ...merged.snapshot.savedPositions,
    {
      id: 'live-position',
      name: 'Live position',
      fen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z'
    }
  ],
  conversations: [
    ...merged.snapshot.conversations,
    {
      id: 'live-conversation',
      analysisId: 'live-analysis',
      positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      messages: []
    }
  ]
}
const backupStorage = {
  async readAppDataWithMigration() {
    return merged.snapshot
  },
  async writeAbsoluteAsync(_path: string, data: unknown) {
    backupWriteCount++
    writtenBackup = data
  }
}
const liveExport = await exportDataBackup(
  backupStorage,
  'C:\\backup\\live.json',
  liveSnapshot
)
check(
  'backup includes unsaved in-memory position and conversation',
  liveExport.ok &&
    (writtenBackup as typeof liveSnapshot).savedPositions.some((item) => item.id === 'live-position') &&
    (writtenBackup as typeof liveSnapshot).conversations.some((item) => item.id === 'live-conversation')
)
const writesBeforeCancel = backupWriteCount
const cancelledExport = await exportDataBackup(backupStorage, null, liveSnapshot)
check(
  'cancelled backup does not mutate source or write a file',
  cancelledExport.ok === false && cancelledExport.cancelled === true &&
    backupWriteCount === writesBeforeCancel
)
const failingExport = await exportDataBackup(
  {
    ...backupStorage,
    async writeAbsoluteAsync() {
      throw new Error('synthetic destination failure')
    }
  },
  'C:\\backup\\failed.json',
  liveSnapshot
)
check('synthetic backup write failure returns failure', failingExport.ok === false)
const oversizedSnapshot = {
  ...EMPTY_APP_DATA,
  savedPositions: [
    {
      id: 'oversized',
      name: 'x'.repeat(MAX_APP_DATA_BYTES),
      fen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z'
    }
  ]
}
const invalidExport = await exportDataBackup(
  backupStorage,
  'C:\\backup\\invalid.json',
  { ...liveSnapshot, savedPositions: [{ invalid: true }] }
)
const oversizedExport = await exportDataBackup(
  backupStorage,
  'C:\\backup\\oversized.json',
  oversizedSnapshot
)
check('invalid backup snapshot is rejected', invalidExport.ok === false)
check('oversized backup snapshot is rejected', oversizedExport.ok === false)
}

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

void runBackupChecks()
  .then(() => {
    console.log(`Result: ${passed} passed, ${failed} failed`)
    if (failed > 0) process.exit(1)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
