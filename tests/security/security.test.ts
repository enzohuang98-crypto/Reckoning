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
import {
  EnginePathGrantError,
  EnginePathGrantStore
} from '../../src/main/security/EnginePathGrantStore'

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
  userMoveReason: '想先活通車路',
  conversationHistory: []
})
check('合法 AI payload 通過', aiPayload.provider === 'anthropic')
check('棋手原始想法會被正規化保留', aiPayload.userMoveReason === '想先活通車路')
check(
  '過長的棋手原始想法被拒絕',
  rejects(
    () =>
      validateGenerateExplanationPayload({
        ...aiPayload,
        userMoveReason: '想'.repeat(4001)
      }),
    SecurityValidationError
  )
)
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
  '單一 API Key 欄位自動辨識 Gemini 授權型金鑰',
  normalizeApiKey('AQ.test-auth-key').provider === 'gemini'
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
  '即使指定 preferredProvider，貼錯欄位的 Anthropic 金鑰也會被 openai 拒絕',
  rejects(() => normalizeApiKey('sk-ant-real-anthropic-key', 'openai'), SecurityValidationError)
)
check(
  '即使指定 preferredProvider，貼錯欄位的 Gemini 金鑰也會被 anthropic 拒絕',
  rejects(() => normalizeApiKey('AIza-real-gemini-key', 'anthropic'), SecurityValidationError)
)
check(
  '即使指定 preferredProvider，貼錯欄位的 OpenAI 金鑰也會被 gemini 拒絕',
  rejects(() => normalizeApiKey('sk-real-openai-key', 'gemini'), SecurityValidationError)
)
check(
  '指定 preferredProvider 且格式正確時仍可通過',
  normalizeApiKey('sk-ant-real-anthropic-key', 'anthropic').provider === 'anthropic'
)
check(
  '指定 Gemini preferredProvider 時授權型金鑰仍可通過',
  normalizeApiKey('AQ.real-gemini-auth-key', 'gemini').provider === 'gemini'
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
const installerInclude = readFileSync(
  resolve('resources/packaging/custom-installer.nsh'),
  'utf8'
)
const updaterSource = readFileSync(
  resolve('src/main/update/AppUpdaterService.ts'),
  'utf8'
)
const updaterPublishConfig = readFileSync(
  resolve('electron-builder.publish.cjs'),
  'utf8'
)
const aiHandlerSource = readFileSync(
  resolve('src/main/ipc/aiExplanationHandlers.ts'),
  'utf8'
)
const engineHandlerSource = readFileSync(
  resolve('src/main/ipc/engineAnalysisHandlers.ts'),
  'utf8'
)
const preloadSource = readFileSync(resolve('src/preload/index.ts'), 'utf8')
const secureJsonSource = readFileSync(
  resolve('src/main/storage/SecureJsonFile.ts'),
  'utf8'
)
const aiProviderSources = [
  'AnthropicProvider.ts',
  'OpenAIProvider.ts',
  'GeminiProvider.ts',
  'OpenAICompatibleProvider.ts'
].map((name) =>
  readFileSync(resolve('src/main/ai/providers', name), 'utf8')
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
const installerSmokeScript = readFileSync(
  resolve('tools/release/smoke-installer.ps1'),
  'utf8'
)
const ciWorkflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
  .replace(/\r\n/g, '\n')
const releaseWorkflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8')
  .replace(/\r\n/g, '\n')
const compileFakeEngineAction = readFileSync(
  resolve('.github/actions/compile-fake-engine/action.yml'),
  'utf8'
)
const verifySignatureScript = readFileSync(
  resolve('tools/release/verify-signature.ps1'),
  'utf8'
)

let grantClock = 1_000
const enginePathGrants = new EnginePathGrantStore(500, () => grantClock)
const selectedPath = 'C:\\Engines\\pikafish.exe'
const validGrant = enginePathGrants.issue(7, selectedPath)
check(
  'Native picker grant 綁定 sender 且只可使用一次',
  enginePathGrants.consume(7, validGrant) === selectedPath &&
    rejects(() => enginePathGrants.consume(7, validGrant), EnginePathGrantError)
)
const wrongSenderGrant = enginePathGrants.issue(7, selectedPath)
check(
  '其他 renderer sender 無法使用 picker grant',
  rejects(
    () => enginePathGrants.consume(8, wrongSenderGrant),
    EnginePathGrantError
  )
)
const expiredGrant = enginePathGrants.issue(7, selectedPath)
grantClock += 501
check(
  'Picker grant 逾時後 fail closed',
  rejects(() => enginePathGrants.consume(7, expiredGrant), EnginePathGrantError)
)
const clientEvidenceScript = readFileSync(
  resolve('tools/release/validate-client-evidence.ps1'),
  'utf8'
)
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
  '自動更新固定使用官方 GitHub Release 且不內嵌權杖',
  updaterPublishConfig.includes("provider: 'github'") &&
    updaterPublishConfig.includes("owner: 'enzohuang98-crypto'") &&
    updaterPublishConfig.includes("repo: 'Reckoning'") &&
    !updaterPublishConfig.toLowerCase().includes('token')
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
  '更新 metadata 會驗證版本、路徑、大小、ProductVersion 與安裝檔 SHA-512',
  updateVerifyScript.includes('latest.yml version does not match') &&
    updateVerifyScript.includes('latest.yml path does not match') &&
    updateVerifyScript.includes('latest.yml size does not match') &&
    updateVerifyScript.includes('Setup ProductVersion') &&
    updateVerifyScript.includes('SHA-512 does not match')
)
check(
  '更新封裝會驗證 GitHub repository 並拒絕超過 Release asset 上限',
  updateBuildScript.includes('Packaged updater configuration does not match') &&
    updateVerifyScript.includes('$maximumGitHubReleaseAssetBytes = 2GB') &&
    updateVerifyScript.includes('too large for a GitHub Release asset')
)
check(
  '更新 metadata 驗證不依賴 runner 可能缺失的 PowerShell Security 模組',
  !updateVerifyScript.includes('Get-AuthenticodeSignature') &&
    updateVerifyScript.includes('Authenticode policy is verified separately')
)
check(
  '更新發布只覆寫指定 Release 資產並檢查上傳失敗',
  updatePublishScript.includes('gh release upload') &&
    updatePublishScript.includes('--clobber') &&
    updatePublishScript.includes('Unable to upload update artifacts') &&
    updatePublishScript.includes("'verify-signature.ps1'")
)
check(
  '所有 AI transport 都拒絕 redirect，Anthropic 在 SDK 解析前限制回應 bytes',
  aiProviderSources.slice(1).every((source) =>
    source.includes("redirect: 'error'")
  ) &&
    aiProviderSources[0].includes('fetchAiResponseBounded') &&
    readFileSync(resolve('src/main/ai/http.ts'), 'utf8').includes(
      "redirect: 'error'"
    )
)
check(
  '金鑰實際推論由 main process 限制並合併重複工作',
  aiHandlerSource.includes('new KeyedOperationGate(2)') &&
    aiHandlerSource.includes('credentialTestGate.run') &&
    aiHandlerSource.includes("createHash('sha256')")
)
check(
  '引擎路徑只能使用 native picker 的 sender-bound 單次 grant',
  engineHandlerSource.includes('enginePathGrants.issue(event.sender.id') &&
    engineHandlerSource.includes('enginePathGrants.consume(') &&
    preloadSource.includes('selectionToken') &&
    !preloadSource.includes('setPath: (path:')
)
check(
  '引擎測試有全域 admission，重複分析 requestId 不再替換既有工作',
  engineHandlerSource.includes('engineTestGate.run') &&
    engineHandlerSource.includes('相同的分析工作仍在進行') &&
    !engineHandlerSource.includes('previous.controller.abort()')
)
check(
  'JSON 匯入以單一 descriptor 做 bounded read',
  secureJsonSource.includes('openSync(filePath, READ_ONLY_NO_FOLLOW)') &&
    secureJsonSource.includes('fstatSync(fd)') &&
    secureJsonSource.includes('maxBytes + 1 - total') &&
    !secureJsonSource.includes('readFileSync(filePath')
)
check(
  '互動式安裝頁以 App registry 與主程式檔判斷全新安裝或升級',
  builderConfig.includes('include: resources/packaging/custom-installer.nsh') &&
    installerInclude.includes('StrCpy $hasPerMachineInstallation "0"') &&
    installerInclude.includes('StrCpy $hasPerUserInstallation "0"') &&
    installerInclude.includes('ReadRegStr $perMachineInstallationFolder HKLM') &&
    installerInclude.includes('ReadRegStr $perUserInstallationFolder HKCU') &&
    installerInclude.includes('${FileExists} "$perMachineInstallationFolder') &&
    installerInclude.includes('${FileExists} "$perUserInstallationFolder')
)
check(
  '安裝流程明確寫入 App 登錄且 Release 會驗證完整安裝與解除安裝生命週期',
  installerInclude.includes('!macro customInstall') &&
    installerInclude.includes('writeReliableRegistration HKCU "/currentuser"') &&
    installerInclude.includes('writeReliableRegistration HKLM "/allusers"') &&
    installerInclude.includes('ReadRegStr $R7 ${ROOT}') &&
    installerInclude.includes('RMDir /r "$LOCALAPPDATA\\xiangqi-analyzer-updater"') &&
    installerSmokeScript.includes("$appGuid = 'c3970037-5aa0-51b0-95c7-b57bf9f33552'") &&
    installerSmokeScript.includes('Installer smoke checks passed') &&
    installerSmokeScript.includes('Silent uninstall cleanup passed') &&
    releaseWorkflow.includes('-File tools/release/smoke-installer.ps1') &&
    installerSmokeScript.includes('ExpectedSha256') &&
    installerSmokeScript.includes('TimeStamperCertificate')
)
check(
  'CI 會編譯假引擎並執行完整品質門檻',
  ciWorkflow.includes('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1') &&
    ciWorkflow.includes('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020') &&
    ciWorkflow.includes('persist-credentials: false') &&
    ciWorkflow.includes('uses: ./.github/actions/compile-fake-engine') &&
    compileFakeEngineAction.includes('tests\\support\\fake-engine.exe') &&
    ciWorkflow.includes('npm run typecheck') &&
    ciWorkflow.includes('npm test') &&
    ciWorkflow.includes('npm run security:audit') &&
    ciWorkflow.includes('npm run build')
)
check(
  'Release workflow 的未簽章模式必須明示、保留完整測試與安裝檢查，且公開警告',
  builderConfig.includes('forceCodeSigning: true') &&
    releaseWorkflow.includes(
      "if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"
    ) &&
    releaseWorkflow.includes('uses: ./.github/actions/compile-fake-engine') &&
    releaseWorkflow.includes('npm run typecheck') &&
    releaseWorkflow.includes('npm test') &&
    releaseWorkflow.includes('npm run security:audit') &&
    releaseWorkflow.includes('forceCodeSigning: false') &&
    releaseWorkflow.includes('SignatureStatus]::NotSigned') &&
    releaseWorkflow.includes('-AllowUnsigned') &&
    releaseWorkflow.includes('Windows SmartScreen may warn or block it') &&
    installerSmokeScript.includes('[switch]$AllowUnsigned') &&
    installerSmokeScript.includes('SignatureStatus]::NotSigned') &&
    verifySignatureScript.includes('SignatureStatus]::Valid') &&
    verifySignatureScript.includes('TimeStamperCertificate')
)
check(
  'Release 只把 Windows Server 當代理，Latest 前強制核對 Win10 22H2 與 Win11 用戶端',
  releaseWorkflow.includes('Windows Server 2022 compatibility proxy') &&
    releaseWorkflow.includes('Windows Server 2025 compatibility proxy') &&
    releaseWorkflow.includes('environment:') &&
    releaseWorkflow.includes('windows-client-release') &&
    releaseWorkflow.includes('WINDOWS_10_CLIENT_EVIDENCE_URL') &&
    releaseWorkflow.includes('WINDOWS_10_CLIENT_EVIDENCE_SHA256') &&
    releaseWorkflow.includes('WINDOWS_11_CLIENT_EVIDENCE_URL') &&
    releaseWorkflow.includes('WINDOWS_11_CLIENT_EVIDENCE_SHA256') &&
    releaseWorkflow.indexOf('name: Promote validated candidate to latest') >
      releaseWorkflow.indexOf('name: Require clean Windows 10 22H2') &&
    clientEvidenceScript.includes("displayVersion -ne '22H2'") &&
    clientEvidenceScript.includes('$buildNumber -ne 19045') &&
    clientEvidenceScript.includes("productType -ne 'client'") &&
    clientEvidenceScript.includes('markOfTheWebPresent') &&
    clientEvidenceScript.includes('pikafishSearchCompleted') &&
    clientEvidenceScript.includes('authenticodeStatus') &&
    clientEvidenceScript.includes('protected SHA-256') &&
    clientEvidenceScript.includes('$ExpectedReleaseTag') &&
    clientEvidenceScript.includes('$ExpectedCommitSha') &&
    clientEvidenceScript.includes('$ExpectedWorkflowRunId') &&
    clientEvidenceScript.includes('$EvidenceMaxAgeHours') &&
    clientEvidenceScript.includes('-MaximumRedirection 0')
)
check(
  'Release tag 必須是 main 上的 annotated tag，工作流程權限採最小化',
  releaseWorkflow.includes("tagType -ne 'tag'") &&
    releaseWorkflow.includes('git merge-base --is-ancestor HEAD origin/main') &&
    releaseWorkflow.includes('permissions:\n  contents: read') &&
    releaseWorkflow.includes('persist-credentials: false') &&
    releaseWorkflow.includes('permissions:\n      contents: write')
)

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exit(1)
