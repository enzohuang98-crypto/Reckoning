import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// 每個測試檔都必須由 npm test 執行：直接列在 tests/test-manifest.json，
// 或由清單中的 Electron 啟動器（tests/support/*.cjs）require。曾有測試檔寫好卻從未在 CI 執行。

const root = resolve('.')
const manifest = JSON.parse(readFileSync(join(root, 'tests', 'test-manifest.json'), 'utf8')) as Array<{
  command: string
}>
const commands = manifest.map((entry) => entry.command)

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : [relative(root, path).split('\\').join('/')]
  })
}

const testFiles = files(join(root, 'tests')).filter((path) =>
  /\.(test|e2e|selftest)\.(ts|tsx|cjs)$/.test(path)
)

const launched = new Set<string>()
for (const command of commands) {
  const launcher = command.match(/tests\/support\/[\w-]+\.cjs/)?.[0]
  if (!launcher) continue
  const source = readFileSync(join(root, launcher), 'utf8')
  for (const match of source.matchAll(/require\('\.\.\/([^']+)'\)/g)) {
    launched.add(`tests/${match[1]}`)
  }
}

const missing = testFiles.filter(
  (path) => !launched.has(path) && !commands.some((command) => command.includes(path))
)
assert.deepEqual(missing, [], `這些測試檔沒有被 npm test 執行：\n${missing.join('\n')}`)

const duplicates = commands.filter((command, index) => commands.indexOf(command) !== index)
assert.deepEqual(duplicates, [], `清單中有重複的測試：\n${duplicates.join('\n')}`)

console.log(`Test manifest covers ${testFiles.length} test files`)
