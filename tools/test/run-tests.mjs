#!/usr/bin/env node
/**
 * 測試執行器：依 tests/test-manifest.json 的順序逐一執行每個測試檔，全部跑完再彙總。
 * 取代原本 package.json 裡用 && 串起來、第一個失敗就停的長指令。
 *
 *   npm test                                   # 全部（CI；Windows）
 *   node tools/test/run-tests.mjs --portable   # 略過只能在 Windows／需要 Electron 的測試
 *   node tools/test/run-tests.mjs --only explain --only settings   # 只跑路徑含這些字的測試
 *   node tools/test/run-tests.mjs --list       # 列出清單與標記
 *   node tools/test/run-tests.mjs --bail       # 第一個失敗就停止
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(readFileSync(join(root, 'tests', 'test-manifest.json'), 'utf8'))

const argv = process.argv.slice(2)
const only = argv.flatMap((arg, index) => (arg === '--only' ? [argv[index + 1] ?? ''] : []))
const portable = argv.includes('--portable')
const bail = argv.includes('--bail')

function label(entry) {
  const file = entry.command.split(/\s+/).find((part) => /\.(test|e2e)\.(tsx?|cjs)$|\.cjs$/.test(part))
  return file ?? entry.command
}

function tags(entry) {
  return [entry.windowsOnly ? 'Windows' : null, entry.electron ? 'Electron' : null].filter(Boolean)
}

if (argv.includes('--list')) {
  for (const entry of manifest) {
    const t = tags(entry)
    console.log(`${label(entry)}${t.length ? `  [${t.join(', ')}]` : ''}`)
  }
  process.exit(0)
}

const selected = manifest.filter((entry) => {
  if (portable && (entry.windowsOnly || entry.electron)) return false
  return only.length === 0 || only.some((needle) => entry.command.includes(needle))
})
if (selected.length === 0) {
  console.error('沒有符合條件的測試。')
  process.exit(1)
}

// 直接以 node 執行時（不經 npm）也找得到 tsx／electron。
const env = {
  ...process.env,
  PATH: [join(root, 'node_modules', '.bin'), process.env.PATH ?? ''].join(delimiter)
}

const failures = []
const started = Date.now()
for (const [index, entry] of selected.entries()) {
  const t0 = Date.now()
  const result = spawnSync(entry.command, {
    cwd: root,
    env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const seconds = ((Date.now() - t0) / 1000).toFixed(1)
  const prefix = `[${index + 1}/${selected.length}]`
  if (result.status === 0) {
    console.log(`${prefix} ✓ ${label(entry)} (${seconds}s)`)
    continue
  }
  console.log(`${prefix} ✗ ${label(entry)} (${seconds}s, exit ${result.status ?? result.signal})`)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
  if (output) console.log(output.split('\n').map((line) => `    ${line}`).join('\n'))
  failures.push(label(entry))
  if (bail) break
}

const total = ((Date.now() - started) / 1000).toFixed(0)
const skipped = manifest.length - selected.length
console.log(
  `\n測試：${selected.length - failures.length} 通過，${failures.length} 失敗` +
    `${skipped ? `，${skipped} 略過` : ''}（${total}s）`
)
if (failures.length > 0) {
  console.log(`失敗：\n${failures.map((name) => `  - ${name}`).join('\n')}`)
  process.exitCode = 1
}
