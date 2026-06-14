import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { START_FEN } from '../src/shared/types/BoardState'
import {
  assertJsonSize,
  normalizeApiKey,
  normalizeEnginePath,
  SecurityValidationError,
  validateAnalyzePositionPayload,
  validateGenerateExplanationPayload
} from '../src/main/security/InputValidation'
import {
  isAllowedExternalUrl,
  isTrustedRendererUrl
} from '../src/main/security/IpcSecurity'
import { resolveRendererAssetPath } from '../src/main/security/RendererPath'
import {
  readJsonFile,
  SecureFileError,
  writeJsonFileAtomic
} from '../src/main/storage/SecureJsonFile'

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

function rejects(fn: () => unknown, errorType: typeof Error = Error): boolean {
  try {
    fn()
    return false
  } catch (error) {
    return error instanceof errorType
  }
}

console.log('\n## L2 資安基線')

check('只允許無帳密的 HTTPS 外部連結', isAllowedExternalUrl('https://example.com/help'))
check('拒絕 HTTP 外部連結', !isAllowedExternalUrl('http://example.com'))
check('拒絕帶帳密的外部連結', !isAllowedExternalUrl('https://user:pass@example.com'))
check('拒絕非標準 HTTPS 連接埠', !isAllowedExternalUrl('https://example.com:8443'))
check(
  'IPC renderer URL 必須完全相符',
  isTrustedRendererUrl('xqa://app/index.html', 'xqa://app/index.html') &&
    !isTrustedRendererUrl('xqa://app/other.html', 'xqa://app/index.html')
)

const rendererRoot = resolve('out/renderer')
check(
  '自訂協定解析正常資產',
  resolveRendererAssetPath(rendererRoot, 'xqa://app/assets/main.js') ===
    resolve(rendererRoot, 'assets/main.js')
)
check(
  '自訂協定拒絕其他 host',
  resolveRendererAssetPath(rendererRoot, 'xqa://attacker/index.html') === null
)
check(
  '自訂協定拒絕 Windows 反斜線路徑穿越',
  resolveRendererAssetPath(rendererRoot, 'xqa://app/..%5Csecrets.json') === null
)

const analysisPayload = validateAnalyzePositionPayload({
  requestId: 'analysis-1',
  positionFen: START_FEN,
  userMove: 'h2e2',
  analysisConfig: {
    rootAnalysisMovetimeMs: 3000,
    userMoveEvalMovetimeMs: 1000,
    multiPv: 3
  }
})
check('合法分析 payload 通過並正規化', analysisPayload.requestId === 'analysis-1')
check(
  'FEN 指令注入被拒絕',
  rejects(
    () =>
      validateAnalyzePositionPayload({
        ...analysisPayload,
        positionFen: `${START_FEN}\nquit`
      }),
    SecurityValidationError
  )
)
check(
  '超出範圍的分析參數被拒絕',
  rejects(
    () =>
      validateAnalyzePositionPayload({
        ...analysisPayload,
        analysisConfig: { ...analysisPayload.analysisConfig, multiPv: 1000 }
      }),
    SecurityValidationError
  )
)
check(
  '含控制字元的引擎識別碼被拒絕',
  rejects(
    () =>
      validateAnalyzePositionPayload({
        ...analysisPayload,
        engineId: 'engine\nquit'
      }),
    SecurityValidationError
  )
)

const aiPayload = validateGenerateExplanationPayload({
  requestId: 'ai-1',
  analysisId: 'session-1',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  userLevel: 'intermediate',
  explanationStyle: 'long_analytical',
  language: 'zh-TW',
  conversationHistory: []
})
check('合法 AI payload 通過', aiPayload.provider === 'anthropic')
check(
  '未知 Provider 被拒絕',
  rejects(
    () => validateGenerateExplanationPayload({ ...aiPayload, provider: 'unknown' }),
    SecurityValidationError
  )
)
check(
  '含換行的 API key 被拒絕',
  rejects(() => normalizeApiKey('sk-valid-value\nInjected: yes'), SecurityValidationError)
)
check(
  '單一 API Key 欄位自動辨識 Claude',
  normalizeApiKey('sk-ant-test-value').provider === 'anthropic'
)
check(
  '單一 API Key 欄位自動辨識 Gemini',
  normalizeApiKey('AIza-test-value').provider === 'gemini'
)
check(
  '單一 API Key 欄位自動辨識 OpenAI',
  normalizeApiKey('sk-test-value').provider === 'openai'
)
check(
  '未知 API Key 格式被拒絕',
  rejects(() => normalizeApiKey('unknown-key'), SecurityValidationError)
)
check(
  '相對引擎路徑被拒絕',
  rejects(() => normalizeEnginePath('engine.exe', 'win32'), SecurityValidationError)
)
check(
  'Windows 網路共享引擎路徑被拒絕',
  rejects(
    () => normalizeEnginePath('\\\\server\\share\\engine.exe', 'win32'),
    SecurityValidationError
  )
)
check(
  '過大 JSON payload 被拒絕',
  rejects(() => assertJsonSize({ text: 'x'.repeat(1024) }, 128, '測試'), SecurityValidationError)
)

const tempDir = mkdtempSync(join(tmpdir(), 'xqa-security-'))
try {
  const filePath = join(tempDir, 'data.json')
  writeJsonFileAtomic(filePath, { version: 1 }, 1024)
  writeJsonFileAtomic(filePath, { version: 2 }, 1024)
  check('原子寫入可安全取代既有 JSON', readJsonFile<{ version: number }>(filePath, 1024).version === 2)
  check(
    '原子寫入不殘留暫存檔',
    readdirSync(tempDir).every((name) => !name.endsWith('.tmp'))
  )

  const oversizedPath = join(tempDir, 'oversized.json')
  writeFileSync(oversizedPath, JSON.stringify({ text: 'x'.repeat(2048) }), 'utf8')
  check(
    '讀取前先拒絕超大 JSON 檔',
    rejects(() => readJsonFile(oversizedPath, 128), SecureFileError)
  )
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

const mainSource = readFileSync(resolve('src/main/index.ts'), 'utf8')
const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8')
const updaterSource = readFileSync(
  resolve('src/main/update/AppUpdaterService.ts'),
  'utf8'
)
const updaterPublishConfig = readFileSync(
  resolve('electron-builder.publish.cjs'),
  'utf8'
)
const rendererHtml = readFileSync(resolve('src/renderer/index.html'), 'utf8')
check('Electron renderer sandbox 已啟用', mainSource.includes('sandbox: true'))
check('Node integration 明確停用', mainSource.includes('nodeIntegration: false'))
check('生產版停用 DevTools', mainSource.includes('devTools: isDev'))
check(
  'CSP 由建置階段注入嚴格政策',
  rendererHtml.includes('content="__XQA_CSP__"')
)
check(
  'ASAR 完整性與 onlyLoadAppFromAsar fuse 已啟用',
  builderConfig.includes('enableEmbeddedAsarIntegrityValidation: true') &&
    builderConfig.includes('onlyLoadAppFromAsar: true')
)
check(
  'Node CLI 與 file protocol 特權 fuse 已停用',
  builderConfig.includes('enableNodeOptionsEnvironmentVariable: false') &&
    builderConfig.includes('enableNodeCliInspectArguments: false') &&
    builderConfig.includes('grantFileProtocolExtraPrivileges: false')
)
check(
  'Windows 發佈版使用正式應用程式圖示',
  builderConfig.includes('icon: build/icon.png') &&
    builderConfig.includes('from: build/icon.png')
)
check(
  '更新 IPC 驗證 renderer 來源',
  updaterSource.includes('assertTrustedIpcSender(event)')
)
check(
  '自動更新僅在打包版且有 app-update.yml 時啟用',
  updaterSource.includes("existsSync(join(process.resourcesPath, 'app-update.yml'))") &&
    updaterSource.includes('app.isPackaged')
)
check(
  '更新來源只允許無帳密的標準 HTTPS',
  updaterPublishConfig.includes("updateUrl.protocol !== 'https:'") &&
    updaterPublishConfig.includes('updateUrl.username') &&
    updaterPublishConfig.includes("updateUrl.port !== '443'")
)

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exit(1)
