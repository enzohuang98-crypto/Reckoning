import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AiPreferencesStore,
  validateOpenRouterBackupModels
} from '../../../src/main/ai/AiPreferencesStore'

const available = ['vendor/a:free', 'vendor/b:free', 'vendor/c:free']

assert.deepEqual(validateOpenRouterBackupModels(['vendor/b:free'], 'vendor/a:free', available), { ok: true, models: ['vendor/b:free'] })
assert.deepEqual(validateOpenRouterBackupModels([], 'vendor/a:free', available), { ok: true, models: [] })
assert.deepEqual(
  validateOpenRouterBackupModels(['vendor/b:free', 'vendor/b:free'], 'vendor/a:free', available),
  { ok: true, models: ['vendor/b:free'] }
)
for (const [input, pattern] of [
  [['vendor/paid'], /:free/],
  [['vendor/z:free'], /不在免費清單/],
  [['vendor/a:free'], /主模型/],
  [['vendor/b:free', 'vendor/c:free', 'vendor/a:free'], /最多 2 個/],
  ['vendor/b:free', /格式無效/],
  [['bad model id:free'], /:free/]
] as const) {
  const result = validateOpenRouterBackupModels(input, 'vendor/a:free', available)
  assert.equal(result.ok, false, JSON.stringify(input))
  assert.match((result as { message: string }).message, pattern)
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-preferences-'))
  try {
    const filePath = join(directory, 'ai-preferences.json')
    const store = new AiPreferencesStore(filePath)
    assert.deepEqual(await store.get(), { openRouterBackupModels: [] })
    await store.setOpenRouterBackupModels(['vendor/b:free', 'vendor/c:free'])
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), {
      openRouterBackupModels: ['vendor/b:free', 'vendor/c:free']
    })
    const reloaded = new AiPreferencesStore(filePath)
    assert.deepEqual((await reloaded.get()).openRouterBackupModels, ['vendor/b:free', 'vendor/c:free'])

    // 被手改的檔案：非免費、重複與超量項目在讀取時被丟掉。
    await writeFile(filePath, JSON.stringify({ openRouterBackupModels: ['vendor/paid', 'vendor/b:free', 'vendor/b:free', 'vendor/c:free', 'vendor/d:free'] }))
    assert.deepEqual((await new AiPreferencesStore(filePath).get()).openRouterBackupModels, ['vendor/b:free', 'vendor/c:free'])
    await writeFile(filePath, '{broken')
    assert.deepEqual(await new AiPreferencesStore(filePath).get(), { openRouterBackupModels: [] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  console.log('AiPreferencesStore tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
