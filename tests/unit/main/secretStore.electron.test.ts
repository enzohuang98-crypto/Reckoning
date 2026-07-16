import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  buildAIExplanationRequest,
  MissingApiKeyError
} from '../../../src/main/ipc/aiExplanationHandlers'
import type {
  AnalysisSession,
  AnalysisSessionStore
} from '../../../src/main/storage/AnalysisSessionStore'
import { SecretStore } from '../../../src/main/storage/SecretStore'
import type { GenerateExplanationStartPayload } from '../../../src/shared/types/ipc'

const encryption = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (value: string): Buffer =>
    Buffer.from(`protected:${[...value].reverse().join('')}`),
  decryptString: (value: Buffer): string => {
    const encoded = value.toString()
    if (!encoded.startsWith('protected:')) throw new Error('corrupt')
    return [...encoded.slice('protected:'.length)].reverse().join('')
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  const directory = mkdtempSync(join(tmpdir(), 'xiangqi-secret-store-'))
  try {
    const filePath = join(directory, 'secrets.enc.json')
    const store = new SecretStore(filePath, encryption)

    store.setCredential('gemini', 'gemini-3.5-flash', 'gemini-flash-key')
    store.setCredential('gemini', 'gemini-3.1-pro-preview', 'gemini-pro-key')
    store.setCredential('anthropic', 'claude-sonnet-4-6', 'claude-key')

    assert.equal(
      store.getCredential('gemini', 'gemini-3.5-flash'),
      'gemini-flash-key',
      'Gemini Flash 必須取得自己的 key'
    )
    assert.equal(
      store.getCredential('gemini', 'gemini-3.1-pro-preview'),
      'gemini-pro-key',
      'Gemini Pro 必須取得自己的 key'
    )
    assert.equal(
      store.getCredential('anthropic', 'claude-sonnet-4-6'),
      'claude-key',
      'Claude 必須取得自己的 key'
    )
    assert.equal(
      store.getCredential('gemini', 'gemini-3.1-flash-lite'),
      null,
      '同 provider 未配置的模型不得 fallback'
    )

    const session: AnalysisSession = {
      analysisId: 'credential-test-analysis',
      requestId: 'credential-test-engine',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
      engineAnalysis: {
        positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
        sideToMove: 'red',
        bestMove: 'a0a1',
        scoreAfterUserMove: null,
        scoreAfterBestMove: null,
        evaluationAfterUserMove: null,
        evaluationAfterBestMove: null,
        userMoveEvaluationSource: 'unavailable',
        depth: 10,
        candidateMoves: [],
        principalVariation: ['a0a1'],
        incomplete: false,
        warnings: [],
        engineName: 'credential-test-engine'
      },
      moveComparison: {
        positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
        sideToMove: 'red',
        userMove: 'a0a1',
        engineBestMove: 'a0a1',
        evaluationAfterUserMove: null,
        evaluationAfterBestMove: null,
        scoreDifference: null,
        mistakeLevel: 'unknown',
        depth: 10,
        confidence: 'low',
        uncertaintyReasons: ['credential test']
      }
    }
    const analysisSessionStore: AnalysisSessionStore = {
      save: async () => undefined,
      get: async (analysisId) =>
        analysisId === session.analysisId ? session : null,
      delete: async () => undefined,
      clearExpiredSessions: async () => undefined
    }
    const requestPayload: GenerateExplanationStartPayload = {
      requestId: 'credential-binding-request',
      analysisId: session.analysisId,
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW'
    }
    const proRequest = await buildAIExplanationRequest(requestPayload, {
      secretStore: store,
      analysisSessionStore
    })
    assert.equal(
      proRequest.apiKey,
      'gemini-pro-key',
      'backend 必須選到 Gemini Pro 自己的 key'
    )
    await assert.rejects(
      () =>
        buildAIExplanationRequest(
          { ...requestPayload, model: 'gemini-3.1-flash-lite' },
          { secretStore: store, analysisSessionStore }
        ),
      MissingApiKeyError,
      'backend 不得 fallback 到同 provider 的其他 key'
    )

    store.setCredential(
      'openai-compatible',
      'local-model',
      'local-token',
      'http://127.0.0.1:1234/v1/'
    )
    assert.equal(
      store.getCredential(
        'openai-compatible',
        'local-model',
        'http://127.0.0.1:1234/v1'
      ),
      'local-token',
      'Base URL 應正規化後精確命中'
    )
    assert.equal(
      store.getCredential(
        'openai-compatible',
        'local-model',
        'http://127.0.0.1:11434/v1'
      ),
      null,
      '不同端點不得取得同一 key'
    )

    assert.equal(
      store.setActiveCredential('gemini', 'gemini-3.5-flash'),
      true
    )
    const status = store.getStatus()
    assert.deepEqual(status.activeCredential, {
      provider: 'gemini',
      model: 'gemini-3.5-flash'
    })
    assert.equal(status.credentials.length, 4)
    const serializedStatus = JSON.stringify(status)
    for (const secret of [
      'gemini-flash-key',
      'gemini-pro-key',
      'claude-key',
      'local-token',
      'encryptedKey'
    ]) {
      assert.equal(
        serializedStatus.includes(secret),
        false,
        `renderer status 不得洩漏 ${secret}`
      )
    }

    store.deleteCredential('gemini', 'gemini-3.5-flash')
    assert.equal(store.getCredential('gemini', 'gemini-3.5-flash'), null)
    assert.equal(
      store.getCredential('gemini', 'gemini-3.1-pro-preview'),
      'gemini-pro-key',
      '刪除一個模型不得刪除同 provider 的其他模型'
    )

    const legacyPath = join(directory, 'legacy.enc.json')
    const legacyEncrypted = encryption
      .encryptString('legacy-gemini-key')
      .toString('base64')
    writeFileSync(
      legacyPath,
      JSON.stringify({
        version: 3,
        secrets: { gemini: legacyEncrypted },
        activeProvider: 'gemini',
        activeBaseUrl: null
      })
    )
    const migrated = new SecretStore(legacyPath, encryption)
    assert.equal(
      migrated.getCredential('gemini', 'gemini-3.5-flash'),
      'legacy-gemini-key',
      'v3 Gemini provider-only key 必須遷移到 Gemini 3.5 Flash'
    )
    assert.equal(
      migrated.getCredential('gemini', 'gemini-3.1-pro-preview'),
      null,
      '遷移不得擴張成整個 provider 共用'
    )
    const migratedFile = JSON.parse(readFileSync(legacyPath, 'utf8')) as {
      version: number
      credentials: Array<{ model: string }>
    }
    assert.equal(migratedFile.version, 4)
    assert.deepEqual(
      migratedFile.credentials.map((credential) => credential.model),
      ['gemini-3.5-flash']
    )

    const legacyV1Path = join(directory, 'legacy-v1.enc.json')
    writeFileSync(
      legacyV1Path,
      JSON.stringify({
        version: 1,
        secrets: { gemini: legacyEncrypted }
      })
    )
    const migratedV1 = new SecretStore(legacyV1Path, encryption)
    assert.equal(
      migratedV1.getCredential('gemini', 'gemini-3.5-flash'),
      'legacy-gemini-key',
      '目前實際存在的 v1 provider-only schema 也必須遷移到 Gemini 3.5 Flash'
    )

    const brokenActivePath = join(directory, 'broken-active.enc.json')
    writeFileSync(
      brokenActivePath,
      JSON.stringify({
        version: 4,
        activeCredential: {
          provider: 'gemini',
          model: 'gemini-3.1-pro-preview'
        },
        credentials: [
          {
            provider: 'gemini',
            model: 'gemini-3.1-pro-preview',
            encryptedKey: Buffer.from('corrupt').toString('base64')
          },
          {
            provider: 'gemini',
            model: 'gemini-3.5-flash',
            encryptedKey: encryption
              .encryptString('working-flash-key')
              .toString('base64')
          }
        ]
      })
    )
    const brokenActiveStatus = new SecretStore(
      brokenActivePath,
      encryption
    ).getStatus()
    assert.deepEqual(
      brokenActiveStatus.activeCredential,
      { provider: 'gemini', model: 'gemini-3.5-flash' },
      'active key 壞掉但仍有可解密 key 時，status 必須選擇可用的精確憑證'
    )
    assert.equal(brokenActiveStatus.configured, true)
    assert.equal(
      brokenActiveStatus.credentials.find(
        (credential) => credential.model === 'gemini-3.1-pro-preview'
      )?.needsReentry,
      true,
      '壞掉的憑證仍須留在 metadata 清單供使用者修復'
    )

    console.log('SecretStore 精確憑證測試：通過')
  } finally {
    rmSync(directory, { recursive: true, force: true })
    app.quit()
  }
}

void main().catch((error) => {
  console.error(error)
  app.quit()
  process.exitCode = 1
})
