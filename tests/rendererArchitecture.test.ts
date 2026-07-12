import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import ts from 'typescript'
import { startupFailurePageUrl } from '../src/main/startup/StartupFailurePage'
import { hasVerifiedActiveEngine, retryOnce } from '../src/renderer/src/features/analysis/engineHealth'
import {
  AUTO_INITIAL_ANALYSIS_MAX_MS,
  LIVE_REFINEMENT_ANALYSIS_MIN_MS,
  automaticRootMovetimeMs,
  isSameAnalysisTarget
} from '../src/renderer/src/features/analysis/liveAnalysis'
import { withTimeout } from '../src/renderer/src/utils/withTimeout'
import type { EngineRegistrySnapshot } from '../src/shared/types/EngineRegistry'

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
      resolve('src/renderer/src/components/BoardEditor.tsx'),
      'utf8'
    )
    assert.match(source, /if \(toolsOpen\) return[\s\S]*setTool\(\{ kind: 'move' \}\)/)
    assert.match(source, /!toolsOpen && moveError/)
  })

  console.log(`結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('測試執行失敗：', error)
  process.exit(1)
})
