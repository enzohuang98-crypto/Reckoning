import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { START_FEN } from '../../src/shared/types/BoardState'
import {
  assertJsonSize,
  normalizeAiBaseUrl,
  normalizeApiKey,
  normalizeEnginePath,
  SecurityValidationError,
  validateAnalyzePositionPayload,
  validateGenerateExplanationPayload
} from '../../src/main/security/InputValidation'
import {
  isAllowedExternalUrl,
  isTrustedRendererUrl
} from '../../src/main/security/IpcSecurity'
import { resolveRendererAssetPath } from '../../src/main/security/RendererPath'
import {
  readJsonFile,
  SecureFileError,
  writeJsonFileAtomic
} from '../../src/main/storage/SecureJsonFile'
import { PikafishAdapter } from '../../src/main/engine/PikafishAdapter'
import {
  assertProviderEndpointBinding,
  ProviderEndpointMismatchError
} from '../../src/main/ipc/aiExplanationHandlers'

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
  '明確選擇相容服務時可接受供應商自訂金鑰',
  normalizeApiKey('moonshot-provider-key', 'openai-compatible').provider ===
    'openai-compatible'
)
check(
  '遠端相容服務只接受標準 HTTPS',
  normalizeAiBaseUrl('https://api.deepseek.com/v1') ===
    'https://api.deepseek.com/v1'
)
check(
  'Ollama／LM Studio 可使用本機 HTTP loopback',
  normalizeAiBaseUrl('http://127.0.0.1:11434/v1/') ===
    'http://127.0.0.1:11434/v1'
)
check(
  '拒絕非本機 HTTP AI 端點',
  rejects(
    () => normalizeAiBaseUrl('http://api.example.com/v1'),
    SecurityValidationError
  )
)
check(
  '拒絕帶帳密或 query 的 AI 端點',
  rejects(
    () => normalizeAiBaseUrl('https://user:pass@example.com/v1?token=secret'),
    SecurityValidationError
  )
)
check(
  '相容 API Key 只能送往儲存時綁定的端點',
  rejects(
    () =>
      assertProviderEndpointBinding(
        'openai-compatible',
        'https://attacker.example/v1',
        'provider-secret',
        'https://api.deepseek.com'
      ),
    ProviderEndpointMismatchError
  )
)
check(
  '相容 API Key 與綁定端點一致時可使用',
  (() => {
    assertProviderEndpointBinding(
      'openai-compatible',
      'https://api.deepseek.com',
      'provider-secret',
      'https://api.deepseek.com'
    )
    return true
  })()
)
check(
  '本機免金鑰端點不需要端點綁定',
  (() => {
    assertProviderEndpointBinding(
      'openai-compatible',
      'http://127.0.0.1:11434/v1',
      '',
      null
    )
    return true
  })()
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
  '含控制字元的引擎路徑被拒絕',
  rejects(() => normalizeEnginePath('C:\\Engines\\bad\nengine.exe', 'win32'), SecurityValidationError)
)
check(
  '引擎路徑會正規化 dot-segment',
  normalizeEnginePath('C:\\Engines\\..\\Engines\\pikafish.exe', 'win32') ===
    'C:\\Engines\\pikafish.exe'
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

const originalCwd = process.cwd()
const originalRendererUrl = process.env.ELECTRON_RENDERER_URL
const originalNodeEnv = process.env.NODE_ENV
const originalPikafishPath = process.env.PIKAFISH_PATH
const cwdEngineDir = mkdtempSync(join(tmpdir(), 'xqa-cwd-engine-'))
try {
  const fakeEngineDir = join(cwdEngineDir, 'resources', 'engine')
  writeJsonFileAtomic(join(fakeEngineDir, 'placeholder.json'), { ok: true }, 1024)
  writeFileSync(join(fakeEngineDir, 'pikafish.exe'), '', 'utf8')
  delete process.env.ELECTRON_RENDERER_URL
  delete process.env.NODE_ENV
  delete process.env.PIKAFISH_PATH
  process.chdir(cwdEngineDir)
  check(
    '正式執行環境不從目前工作目錄載入預設引擎',
    new PikafishAdapter().resolveEnginePath() === null
  )
  process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
  check(
    '開發環境才允許從目前工作目錄載入測試引擎',
    new PikafishAdapter().resolveEnginePath() === join(fakeEngineDir, 'pikafish.exe')
  )
} finally {
  process.chdir(originalCwd)
  if (originalRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = originalRendererUrl
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalPikafishPath === undefined) delete process.env.PIKAFISH_PATH
  else process.env.PIKAFISH_PATH = originalPikafishPath
  rmSync(cwdEngineDir, { recursive: true, force: true })
}

const mainSource = readFileSync(resolve('src/main/index.ts'), 'utf8')
const browserSecuritySource = readFileSync(
  resolve('src/main/security/BrowserSecurity.ts'),
  'utf8'
)
const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8')
const updaterSource = readFileSync(
  resolve('src/main/update/AppUpdaterService.ts'),
  'utf8'
)
const updaterPublishConfig = readFileSync(
  resolve('electron-builder.publish.cjs'),
  'utf8'
)
const updateBuildScript = readFileSync(
  resolve('tools/release/build-github-update.ps1'),
  'utf8'
)
const updateVerifyScript = readFileSync(
  resolve('tools/release/verify-update-artifacts.ps1'),
  'utf8'
)
const updatePublishScript = readFileSync(
  resolve('tools/release/publish-github-update.ps1'),
  'utf8'
)
const ciWorkflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
const releaseWorkflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
const rendererHtml = readFileSync(resolve('src/renderer/index.html'), 'utf8')
check(
  'Production renderer protocol avoids blocked file net.fetch',
  browserSecuritySource.includes('readFileSync(filePath)') &&
    !browserSecuritySource.includes('net.fetch')
)
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
  builderConfig.includes('icon: resources/packaging/icon.ico') &&
    builderConfig.includes('from: resources/packaging/icon.png')
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
check(
  '更新封裝腳本不會吞掉 build 失敗',
  updateBuildScript.includes('if ($LASTEXITCODE -ne 0)') &&
    updateBuildScript.includes('npm.cmd run dist:update failed')
)
check(
  '更新封裝腳本拒絕缺失或過期產物',
  updateBuildScript.includes('Missing auto-update artifact') &&
    updateBuildScript.includes('Auto-update artifact was not freshly built')
)
check(
  '更新 metadata 會驗證版本、路徑與安裝檔 SHA-512',
  updateVerifyScript.includes('latest.yml version does not match') &&
    updateVerifyScript.includes('latest.yml path does not match') &&
    updateVerifyScript.includes('SHA-512 does not match')
)
check(
  '更新 metadata 驗證不依賴 runner 可能缺失的 PowerShell Security 模組',
  !updateVerifyScript.includes('Get-AuthenticodeSignature') &&
    updateVerifyScript.includes('Authenticode policy is verified separately')
)
check(
  '更新發布保留歷史版本並檢查 Git push 失敗',
  !updatePublishScript.includes("Get-ChildItem -LiteralPath $downloadDir -File -Filter 'xiangqi-analyzer-*-setup.exe*'") &&
    updatePublishScript.includes('Unable to push update artifacts')
)
check(
  'CI 會編譯假引擎並執行完整品質門檻',
  ciWorkflow.includes('tests\\support\\fake-engine.exe') &&
    ciWorkflow.includes('npm run typecheck') &&
    ciWorkflow.includes('npm test') &&
    ciWorkflow.includes('npm run security:audit') &&
    ciWorkflow.includes('npm run build')
)
check(
  'Release workflow 預設拒絕缺少受信任憑證的未簽章發行',
  releaseWorkflow.includes('WINDOWS_CSC_LINK') &&
    releaseWorkflow.includes('allow_unsigned') &&
    releaseWorkflow.includes('signtool.exe') &&
    releaseWorkflow.includes('No signature found') &&
    releaseWorkflow.includes('$verifyExitCode -ne 0') &&
    releaseWorkflow.includes('$global:LASTEXITCODE = 0')
)

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exit(1)
