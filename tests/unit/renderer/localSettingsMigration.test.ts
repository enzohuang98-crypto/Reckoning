import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key)
}

async function main(): Promise<void> {
  const { loadSettings } = await import('../../../src/renderer/src/storage/localSettings')
  const { DEFAULT_SETTINGS } = await import('../../../src/shared/types/Settings')

  // v4 → v5：保留使用者的 provider／模型／程度，只丟掉 Harness 參數，並寫回新版本。
  store.set(
    'xiangqi.settings',
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      version: 4,
      aiProvider: 'openai-compatible',
      aiModel: 'local-model',
      aiBaseUrl: 'http://127.0.0.1:11434/v1',
      userLevel: 'advanced',
      language: 'zh-CN',
      crossEngineEnabled: true,
      harnessAnswerMode: 'focused',
      harnessMaxEngineRounds: 7
    })
  )
  const migrated = loadSettings() as unknown as Record<string, unknown>
  assert.equal(migrated.aiProvider, 'openai-compatible')
  assert.equal(migrated.aiModel, 'local-model')
  assert.equal(migrated.aiBaseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(migrated.userLevel, 'advanced')
  assert.equal(migrated.language, 'zh-CN')
  assert.equal(migrated.version, 5)
  assert.equal('harnessAnswerMode' in migrated, false)
  assert.equal('harnessMaxEngineRounds' in migrated, false)

  const saved = JSON.parse(store.get('xiangqi.settings') ?? '{}') as Record<string, unknown>
  assert.equal(saved.version, 5)
  assert.equal(saved.aiModel, 'local-model')
  assert.equal('harnessAnswerMode' in saved, false)

  // 已是 v5 的設定原樣讀回。
  assert.equal(loadSettings().aiModel, 'local-model')

  console.log('local settings v4 → v5 migration tests passed')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
