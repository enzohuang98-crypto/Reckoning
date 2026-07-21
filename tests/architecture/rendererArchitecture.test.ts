import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import ts from 'typescript'
import { startupFailurePageUrl } from '../../src/main/startup/StartupFailurePage'
import { hasVerifiedActiveEngine, retryOnce } from '../../src/renderer/src/features/analysis/engineHealth'
import {
  ACTUAL_MOVE_ENGINE_DEADLINE_MS,
  AUTO_INITIAL_ANALYSIS_MAX_MS,
  AUTO_USER_MOVE_ANALYSIS_MAX_MS,
  LIVE_REFINEMENT_ANALYSIS_MIN_MS,
  ONE_CLICK_EXPLANATION_DEADLINE_MS,
  automaticRootMovetimeMs,
  canScheduleLiveAnalysis,
  liveAnalysisRetryDelayMs,
  isSameAnalysisTarget,
  remainingActualMoveEngineDeadlineMs,
  remainingOneClickDeadlineMs
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

function cssRuleBody(source: string, selector: string, occurrence = 0): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = Array.from(
    source.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'gs'))
  )
  const index = occurrence < 0 ? matches.length + occurrence : occurrence
  const match = matches[index]
  assert.ok(match, `Missing CSS rule: ${selector} at occurrence ${occurrence}`)
  return match[1]
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
    assert.equal(AUTO_INITIAL_ANALYSIS_MAX_MS, 1_100)
    assert.equal(AUTO_USER_MOVE_ANALYSIS_MAX_MS, 400)
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

  await check('實戰步引擎比較以點擊起算 3 秒硬截止', () => {
    assert.equal(ACTUAL_MOVE_ENGINE_DEADLINE_MS, 3_000)
    assert.equal(remainingActualMoveEngineDeadlineMs(10_000, 10_000), 3_000)
    assert.equal(remainingActualMoveEngineDeadlineMs(10_000, 12_500), 500)
    assert.equal(remainingActualMoveEngineDeadlineMs(10_000, 20_000), 1)
  })

  await check('一鍵 AI 解說截止時間從明確 AI 點擊起算且不會變成零或負數', () => {
    assert.equal(ONE_CLICK_EXPLANATION_DEADLINE_MS, 90_000)
    assert.equal(remainingOneClickDeadlineMs(10_000, 10_000), 90_000)
    assert.equal(remainingOneClickDeadlineMs(10_000, 94_500), 5_500)
    assert.equal(remainingOneClickDeadlineMs(10_000, 110_000), 1)
  })

  await check('首頁只在右上保留 AI 教練與猜著，局面分析固定在底部', () => {
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
    assert.match(
      workspace,
      /const \[boardExpanded,\s*setBoardExpanded\] = useState\(false\)/
    )
    assert.match(
      workspace,
      /className=\{'analyze-layout' \+ \(boardExpanded \? ' board-expanded' : ''\)\}/
    )
    assert.doesNotMatch(workspace, /board-compact/)
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
    const table = readFileSync(
      resolve('src/renderer/src/features/analysis/LiveAnalysisTable.tsx'),
      'utf8'
    )

    assert.match(tabs, /useRef<Array<HTMLButtonElement \| null>>/)
    assert.match(tabs, /event\.key === 'Home'/)
    assert.match(tabs, /event\.key === 'End'/)
    assert.match(tabs, /tabRefs\.current\[nextIndex\]\?\.focus\(\)/)
    assert.doesNotMatch(console, /<section className="engine-console" aria-live=/)
    assert.match(console, /<span role="status" aria-atomic="true">/)
    assert.match(table, /<section className="live-analysis-table" aria-live="polite">/)
    assert.match(table, /className="live-analysis-message error-text" role="alert"/)
    assert.match(table, /className=\{`live-analysis-status \$\{stateClass\}`\}/)
  })

  await check('分析工具列透過 Portal 併入單列 Header，不另佔工作區列', () => {
    const app = readFileSync(resolve('src/renderer/src/App.tsx'), 'utf8')
    const appShell = readFileSync(
      resolve('src/renderer/src/app/AppShell.tsx'),
      'utf8'
    )
    const workspace = readFileSync(
      resolve('src/renderer/src/features/workspace/AnalysisWorkspace.tsx'),
      'utf8'
    )
    const workspaceStyles = readFileSync(
      resolve('src/renderer/src/styles/workspace.css'),
      'utf8'
    )

    assert.match(
      app,
      /const \[analysisCommandMount,\s*setAnalysisCommandMount\] = useState<HTMLDivElement \| null>\(null\)/
    )
    assert.match(app, /onAnalysisCommandMountChange=\{setAnalysisCommandMount\}/)
    assert.match(app, /headerCommandMount=\{analysisCommandMount\}/)
    assert.match(appShell, /activeTab === 'analyze'[\s\S]*?className="analysis-command-mount"/)
    assert.match(appShell, /ref=\{onAnalysisCommandMountChange\}/)
    assert.match(workspace, /import \{ createPortal \} from 'react-dom'/)
    assert.match(
      workspace,
      /const headerCommands =[\s\S]*?createPortal\([\s\S]*?<AnalysisToolbar[\s\S]*?,\s*headerCommandMount\s*\)/
    )
    assert.match(workspace, /\{headerCommands\}/)
    assert.doesNotMatch(workspaceStyles, /\.analyze-page\s*>\s*\.app-toolbar/)
    assert.match(
      cssRuleBody(workspaceStyles, '.analysis-command-mount .app-toolbar'),
      /height:\s*68px;/
    )
  })

  await check('分析首頁沿用已驗收比例：預設中等棋盤與局面分析同屏', () => {
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

    assert.match(shellStyles, /\.app-main-analyze\s*\{[^}]*overflow:\s*hidden;/s)
    const analyzePage = cssRuleBody(workspaceStyles, '.analyze-page')
    assert.match(analyzePage, /height:\s*100%;/)
    assert.match(
      analyzePage,
      /grid-template-areas:\s*"workspace"\s*"live";/
    )
    assert.doesNotMatch(analyzePage, /"toolbar"/)
    assert.match(
      analyzePage,
      /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+clamp\(240px,\s*32vh,\s*320px\);/
    )

    const layout = cssRuleBody(workspaceStyles, '.analyze-layout')
    assert.match(
      layout,
      /grid-template-columns:\s*minmax\(0,\s*56fr\)\s+minmax\(360px,\s*44fr\);/
    )
    assert.doesNotMatch(workspaceStyles, /\.analyze-layout\.board-compact/)
    assert.match(
      cssRuleBody(workspaceStyles, '.board-editor'),
      /width:\s*min\(100%,\s*560px\);/
    )
    assert.match(
      cssRuleBody(workspaceStyles, '.xiangqi-board'),
      /width:\s*min\(100%,\s*500px\);/
    )
    assert.match(
      cssRuleBody(workspaceStyles, '.analyze-layout.board-expanded .board-editor'),
      /width:\s*min\(100%,\s*682px\);/
    )
    assert.match(
      cssRuleBody(workspaceStyles, '.analyze-layout.board-expanded .xiangqi-board'),
      /width:\s*min\(100%,\s*650px\);/
    )
    assert.match(
      cssRuleBody(workspaceStyles, '.live-analysis-dock', -1),
      /min-height:\s*0;[\s\S]*grid-area:\s*live;/
    )
    assert.match(
      analysisStyles,
      /\.inspector-shell\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s
    )
  })

  await check('局面分析表保留必要資料，compact 不建立整塊垂直捲軸', () => {
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
    const table = readFileSync(
      resolve('src/renderer/src/features/analysis/LiveAnalysisTable.tsx'),
      'utf8'
    )
    const analysisStyles = readFileSync(
      resolve('src/renderer/src/styles/analysis.css'),
      'utf8'
    )
    const workspaceStyles = readFileSync(
      resolve('src/renderer/src/styles/workspace.css'),
      'utf8'
    )

    assert.match(table, />局面分析</)
    assert.match(table, /aria-label="逐深度局面分析數字與分析找法"/)
    assert.match(table, />分析找法</)
    assert.match(table, />分數</)
    assert.match(table, />深度</)
    assert.match(table, />時間</)
    assert.match(table, />NPS</)
    assert.match(table, />節點</)
    assert.match(table, />\s*最佳著／候選與 PV\s*</)
    const compactResult = cssRuleBody(analysisStyles, '.analysis-result.compact')
    assert.doesNotMatch(compactResult, /overflow-y:\s*auto/)
    assert.match(compactResult, /overflow:\s*hidden|overflow-y:\s*hidden/)
    assert.match(
      cssRuleBody(analysisStyles, '.live-analysis-table', -1),
      /overflow:\s*hidden;/
    )
    assert.match(
      cssRuleBody(analysisStyles, '.live-analysis-table-scroll'),
      /overflow:\s*auto;/
    )
    assert.match(
      cssRuleBody(analysisStyles, '.live-analysis-cell-line span'),
      /overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/
    )
    assert.doesNotMatch(
      cssRuleBody(workspaceStyles, '.live-analysis-dock', -1),
      /overflow-y:\s*auto/
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

  await check('棋譜點擊只自動比較引擎；明確按一次 AI 解說才產生完整內容', () => {
    const gameImport = readFileSync(
      resolve('src/renderer/src/features/board/GameImportPanel.tsx'),
      'utf8'
    )
    const workspace = readFileSync(
      resolve('src/renderer/src/features/workspace/AnalysisWorkspace.tsx'),
      'utf8'
    )
    const panel = readFileSync(
      resolve('src/renderer/src/features/analysis/AnalysisPanel.tsx'),
      'utf8'
    )

    assert.match(gameImport, /position: game\.positions\[index\]/)
    assert.match(gameImport, /move: game\.moves\[index\]/)
    assert.match(gameImport, /displayMove: game\.displayMoves\[index\]/)
    assert.match(gameImport, /title=\{`分析第 \$\{i \+ 1\} 手（顯示走前局面）`\}/)
    assert.match(workspace, /positionFen: selection\.position\.fen/)
    assert.match(workspace, /highlightedMove=\{actualMove\?\.move\}/)
    assert.match(workspace, /actualMove=\{actualMove\}/)
    assert.match(panel, /const analysisMove = actualMove\?\.move \?\? submittedGuess\?\.move \?\? ''/)
    assert.match(panel, /positionFen: board\.fen,[\s\S]*?userMove: move \|\| undefined/)
    assert.match(panel, /explicitAnalysisTarget\.current = target[\s\S]*?startAnalysis\(true\)/)
    assert.match(panel, /!actualMove &&[\s\S]*?settings\.harnessAutoRun/)
    assert.doesNotMatch(panel, /forcedByGameMove/)
    assert.match(panel, /payload\.requestId !== activeRequestId\.current/)
    assert.match(panel, /payload\.requestId !== activeAiRequestId\.current/)
    assert.match(panel, /const aiRequestedAt = Date\.now\(\)/)
    assert.match(panel, /remainingOneClickDeadlineMs\(aiRequestedAt\)/)
    assert.match(panel, /settings\.crossEngineEnabled && verificationEngineId/)
    assert.doesNotMatch(panel, /actualMove \|\| settings\.crossEngineEnabled/)
    assert.match(panel, /!hasBothKings\(board\) \|\|[\s\S]*?livePaused \|\|/)
    assert.match(
      panel,
      /useEffect\(\(\) => \(\) => \{[\s\S]*?cancelAnalysis\(activeRequestId\.current\)[\s\S]*?cancelExplanation\(activeAiRequestId\.current\)/
    )
    assert.match(
      panel,
      /actualMove[\s\S]*?isSameAnalysisTarget\(result\?\.engineAnalysis[\s\S]*?return/
    )
    assert.match(panel, /actualMove && liveRetryCount > 0/)
    assert.match(
      panel,
      /actualMove[\s\S]*?\? !status\?\.available[\s\S]*?\? analysisBlockedReason[\s\S]*?: null/
    )
    assert.match(panel, /error=\{aiError \?\? \(actualMove \? error : null\)\}/)
    assert.match(
      workspace,
      /const selectImportedMove[\s\S]*?setResult\(null\)[\s\S]*?setExplanation\(null\)[\s\S]*?onConversationChange\(null\)/
    )
  })

  await check('棋手預設 AI 畫面不呈現 token、證據編號或內部迴圈計數', () => {
    const coach = readFileSync(
      resolve('src/renderer/src/features/analysis/CoachView.tsx'),
      'utf8'
    )
    const progress = readFileSync(
      resolve('src/renderer/src/features/analysis/HarnessProgressCard.tsx'),
      'utf8'
    )
    const explanation = readFileSync(
      resolve('src/renderer/src/features/explanations/ExplanationView.tsx'),
      'utf8'
    )

    assert.doesNotMatch(coach, /inputTokens|outputTokens|harnessEvidence|harnessWarnings/)
    assert.doesNotMatch(coach, /證據驗證完成/)
    assert.match(coach, /result\?\.verificationWarning/)
    assert.doesNotMatch(coach, /複核引擎尚未提供結果；本次先依主引擎完成比較/)
    assert.doesNotMatch(progress, /modelCallsUsed|engineRoundsUsed|evidenceCount/)
    assert.match(explanation, /replace\(\/\\s\*\\\[E\\d\+\\\]\/g, ''\)/)
  })

  await check('只有實際加入第二個產品引擎時才顯示複核引擎 UI', () => {
    const harnessSettings = readFileSync(
      resolve('src/renderer/src/features/settings/HarnessSettingsSection.tsx'),
      'utf8'
    )
    const engineSettings = readFileSync(
      resolve('src/renderer/src/features/settings/EngineSettingsSection.tsx'),
      'utf8'
    )
    const details = readFileSync(
      resolve('src/renderer/src/features/analysis/DetailsView.tsx'),
      'utf8'
    )
    const settingsPage = readFileSync(
      resolve('src/renderer/src/pages/SettingsPage.tsx'),
      'utf8'
    )

    assert.match(settingsPage, /canUseCrossEngine=\{engineRegistry\.installations\.length > 1\}/)
    assert.match(harnessSettings, /\{canUseCrossEngine && \(/)
    assert.match(engineSettings, /\{registry\.installations\.length > 1 && \(/)
    assert.match(
      details,
      /settings\.crossEngineEnabled && registry\.installations\.length > 1/
    )
    assert.match(
      harnessSettings,
      /點棋譜著法仍只跑引擎，按一次「AI 解說」才產生完整說明/
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
    assert.match(panel, /error=\{aiError \?\? \(actualMove \? error : null\)\}/)
    assert.match(panel, /notice=\{aiNotice\}/)
    assert.match(coach, /role="alert"/)
    assert.match(coach, /role="status"/)
    assert.doesNotMatch(coach, /整輪模型輸出總預算|tokens/)
    assert.match(coach, /引擎比較完成/)
    assert.match(coach, /產生完整 AI 解說/)
    assert.match(coach, /完成後按一次「AI 解說」即可取得完整說明/)
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
