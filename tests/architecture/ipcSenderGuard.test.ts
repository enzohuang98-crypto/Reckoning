import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// CLAUDE.md 原則 5：每個 ipcMain.handle／ipcMain.on 都必須先驗證呼叫來源 frame。
// 拆檔或新增通道時，這個檢查確保沒有任何 handler 漏掉 assertTrustedIpcSender。

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

const mainRoot = resolve('src/main')
const missing: string[] = []
let handlers = 0
for (const file of sourceFiles(mainRoot)) {
  const source = readFileSync(file, 'utf8')
  const pattern = /ipcMain\.(handle|on)\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    handlers += 1
    const next = source.indexOf('ipcMain.', match.index + match[0].length)
    const body = source.slice(match.index, next === -1 ? undefined : next)
    // 來源驗證必須是 handler 內的第一批動作之一（前 400 字內）。
    if (!/assertTrustedIpcSender\(event\)/.test(body.slice(0, 400))) {
      const line = source.slice(0, match.index).split('\n').length
      missing.push(`${relative(process.cwd(), file)}:${line}`)
    }
  }
}

assert.ok(handlers >= 30, `只找到 ${handlers} 個 IPC handler，掃描範圍可能有誤`)
assert.deepEqual(missing, [], `以下 IPC handler 沒有先呼叫 assertTrustedIpcSender：\n${missing.join('\n')}`)
console.log(`IPC sender guard: ${handlers} handlers checked`)
