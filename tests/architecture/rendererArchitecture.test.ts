import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import ts from 'typescript'
import { startupFailurePageUrl } from '../../src/main/startup/StartupFailurePage'
import { hasVerifiedActiveEngine, retryOnce } from '../../src/renderer/src/features/analysis/engineHealth'
import {
  AUTO_INITIAL_ANALYSIS_MAX_MS,
  LIVE_REFINEMENT_ANALYSIS_MIN_MS,
  automaticRootMovetimeMs,
  canScheduleLiveAnalysis,
  liveAnalysisRetryDelayMs,
  isSameAnalysisTarget
} from '../../src/renderer/src/features/analysis/liveAnalysis'
import { withTimeout } from '../../src/renderer/src/utils/withTimeout'
import type { EngineRegistrySnapshot } from '../../src/shared/types/EngineRegistry'

let passed = 0
let failed = 0

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

function nativeButtonViolations(root: string): string[] {
  const violations: string[] = []
  for (const path of sourceFiles(root).filter((file) => file.endsWith('.tsx'))) {
    const sourceText = readFileSync(path, 'utf8')
    const source = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    const inspect = (node: ts.Node): void => {
      const opening = ts.isJsxElement(node)
        ? node.openingElement
        : ts.isJsxSelfClosingElement(node)
          ? node
          : null
      if (opening && opening.tagName.getText(source) === 'button') {
        const attributes = opening.attributes.properties
        const hasOnClick = attributes.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === 'onClick'
        )
        const nodeText = node.getText(source)
        const hasName =
          /aria-label\s*=/.test(nodeText) ||
          /title\s*=/.test(nodeText) ||
          /<button[^>]*>[\s\S]*?(?:[\p{L}\p{N}]|\{[^}]+\})[\s\S]*?<\/button>/u.test(
            nodeText
          )
        if (!hasOnClick || !hasName) {
          const { line } = source.getLineAndCharacterOfPosition(opening.getStart(source))
          violations.push(
            `${path}:${line + 1} ${!hasOnClick ? 'missing onClick' : 'missing accessible name'}`
          )
        }
      }
      ts.forEachChild(node, inspect)
    }
    inspect(source)
  }
  return violations
}

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (error) {
    console.error(`  ✗ ${name}`)
    console.error(error)
    failed += 1
  }
}

function registry(verified: boolean): EngineRegistrySnapshot {
  return {
    activeEngineId: 'engine-1',
    verificationEngineId: null,
    installations: [
      {
        id: 'engine-1',
        profileId: 'pikafish',
        displayName: 'Pikafish',
        executablePath: 'C:\\Engines\\pikafish.exe',
        protocol: 'uci',
        enabled: true,
        verified,
        capabilities: {
          multiPv: verified,
          configurableThreads: false,
          configurableHash: false
        }
      }
    ]
  }
}

async function main(): Promise<void> {
  console.log('\n## Renderer 架構與啟動復原')

  await check('已驗證的作用中引擎不需要每次啟動重跑短測', () => {
    assert.equal(hasVerifiedActiveEngine(registry(true)), true)
  })

  await check('未驗證引擎需要連線短測', () => {
    assert.equal(hasVerifiedActiveEngine(registry(false)), false)
  })

  await check('短測第一次失敗會重試一次並接受第二次成功', async () => {
    let calls = 0
    const result = await retryOnce(
      async () => ({ ok: ++calls === 2 }),
      (value) => value.ok,
      0,
      async () => undefined
    )
    assert.equal(result.ok, true)
    assert.equal(calls, 2)
  })

  await check('短測第一次成功不會多啟動第二個引擎程序', async () => {
    let calls = 0
    await retryOnce(
      async () => ({ ok: ++calls === 1 }),
      (value) => value.ok,
      0,
      async () => undefined
    )
    assert.equal(calls, 1)
  })

  await check('啟動 IPC 在期限內完成時正常回傳', async () => {
    assert.equal(await withTimeout(Promise.resolve('ready'), 50, 'timeout'), 'ready')
  })

  await check('啟動 IPC 卡住時會逾時，不留下永久空白畫面', async () => {
    await assert.rejects(
      withTimeout(new Promise<never>(() => undefined), 5, 'startup timeout'),
      /startup timeout/
    )
  })

  await check('renderer 載入失敗時有獨立、無腳本的啟動錯誤頁', () => {
    const pageUrl = startupFailurePageUrl()
    assert.match(pageUrl, /^data:text\/html;charset=utf-8,/)
    const html = decodeURIComponent(pageUrl.split(',', 2)[1])
    assert.match(html, /應用程式無法完成啟動/)
    assert.match(html, /default-src 'none'/)
    assert.doesNotMatch(html, /<script/i)
  })

  await check('永久資料讀取失敗時 renderer 會封鎖寫入並提供真正重新讀取', () => {
    const dataStore = readFileSync(
      resolve('src/renderer/src/features/app-data/useAppDataStore.ts'),
      'utf8'
    )
    const appShell = readFileSync(
      resolve('src/renderer/src/app/AppShell.tsx'),
      'utf8'
    )

    assert.match(dataStore, /dataReadBlockedRef\.current = true/)
    assert.match(
      dataStore,
      /if \(dataReadBlockedRef\.current\) \{[\s\S]*?return[\s\S]*?\}/
    )
    const updateStart = dataStore.indexOf('const updateAppData')
    const importStart = dataStore.indexOf('const importData')
    const updateSource = dataStore.slice(updateStart, importStart)
    assert.match(
      updateSource,
      /if \(dataReadBlockedRef\.current\) \{[\s\S]*?return[\s\S]*?\}[\s\S]*?const next = updater/
    )
    assert.match(dataStore, /成功前新增、修改、刪除與儲存會保持暫停/)
    assert.match(dataStore, /const retryLoadData = useCallback/)
    assert.match(dataStore, /window\.api\.data\.load\(\)/)
    assert.match(appShell, /dataRecoveryRequired \? onRetryLoad : onRetrySave/)
    assert.match(appShell, /重新讀取資料/)
  })

  await check('Live 分析先快速回傳，再切換為較長的持續加深搜尋', () => {
    assert.equal(automaticRootMovetimeMs(3_000, false), AUTO_INITIAL_ANALYSIS_MAX_MS)
    assert.equal(
      automaticRootMovetimeMs(3_000, true),
      LIVE_REFINEMENT_ANALYSIS_MIN_MS
    )
    assert.equal(automaticRootMovetimeMs(30_000, true), 30_000)
  })

  await check('只有相同局面與相同使用者著法才能沿用結果繼續加深', () => {
    const analysis = { positionFen: 'same-fen', userMove: 'a0a1' }
    assert.equal(isSameAnalysisTarget(analysis, 'same-fen', 'a0a1'), true)
    assert.equal(isSameAnalysisTarget(analysis, 'other-fen', 'a0a1'), false)
    assert.equal(isSameAnalysisTarget(analysis, 'same-fen', 'b0b1'), false)
  })

  await check('持續分析只會被使用者暫停、頁面狀態、引擎、棋盤或既有分析工作阻擋', () => {
    const ready = {
      livePaused: false,
      visible: true,
      engineAvailable: true,
      boardValid: true,
      analysisBusy: false
    }
    assert.equal(canScheduleLiveAnalysis(ready), true)
    assert.equal(canScheduleLiveAnalysis({ ...ready, livePaused: true }), false)
    assert.equal(canScheduleLiveAnalysis({ ...ready, visible: false }), false)
    assert.equal(canScheduleLiveAnalysis({ ...ready, analysisBusy: true }), false)
  })

  await check('即時分析錯誤會以有上限的退避時間自動重試', () => {
    assert.equal(liveAnalysisRetryDelayMs(0), 0)
    assert.equal(liveAnalysisRetryDelayMs(1), 1_000)
    assert.equal(liveAnalysisRetryDelayMs(3), 4_000)
    assert.equal(liveAnalysisRetryDelayMs(8), 5_000)
  })

  await check('首頁只在右上保留 AI 教練與猜著，Live 分析固定在底部', () => {
    const tabs = readFileSync(
      resolve('src/renderer/src/features/analysis/AnalysisInspectorTabs.tsx'),
      'utf8'
    )
    const workspace = readFileSync(
      resolve('src/renderer/src/features/workspace/AnalysisWorkspace.tsx'),
      'utf8'
    )
    assert.doesNotMatch(tabs, /id: 'live'/)
    assert.doesNotMatch(tabs, /id: 'details'/)
    assert.match(workspace, /className="live-analysis-dock"/)
    assert.match(workspace, /boardCompact/)
    assert.match(workspace, /analysis-data-drawer/)
    assert.match(workspace, /<AnalysisPanel[\s\S]*?visible[\s\S]*?activeView="coach"/)
  })

  await check('分析分頁與 Live 引擎訊息具備穩定的鍵盤及朗讀語意', () => {
    const tabs = readFileSync(
      resolve('src/renderer/src/features/analysis/AnalysisInspectorTabs.tsx'),
      'utf8'
    )
    const console = readFileSync(
      resolve('src/renderer/src/features/analysis/EngineConsole.tsx'),
      'utf8'
    )
    const panel = readFileSync(
      resolve('src/renderer/src/features/analysis/AnalysisPanel.tsx'),
      'utf8'
    )

    assert.match(tabs, /useRef<Array<HTMLButtonElement \| null>>/)
    assert.match(tabs, /event\.key === 'Home'/)
    assert.match(tabs, /event\.key === 'End'/)
    assert.match(tabs, /tabRefs\.current\[nextIndex\]\?\.focus\(\)/)
    assert.doesNotMatch(console, /<section className="engine-console" aria-live=/)
    assert.match(console, /<span role="status" aria-atomic="true">/)
    assert.match(panel, /className="error-text live-dock-message" role="alert"/)
    assert.match(panel, /className="notice-text live-dock-message" role="status"/)
  })

  await check('分析首頁以 viewport 三列固定顯示工具列、工作區與 Live 分析', () => {
    const appShell = readFileSync(
      resolve('src/renderer/src/app/AppShell.tsx'),
      'utf8'
    )
    const shellStyles = readFileSync(
      resolve('src/renderer/src/styles/shell.css'),
      'utf8'
    )
    const workspaceStyles = readFileSync(
      resolve('src/renderer/src/styles/workspace.css'),
      'utf8'
    )
    const analysisStyles = readFileSync(
      resolve('src/renderer/src/styles/analysis.css'),
      'utf8'
    )
    const responsiveStyles = readFileSync(
      resolve('src/renderer/src/styles/responsive.css'),
      'utf8'
    )

    assert.match(appShell, /app-main-\$\{activeTab\}/)
    assert.match(shellStyles, /\.app-main-analyze\s*\{[^}]*overflow:\s*hidden;/s)
    assert.match(
      workspaceStyles,
      /\.analyze-page\s*\{[^}]*height:\s*100%;[^}]*grid-template-areas:[^}]*"toolbar"[^}]*"workspace"[^}]*"live"[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) clamp\(/s
    )
    assert.match(
      workspaceStyles,
      /\.live-analysis-dock\s*\{[^}]*min-height:\s*0;[^}]*grid-area:\s*live;/s
    )
    const expandedColumns = workspaceStyles.match(
      /\.analyze-layout\s*\{[^}]*grid-template-columns:\s*minmax\((\d+)px,[^)]+\)\s+minmax\((\d+)px,[^)]+\);[^}]*gap:\s*(\d+)px;/s
    )
    assert.ok(expandedColumns, 'Expanded board columns must declare pixel minimums and a gap')
    const minimumWindowsPageWidth = 1024 - 16 - 24
    const expandedMinimumWidth =
      Number(expandedColumns[1]) + Number(expandedColumns[2]) + Number(expandedColumns[3])
    assert.ok(
      expandedMinimumWidth <= minimumWindowsPageWidth,
      `Expanded board needs ${expandedMinimumWidth}px but the minimum Windows viewport only provides ${minimumWindowsPageWidth}px`
    )
    assert.match(
      analysisStyles,
      /\.inspector-shell\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s
    )
    assert.match(
      analysisStyles,
      /\.live-analysis-panel \.engine-console-feed\s*\{[^}]*min-height:\s*0;[^}]*max-height:\s*none;[^}]*flex:\s*1;/s
    )
    assert.match(
      analysisStyles,
      /\.live-result-column > \.panel-empty-state\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*padding:\s*16px;/s
    )
    assert.match(
      responsiveStyles,
      /@media \(max-height:\s*900px\)[\s\S]*?\.analyze-page\s*\{[^}]*grid-template-rows:/
    )
    assert.match(
      responsiveStyles,
      /@media \(max-width:\s*900px\)[\s\S]*?\.live-analysis-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/
    )
    assert.match(
      responsiveStyles,
      /@media \(max-height:\s*900px\)[\s\S]*?\.inspector-content \.panel-empty-state\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*10px;[^}]*\}[\s\S]*?\.inspector-content \.panel-empty-state \.empty-state-mark\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/
    )
  })

  await check('緊湊棋盤、Live 警告與分析資料抽屜不留下裁切或焦點陷阱', () => {
    const workspace = readFileSync(
      resolve('src/renderer/src/features/workspace/AnalysisWorkspace.tsx'),
      'utf8'
    )
    const toolbar = readFileSync(
      resolve('src/renderer/src/features/workspace/AnalysisToolbar.tsx'),
      'utf8'
    )
    const result = readFileSync(
      resolve('src/renderer/src/features/analysis/EngineResultSummary.tsx'),
      'utf8'
    )
    const styles = readFileSync(
      resolve('src/renderer/src/styles/workspace.css'),
      'utf8'
    )

    assert.match(
      styles,
      /\.analyze-layout\.board-compact \.board-editor:not\(\.tools-open\) \.xiangqi-board\s*\{[^}]*height:\s*min\(84%,\s*450px\);[^}]*max-height:\s*84%;/s
    )
    assert.match(result, /const compactWarnings = \[analysisWarning, result\.verificationWarning\]/)
    assert.match(result, /compactWarnings\.length > 1/)
    assert.match(workspace, /layout\?\.setAttribute\('inert', ''\)/)
    assert.match(workspace, /aria-hidden=\{detailsOpen\}/)
    assert.match(workspace, /event\.key !== 'Escape'/)
    assert.match(workspace, /analysis-details-toggle/)
    assert.match(toolbar, /aria-expanded=\{ariaExpanded\}/)
    assert.match(toolbar, /ariaControls="analysis-data-drawer"/)
  })

  await check('每次 AI 提問使用當下最新分析，並完整快照對話與模型來源', () => {
    const panel = readFileSync(
      resolve('src/renderer/src/features/analysis/AnalysisPanel.tsx'),
      'utf8'
    )
    assert.match(panel, /analysisId: pending\.analysisId/)
    assert.match(panel, /positionFen: pending\.positionFen/)
    assert.match(panel, /const resultSnapshot = result/)
    assert.match(panel, /conversationMessages: currentConversation\?\.messages\.slice\(\) \?\? \[\]/)
    assert.match(panel, /\.\.\.pending\.conversationMessages/)
    assert.match(panel, /provider: pending\?\.provider/)
    assert.match(panel, /model: pending\?\.model/)
    assert.match(panel, /if \(!result \|\| activeAiRequestId\.current\) return/)
  })

  await check('自動 AI 每個局面只嘗試一次，取消或失敗不會隨持續分析重跑', () => {
    const panel = readFileSync(
      resolve('src/renderer/src/features/analysis/AnalysisPanel.tsx'),
      'utf8'
    )
    assert.match(panel, /const autoRunAttemptTarget = useRef<string \| null>\(null\)/)
    assert.match(panel, /isSameAnalysisTarget\(result\.engineAnalysis, board\.fen, move\)/)
    assert.match(panel, /autoRunAttemptTarget\.current !== target/)
    assert.match(panel, /autoRunAttemptTarget\.current = target[\s\S]*?generateExplanation\(null\)/)
    assert.match(
      panel,
      /pendingAiRequest\.current = null[\s\S]*?autoRunAttemptTarget\.current = null/
    )
  })

  await check('AI 失敗就地顯示且不清除追問，成功後才清除草稿', () => {
    const panel = readFileSync(
      resolve('src/renderer/src/features/analysis/AnalysisPanel.tsx'),
      'utf8'
    )
    const coach = readFileSync(
      resolve('src/renderer/src/features/analysis/CoachView.tsx'),
      'utf8'
    )
    const submitStart = panel.indexOf('const submitFollowUp')
    const copyStart = panel.indexOf('const copyExplanation')
    assert.equal(submitStart >= 0 && copyStart > submitStart, true)
    assert.doesNotMatch(panel.slice(submitStart, copyStart), /setFollowUp\(''\)/)
    assert.match(panel, /if \(pending\.question !== null\) setFollowUp\(''\)/)
    assert.match(panel, /error=\{aiError\}/)
    assert.match(panel, /notice=\{aiNotice\}/)
    assert.match(coach, /role="alert"/)
    assert.match(coach, /role="status"/)
    assert.match(coach, /整輪模型輸出總預算/)
  })

  await check('AI IPC 透過單一 PromptBuilder 入口把多輪上下文交給 Harness', () => {
    const handler = readFileSync(
      resolve('src/main/ipc/aiExplanationHandlers.ts'),
      'utf8'
    )
    const harness = readFileSync(
      resolve('src/main/ai/HarnessOrchestrator.ts'),
      'utf8'
    )
    assert.match(handler, /const request = await buildAIExplanationRequest/)
    assert.match(handler, /explanationPrompt: request\.prompt/)
    assert.match(harness, /deps\.explanationPrompt/)
    assert.match(harness, /所有給使用者閱讀的自然語言欄位/)
  })

  await check('renderer 維持 Electron / Node / main process 信任邊界', () => {
    const rendererRoot = resolve('src/renderer/src')
    const violations = sourceFiles(rendererRoot).filter((path) => {
      const source = readFileSync(path, 'utf8')
      return (
        /from\s+['"]electron['"]/.test(source) ||
        /from\s+['"]node:/.test(source) ||
        /from\s+['"][^'"]*\/main\//.test(source)
      )
    })
    assert.deepEqual(violations, [])
  })

  await check('renderer 樣式維持模組化，不回復單體 styles.css', () => {
    assert.equal(existsSync(resolve('src/renderer/src/styles.css')), false)
    const styleIndex = readFileSync(resolve('src/renderer/src/styles/index.css'), 'utf8')
    for (const moduleName of [
      'tokens.css',
      'base.css',
      'shell.css',
      'workspace.css',
      'analysis.css',
      'pages.css',
      'explanation.css',
      'responsive.css'
    ]) {
      assert.match(styleIndex, new RegExp(`@import ['"]\\./${moduleName.replace('.', '\\.')}['"]`))
    }
  })

  await check('每個原生按鈕都有作用事件與可辨識名稱', () => {
    assert.deepEqual(
      nativeButtonViolations(resolve('src/renderer/src')),
      []
    )
  })

  await check('收起擺棋工具會退出替換／清除模式', () => {
    const source = readFileSync(
      resolve('src/renderer/src/features/board/BoardEditor.tsx'),
      'utf8'
    )
    assert.match(source, /if \(toolsOpen\) return[\s\S]*setTool\(\{ kind: 'move' \}\)/)
    assert.match(source, /!toolsOpen && moveError/)
  })

  await check('不可逆刪除會先明確確認，取消時不會呼叫刪除 handler', () => {
    const mistakeBook = readFileSync(
      resolve('src/renderer/src/pages/MistakeBookPage.tsx'),
      'utf8'
    )
    const misunderstood = readFileSync(
      resolve('src/renderer/src/pages/MisunderstoodPage.tsx'),
      'utf8'
    )
    const boardEditor = readFileSync(
      resolve('src/renderer/src/features/board/BoardEditor.tsx'),
      'utf8'
    )
    const aiSettings = readFileSync(
      resolve('src/renderer/src/features/settings/AiSettingsSection.tsx'),
      'utf8'
    )
    const engineSettings = readFileSync(
      resolve('src/renderer/src/features/settings/EngineSettingsSection.tsx'),
      'utf8'
    )
    const systemSettings = readFileSync(
      resolve('src/renderer/src/features/settings/SystemSettingsSection.tsx'),
      'utf8'
    )

    assert.match(mistakeBook, /const removeTag[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?update\(entry\.id/)
    assert.match(mistakeBook, /const deleteEntry[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?onChange\(/)
    assert.match(misunderstood, /const deleteEntry[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?onChange\(/)
    assert.match(boardEditor, /const clearBoard[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?reserialize\(/)
    assert.match(boardEditor, /const deleteSavedPosition[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?onDeleteSavedPosition\(/)
    assert.match(aiSettings, /const deleteApiKey[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?onDeleteKey\(\)/)
    assert.match(engineSettings, /const removeEngine[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?onRemove\(id\)/)
    assert.match(systemSettings, /const deactivateLicense[\s\S]*?if \(!window\.confirm\([\s\S]*?\)\) return[\s\S]*?onDeactivateLicense\(\)/)
  })

  console.log(`結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('測試執行失敗：', error)
  process.exit(1)
})
