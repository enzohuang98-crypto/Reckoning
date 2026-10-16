import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// CLAUDE.md 原則 11：介面文字用繁體中文。這些字只存在於簡體，繁體文字裡不會出現；
// renderer 的原始碼（含註解）一旦出現就代表混入了簡體字串。
// 簡體中文解說是 main 依語言設定產生的內容，不在 renderer 原始碼裡，所以不受影響。
const SIMPLIFIED_ONLY = '们这说设为对时会关线选连动实读备删认钥证验费总钮页闭项请发现载与装试测须标户个样从开启显击点获让给经长头达类别书义译论写传颜结帮两来学习问题运当处号码数据库组织创见构无检网择换随单录确级进简过还没应该边'

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

const offenders: string[] = []
for (const file of sourceFiles(resolve('src/renderer/src'))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const found = [...line].filter((char) => SIMPLIFIED_ONLY.includes(char))
    if (found.length > 0) {
      offenders.push(`${relative(process.cwd(), file)}:${index + 1}（${[...new Set(found)].join('')}）`)
    }
  })
}

assert.deepEqual(offenders, [], `renderer 出現簡體字：\n${offenders.join('\n')}`)
console.log('Traditional Chinese UI check passed')
