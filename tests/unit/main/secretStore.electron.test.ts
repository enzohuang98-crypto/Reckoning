import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  buildAIExplanationRequest,
  MissingApiKeyError
} from '../../../src/main/ipc/aiExplanationHandlers'
import { prepareExplanationExecution } from '../../../src/main/ai/prepareExplanationExecution'
import type { AnalysisSession } from '../../../src/main/storage/AnalysisSessionStore'
import { SecretStore } from '../../../src/main/storage/SecretStore'
import {
  SecretCredentialChangedError,
  SecretCredentialConflictError
} from '../../../src/main/storage/SecretStore'
import { TeacherTestRunService } from '../../../src/main/teacherTest/TeacherTestRunService'
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

    await store.setCredential('gemini', 'gemini-3.5-flash', 'gemini-flash-key')
    await store.setCredential('gemini', 'gemini-3.1-pro-preview', 'gemini-pro-key')
    await store.setCredential('anthropic', 'claude-sonnet-4-6', 'claude-key')

    assert.equal(
      await store.getCredential('gemini', 'gemini-3.5-flash'),
      'gemini-flash-key',
      'Gemini Flash 必須取得自己的 key'
    )
    assert.equal(
      await store.getCredential('gemini', 'gemini-3.1-pro-preview'),
      'gemini-pro-key',
      'Gemini Pro 必須取得自己的 key'
    )
    assert.equal(
      await store.getCredential('anthropic', 'claude-sonnet-4-6'),
      'claude-key',
      'Claude 必須取得自己的 key'
    )
    assert.equal(
      await store.getCredential('gemini', 'gemini-3.1-flash-lite'),
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
    const teacherRun = new TeacherTestRunService({
      getRuntime: () => ({
        appVersion: '0.3.11',
        platform: 'win32',
        systemVersion: '10.0.22631',
        osBuild: 'Windows 11 10.0.22631',
        arch: 'x64'
      })
    })
    const requestPayload: GenerateExplanationStartPayload = {
      requestId: 'credential-binding-request',
      analysisId: session.analysisId,
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      userLevel: 'intermediate',
      explanationStyle: 'long_analytical',
      language: 'zh-TW'
    }
    const proExecution = prepareExplanationExecution(
      requestPayload,
      session,
      requestPayload.model,
      teacherRun
    )
    const proRequest = await buildAIExplanationRequest(proExecution, { secretStore: store })
    assert.equal(
      proRequest.apiKey,
      'gemini-pro-key',
      'backend 必須選到 Gemini Pro 自己的 key'
    )
    await assert.rejects(
      () =>
        buildAIExplanationRequest(
          prepareExplanationExecution(
            { ...requestPayload, model: 'gemini-3.1-flash-lite' },
            session,
            'gemini-3.1-flash-lite',
            teacherRun
          ),
          { secretStore: store }
        ),
      MissingApiKeyError,
      'backend 不得 fallback 到同 provider 的其他 key'
    )

    await store.setCredential(
      'openai-compatible',
      'local-model',
      'local-token',
      'http://127.0.0.1:1234/v1/'
    )
    assert.equal(
      await store.getCredential(
        'openai-compatible',
        'local-model',
        'http://127.0.0.1:1234/v1'
      ),
      'local-token',
      'Base URL 應正規化後精確命中'
    )
    assert.equal(
      await store.getCredential(
        'openai-compatible',
        'local-model',
        'http://127.0.0.1:11434/v1'
      ),
      null,
      '不同端點不得取得同一 key'
    )

    const openRouterModel = 'meta-llama/llama-free:free'
    await store.setCredential(
      'openrouter',
      openRouterModel,
      'sk-or-v1-secret'
    )
    const openRouterExecution = prepareExplanationExecution(
      {
        ...requestPayload,
        provider: 'openrouter',
        model: openRouterModel
      },
      session,
      openRouterModel,
      teacherRun
    )
    const openRouterRequest = await buildAIExplanationRequest(
      openRouterExecution,
      { secretStore: store }
    )
    assert.equal(openRouterRequest.provider, 'openrouter')
    assert.equal(
      openRouterRequest.model,
      openRouterModel,
      'renderer 选择的 OpenRouter 完整模型 ID 必须原样进入后端请求'
    )
    assert.equal(openRouterRequest.apiKey, 'sk-or-v1-secret')

    const modelB = 'vendor/model-b:free'
    const firstSnapshot = await store.captureActiveCredential({
      provider: 'openrouter',
      model: openRouterModel
    })
    assert(firstSnapshot)
    await store.rebindOpenRouterCredential(firstSnapshot, modelB)
    assert.equal(await store.getCredential('openrouter', openRouterModel), null)
    assert.equal(await store.getCredential('openrouter', modelB), 'sk-or-v1-secret')
    const secondSnapshot = await store.captureActiveCredential({
      provider: 'openrouter',
      model: modelB
    })
    assert(secondSnapshot)
    await store.rebindOpenRouterCredential(secondSnapshot, openRouterModel)
    assert.equal(await store.getCredential('openrouter', openRouterModel), 'sk-or-v1-secret')
    assert.equal(await store.getCredential('openrouter', modelB), null)

    const conflictPath = join(directory, 'conflict.enc.json')
    const conflictStore = new SecretStore(conflictPath, encryption)
    await conflictStore.setCredential('openrouter', modelB, 'different-key')
    await conflictStore.setCredential('openrouter', openRouterModel, 'source-key')
    const conflictSnapshot = await conflictStore.captureActiveCredential({
      provider: 'openrouter',
      model: openRouterModel
    })
    assert(conflictSnapshot)
    await assert.rejects(
      () => conflictStore.rebindOpenRouterCredential(conflictSnapshot, modelB),
      SecretCredentialConflictError
    )
    assert.equal(await conflictStore.getCredential('openrouter', openRouterModel), 'source-key')
    assert.equal(await conflictStore.getCredential('openrouter', modelB), 'different-key')
    assert.deepEqual((await conflictStore.getStatus()).activeCredential, {
      provider: 'openrouter', model: openRouterModel
    })

    const deleteRacePath = join(directory, 'delete-race.enc.json')
    const deleteRaceStore = new SecretStore(deleteRacePath, encryption)
    await deleteRaceStore.setCredential('openrouter', openRouterModel, 'race-key')
    const deleteRaceSnapshot = await deleteRaceStore.captureActiveCredential()
    assert(deleteRaceSnapshot)
    const deleteFirst = deleteRaceStore.deleteCredential('openrouter', openRouterModel)
    const staleRebind = deleteRaceStore.rebindOpenRouterCredential(
      deleteRaceSnapshot,
      modelB
    )
    await deleteFirst
    await assert.rejects(() => staleRebind, SecretCredentialChangedError)
    assert.equal(await deleteRaceStore.getCredential('openrouter', modelB), null)

    const replaceRacePath = join(directory, 'replace-race.enc.json')
    const replaceRaceStore = new SecretStore(replaceRacePath, encryption)
    await replaceRaceStore.setCredential('openrouter', openRouterModel, 'old-key')
    const replaceSnapshot = await replaceRaceStore.captureActiveCredential()
    assert(replaceSnapshot)
    const replaceFirst = replaceRaceStore.setCredential(
      'openrouter', openRouterModel, 'new-key'
    )
    const replacedRebind = replaceRaceStore.rebindOpenRouterCredential(
      replaceSnapshot,
      modelB
    )
    await replaceFirst
    await assert.rejects(() => replacedRebind, SecretCredentialChangedError)
    assert.equal(
      await replaceRaceStore.getCredential('openrouter', openRouterModel),
      'new-key'
    )

    const writeFailurePath = join(directory, 'write-failure.enc.json')
    const writeFailureStore = new SecretStore(writeFailurePath, encryption)
    await writeFailureStore.setCredential('openrouter', openRouterModel, 'stable-key')
    const writeFailureSnapshot = await writeFailureStore.captureActiveCredential()
    assert(writeFailureSnapshot)
    ;(writeFailureStore as unknown as { write: () => Promise<void> }).write = async () => {
      throw new Error('synthetic atomic write failure')
    }
    await assert.rejects(() =>
      writeFailureStore.rebindOpenRouterCredential(writeFailureSnapshot, modelB)
    )
    const diskStatus = await new SecretStore(writeFailurePath, encryption).getStatus()
    assert.deepEqual(diskStatus.activeCredential, {
      provider: 'openrouter', model: openRouterModel
    })
    assert.equal(
      await new SecretStore(writeFailurePath, encryption).getCredential(
        'openrouter', openRouterModel
      ),
      'stable-key',
      '原子寫入失敗不得改變磁碟上的 active 或來源 key'
    )

    assert.equal(
      await store.setActiveCredential('gemini', 'gemini-3.5-flash'),
      true
    )
    const status = await store.getStatus()
    assert.deepEqual(status.activeCredential, {
      provider: 'gemini',
      model: 'gemini-3.5-flash'
    })
    assert.equal(status.credentials.length, 5)
    const serializedStatus = JSON.stringify(status)
    for (const secret of [
      'gemini-flash-key',
      'gemini-pro-key',
      'claude-key',
      'local-token',
      'sk-or-v1-secret',
      'encryptedKey'
    ]) {
      assert.equal(
        serializedStatus.includes(secret),
        false,
        `renderer status 不得洩漏 ${secret}`
      )
    }

    await store.deleteCredential('gemini', 'gemini-3.5-flash')
    assert.equal(await store.getCredential('gemini', 'gemini-3.5-flash'), null)
    assert.equal(
      await store.getCredential('gemini', 'gemini-3.1-pro-preview'),
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
      await migrated.getCredential('gemini', 'gemini-3.5-flash'),
      'legacy-gemini-key',
      'v3 Gemini provider-only key 必須遷移到 Gemini 3.5 Flash'
    )
    assert.equal(
      await migrated.getCredential('gemini', 'gemini-3.1-pro-preview'),
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
      await migratedV1.getCredential('gemini', 'gemini-3.5-flash'),
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
    const brokenActiveStatus = await new SecretStore(
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
