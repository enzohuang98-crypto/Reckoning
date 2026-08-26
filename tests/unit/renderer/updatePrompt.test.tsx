/**
 * Header 更新提示回歸測試。
 *
 * 執行：npx tsx --tsconfig tsconfig.web.json tests/unit/renderer/updatePrompt.test.tsx
 *
 * 背景：更新狀態先前只顯示在「設定 → 系統」，使用者不主動點進去就完全
 * 不會知道有新版，等同沒有自動更新。這裡鎖定三件事：
 *  1. 沒有新版時完全不渲染（版面零變化，不影響已驗收的分析頁比例）
 *  2. available / downloaded 才提示，且點擊會切到設定頁
 *  3. 已經在設定頁時不重複提示
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import type { AppUpdateStatus } from '../../../src/shared/types/AppUpdate'
import { AppShell, type AppTab } from '../../../src/renderer/src/app/AppShell'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(
      `  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`
    )
  }
}

function status(patch: Partial<AppUpdateStatus>): AppUpdateStatus {
  return {
    phase: 'idle',
    currentVersion: '0.3.6',
    automaticChecksEnabled: true,
    message: '',
    ...patch
  } as AppUpdateStatus
}

function render(
  updateStatus: AppUpdateStatus | null,
  activeTab: AppTab = 'analyze',
  onTabChange: (tab: AppTab) => void = () => undefined,
  onDownloadUpdate: () => void = () => undefined,
  confirmUpdate: (message: string) => boolean = () => false
): TestRenderer.ReactTestRenderer {
  return TestRenderer.create(
    <AppShell
      activeTab={activeTab}
      onTabChange={onTabChange}
      updateStatus={updateStatus}
      dataError={null}
      dataRecoveryRequired={false}
      dataRecoveryBusy={false}
      onRetryLoad={() => undefined}
      onRetrySave={() => undefined}
      onAnalysisCommandMountChange={() => undefined}
      onDownloadUpdate={onDownloadUpdate}
      confirmUpdate={confirmUpdate}
    >
      <div />
    </AppShell>
  )
}

{
  let prompts = 0
  let downloads = 0
  const available = status({
    phase: 'available',
    availableVersion: '0.4.2',
    message: '发现新版本 0.4.2。'
  })
  let renderer: TestRenderer.ReactTestRenderer
  TestRenderer.act(() => {
    renderer = render(
      available,
      'analyze',
      () => undefined,
      () => {
        downloads++
      },
      (message) => {
        prompts++
        return message.includes('0.4.2')
      }
    )
  })
  check('发现新版会主动询问一次', prompts === 1, prompts)
  check('同意后才开始下载', downloads === 1, downloads)

  TestRenderer.act(() => {
    renderer!.update(
      <AppShell
        activeTab="analyze"
        onTabChange={() => undefined}
        updateStatus={available}
        dataError={null}
        dataRecoveryRequired={false}
        dataRecoveryBusy={false}
        onRetryLoad={() => undefined}
        onRetrySave={() => undefined}
        onAnalysisCommandMountChange={() => undefined}
        onDownloadUpdate={() => {
          downloads++
        }}
        confirmUpdate={() => {
          prompts++
          return true
        }}
      >
        <div />
      </AppShell>
    )
  })
  check('同一版本在同次启动不重复询问', prompts === 1, prompts)
}

{
  let downloads = 0
  TestRenderer.act(() => {
    render(
      status({ phase: 'available', availableVersion: '0.4.2' }),
      'analyze',
      () => undefined,
      () => {
        downloads++
      },
      () => false
    )
  })
  check('选择稍后不会下载', downloads === 0, downloads)
}

function chips(
  renderer: TestRenderer.ReactTestRenderer
): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      typeof node.props.className === 'string' &&
      node.props.className.includes('app-update-chip')
  )
}

function chipText(renderer: TestRenderer.ReactTestRenderer): string {
  const chip = chips(renderer)[0]
  if (!chip) return ''
  const visit = (node: TestRenderer.ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(visit).join('')
  return chip.children.map(visit).join('').trim()
}

console.log('\n## Header 更新提示')

check('尚未取得狀態時不渲染提示', chips(render(null)).length === 0)

for (const phase of ['idle', 'checking', 'not-available', 'error', 'unconfigured', 'unsupported'] as const) {
  check(
    `${phase} 不打擾使用者`,
    chips(render(status({ phase }))).length === 0
  )
}

{
  const renderer = render(
    status({ phase: 'downloading', downloadPercent: 42, message: '正在下载更新。' })
  )
  check('downloading 会提示进度', chipText(renderer).includes('42%'), chipText(renderer))
}

{
  const renderer = render(
    status({ phase: 'available', availableVersion: '0.3.7', message: '發現新版本 0.3.7，可立即下載。' })
  )
  check('available 會提示', chips(renderer).length === 1)
  check('提示帶出版本號', chipText(renderer).includes('0.3.7'), chipText(renderer))
}

{
  const renderer = render(
    status({ phase: 'downloaded', availableVersion: '0.3.7', message: '版本 0.3.7 已下載，重新啟動後即可安裝。' })
  )
  check('downloaded 會提示', chips(renderer).length === 1)
  check('提示改為待安裝', chipText(renderer).includes('待安裝'), chipText(renderer))
}

{
  const renderer = render(
    status({ phase: 'available', availableVersion: '0.3.7' }),
    'settings'
  )
  check('已在設定頁時不重複提示', chips(renderer).length === 0)
}

{
  let target: AppTab | null = null
  const renderer = render(
    status({ phase: 'available', availableVersion: '0.3.7' }),
    'analyze',
    (tab) => {
      target = tab
    }
  )
  TestRenderer.act(() => {
    chips(renderer)[0].props.onClick()
  })
  check('點擊提示會切到設定頁', target === 'settings', target)
}

{
  const shellStyles = readFileSync(
    resolve('src/renderer/src/styles/shell.css'),
    'utf8'
  )
  // 提示是 header 的新成員，必須不參與伸縮，否則會壓縮到已驗收比例的
  // 分析工具列（.analysis-command-mount 仍須是唯一 flex: 1 的成員）。
  check(
    '提示不參與 header 伸縮',
    /\.app-update-chip\s*\{[^}]*flex:\s*0 0 auto;/s.test(shellStyles)
  )
  check(
    '分析工具列掛載點維持 flex: 1',
    /\.analysis-command-mount\s*\{[^}]*flex:\s*1;/s.test(shellStyles)
  )
}

console.log(`\n結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exit(1)
