import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AIHttpError } from '../../../src/main/ai/http'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'
import { OpenRouterSavedModelService } from '../../../src/main/ai/switchOpenRouterModel'
import {
  SecretCredentialChangedError,
  SecretCredentialConflictError,
  type SecretCredentialSnapshot
} from '../../../src/main/storage/SecretStore'
import type { AIModelInfo, AITestCredentialResult } from '../../../src/shared/types/AIProviderTypes'
import type { SecretCredentialRef, SecretStatus } from '../../../src/shared/types/ipc'

const source: SecretCredentialRef = {
  provider: 'openrouter',
  model: 'vendor/model-a:free'
}
const targetModel = 'vendor/model-b:free'
const models: AIModelInfo[] = [
  { id: source.model, label: 'Model A' },
  { id: targetModel, label: 'Model B' }
]

function status(active: SecretCredentialRef = source): SecretStatus {
  return {
    configured: true,
    needsReentry: false,
    activeCredential: active,
    credentials: [{ ...active, configured: true, needsReentry: false }]
  }
}

function fakeStore(options: {
  capture?: SecretCredentialSnapshot | null
  rebindError?: Error
} = {}) {
  const snapshot = options.capture === undefined
    ? { credential: source, apiKey: 'synthetic-saved-key', revision: 1 }
    : options.capture
  let active = source
  let rebindCount = 0
  return {
    get rebindCount() { return rebindCount },
    async captureActiveCredential(expected?: SecretCredentialRef) {
      if (!snapshot || (expected && expected.model !== snapshot.credential.model)) return null
      return snapshot
    },
    async rebindOpenRouterCredential(_snapshot: SecretCredentialSnapshot, model: string) {
      rebindCount += 1
      if (options.rebindError) throw options.rebindError
      active = { provider: 'openrouter', model }
      return active
    },
    async getStatus() { return status(active) }
  }
}

async function withSuccessServer(run: (
  baseUrl: string,
  authorizations: Array<string | undefined>
) => Promise<void>): Promise<void> {
  const authorizations: Array<string | undefined> = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => { raw += String(chunk) })
    request.on('end', () => {
      authorizations.push(request.headers.authorization)
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/v1/key') {
        response.end(JSON.stringify({ data: {} }))
        return
      }
      if (request.url?.startsWith('/api/v1/models')) {
        response.end(JSON.stringify({
          data: models.map((model) => ({
            ...model,
            name: model.label,
            architecture: { output_modalities: ['text'] },
            pricing: { prompt: '0', completion: '0', request: '0' }
          }))
        }))
        return
      }
      const body = JSON.parse(raw) as { model: string }
      response.end(JSON.stringify({
        model: body.model,
        choices: [{ message: { content: 'synthetic answer' }, finish_reason: 'stop' }]
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    await run(`http://127.0.0.1:${port}/api/v1`, authorizations)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function main(): Promise<void> {
  await withSuccessServer(async (baseUrl, authorizations) => {
    const store = fakeStore()
    const service = new OpenRouterSavedModelService(
      store,
      new OpenRouterProvider({ baseUrl })
    )
    const listed = await service.listModels(source)
    assert.equal(listed.ok, true)
    if (listed.ok) assert.deepEqual(listed.models.map((model) => model.id), models.map((model) => model.id))
    const switched = await service.switchModel(source, targetModel, 'operation-success')
    assert.equal(switched.ok, true)
    assert.equal(store.rebindCount, 1)
    assert.deepEqual(
      new Set(authorizations),
      new Set(['Bearer synthetic-saved-key']),
      'list、catalog 與短生成必須使用同一把已存 key 且只送往同一 OpenRouter base URL'
    )
  })

  for (const expected of [401, 403, 429, 502] as const) {
    const store = fakeStore()
    const service = new OpenRouterSavedModelService(store, {
      async listFreeModels() { throw new AIHttpError(expected, 'key', 'synthetic') },
      async testCredentialWithModels() { throw new Error('unreachable') }
    })
    const result = await service.listModels(source)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.diagnostic?.httpStatus, expected)
    assert.equal(store.rebindCount, 0)
  }

  const timeoutStore = fakeStore()
  const timeoutService = new OpenRouterSavedModelService(timeoutStore, {
    async listFreeModels() { throw new DOMException('synthetic timeout', 'TimeoutError') },
    async testCredentialWithModels() { throw new Error('unreachable') }
  })
  const timedOut = await timeoutService.listModels(source)
  assert.equal(timedOut.ok, false)
  if (!timedOut.ok) assert.equal(timedOut.diagnostic?.category, 'timeout')

  const emptyStore = fakeStore()
  const emptyResult = await new OpenRouterSavedModelService(emptyStore, {
    async listFreeModels() { return [] },
    async testCredentialWithModels() { throw new Error('unreachable') }
  }).listModels(source)
  assert.equal(emptyResult.ok, false)
  if (!emptyResult.ok) assert.equal(emptyResult.diagnostic?.category, 'model_unavailable')

  let listingCapture = 0
  const staleListingStore = {
    ...fakeStore(),
    async captureActiveCredential() {
      listingCapture += 1
      return {
        credential: source,
        apiKey: 'synthetic-saved-key',
        revision: listingCapture
      }
    }
  }
  const staleListing = await new OpenRouterSavedModelService(staleListingStore, {
    async listFreeModels() { return models },
    async testCredentialWithModels() { throw new Error('unreachable') }
  }).listModels(source)
  assert.equal(staleListing.ok, false, '清單回來前 credential revision 改變必須丟棄舊清單')
  if (!staleListing.ok) assert.equal(staleListing.code, 'credential_changed')

  for (const expected of [401, 403, 429, 502] as const) {
    const store = fakeStore()
    const result = await new OpenRouterSavedModelService(store, {
      async listFreeModels() { return models },
      async testCredentialWithModels() {
        throw new AIHttpError(expected, 'generation', 'synthetic')
      }
    }).switchModel(source, targetModel, `operation-generation-${expected}`)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.diagnostic?.httpStatus, expected)
    assert.equal(store.rebindCount, 0, `generation ${expected} 不得持久化切換`)
  }

  const generationTimeoutStore = fakeStore()
  const generationTimeout = await new OpenRouterSavedModelService(
    generationTimeoutStore,
    {
      async listFreeModels() { return models },
      async testCredentialWithModels() {
        throw new DOMException('synthetic timeout', 'TimeoutError')
      }
    }
  ).switchModel(source, targetModel, 'operation-generation-timeout')
  assert.equal(generationTimeout.ok, false)
  if (!generationTimeout.ok) {
    assert.equal(generationTimeout.diagnostic?.category, 'timeout')
  }
  assert.equal(generationTimeoutStore.rebindCount, 0)

  const invalidTargetStore = fakeStore()
  const invalidTarget = await new OpenRouterSavedModelService(invalidTargetStore, {
    async listFreeModels() { return models },
    async testCredentialWithModels(): Promise<AITestCredentialResult> {
      return {
        ok: false,
        message: 'target unavailable',
        diagnostic: {
          stage: 'catalog', category: 'model_unavailable', retryable: true,
          message: 'target unavailable'
        }
      }
    }
  }).switchModel(source, 'missing/model:free', 'operation-invalid-target')
  assert.equal(invalidTarget.ok, false)
  assert.equal(invalidTargetStore.rebindCount, 0)

  for (const [error, code] of [
    [new SecretCredentialConflictError(), 'credential_conflict'],
    [new SecretCredentialChangedError(), 'credential_changed']
  ] as const) {
    const store = fakeStore({ rebindError: error })
    const result = await new OpenRouterSavedModelService(store, {
      async listFreeModels() { return models },
      async testCredentialWithModels() { return { ok: true, message: 'ok' } }
    }).switchModel(source, targetModel, `operation-${code}`)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, code)
  }

  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  let tests = 0
  const busyStore = fakeStore()
  const busyService = new OpenRouterSavedModelService(busyStore, {
    async listFreeModels() { return models },
    async testCredentialWithModels() {
      tests += 1
      await waiting
      return { ok: true, message: 'ok' }
    }
  })
  const first = busyService.switchModel(source, targetModel, 'same-operation')
  const duplicate = busyService.switchModel(source, targetModel, 'same-operation')
  assert.equal(first, duplicate, '相同 operationId 必須 single-flight 去重')
  const busy = await busyService.switchModel(source, source.model, 'other-operation')
  assert.equal(busy.ok, false)
  if (!busy.ok) assert.equal(busy.code, 'operation_busy')
  release()
  await first
  assert.equal(tests, 1)
  assert.equal(busyStore.rebindCount, 1)

  const staleStore = fakeStore({ capture: null })
  const stale = await new OpenRouterSavedModelService(staleStore, {
    async listFreeModels() { throw new Error('unreachable') },
    async testCredentialWithModels() { throw new Error('unreachable') }
  }).switchModel(source, targetModel, 'stale-operation')
  assert.equal(stale.ok, false)
  if (!stale.ok) assert.equal(stale.code, 'credential_changed')

  console.log('Saved OpenRouter model switch orchestration tests passed')
}

void main()
