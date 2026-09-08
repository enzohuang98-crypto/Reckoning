import assert from 'node:assert/strict'
import Module from 'node:module'
import { IPC, type AutoConfigureCredentialResult } from '../../../src/shared/types/ipc'
import { EMPTY_APP_DATA, type AppDataSnapshot } from '../../../src/shared/types/AppData'
import { MAX_APP_DATA_BYTES } from '../../../src/main/security/InputValidation'

const fakeIpcMain = {
  handle: (_channel: string, _handler: unknown) => fakeIpcMain,
  on: (_channel: string, _handler: unknown) => fakeIpcMain
}
const fakeDialog = {
  showSaveDialog: async () => ({ canceled: true })
}
const moduleLoader = Module._load
;(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule | null,
  isMain: boolean
): unknown {
  if (request === 'electron') return { ipcMain: fakeIpcMain, dialog: fakeDialog }
  return moduleLoader.call(this, request, parent, isMain)
}
const { ipcMain, dialog } = require('electron') as {
  ipcMain: typeof fakeIpcMain
  dialog: typeof fakeDialog
}
const { registerAiExplanationHandlers } = require('../../../src/main/ipc/aiExplanationHandlers') as typeof import('../../../src/main/ipc/aiExplanationHandlers')
const { registerDataHandlers } = require('../../../src/main/ipc/dataHandlers') as typeof import('../../../src/main/ipc/dataHandlers')
const { configureTrustedRendererUrl } = require('../../../src/main/security/IpcSecurity') as typeof import('../../../src/main/security/IpcSecurity')

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const originalHandle = ipcMain.handle
const originalOn = ipcMain.on
const originalFetch = globalThis.fetch
const originalWarn = console.warn
const originalError = console.error
const logOutput: string[] = []
console.warn = (...args: unknown[]) => { logOutput.push(args.map(String).join(' ')) }
console.error = (...args: unknown[]) => { logOutput.push(args.map(String).join(' ')) }
;(ipcMain as unknown as { handle: typeof ipcMain.handle }).handle = ((channel: string, fn: Handler) => {
  handlers.set(channel, fn)
}) as typeof ipcMain.handle
;(ipcMain as unknown as { on: typeof ipcMain.on }).on = (() => ipcMain) as typeof ipcMain.on

const senderFrame = { url: 'app://trusted/index.html' }
const trustedEvent = {
  senderFrame,
  sender: { mainFrame: senderFrame }
}
const rejectedEvent = {
  senderFrame: { url: 'https://evil.invalid/' },
  sender: { mainFrame: { url: 'https://evil.invalid/' } }
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

const models = {
  data: [
    {
      id: 'vendor/model-a:free',
      name: 'Model A',
      architecture: { output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0', request: '0' }
    }
  ]
}

function credentialStore(options: {
  active?: { provider: 'openrouter'; model: string } | null
  failWrite?: boolean
} = {}) {
  const writes: unknown[] = []
  let active = options.active ?? { provider: 'openrouter', model: 'old/model:free' }
  return {
    writes,
    async setCredential(...args: unknown[]) {
      writes.push(args)
      if (options.failWrite) throw new Error('synthetic storage failure')
      active = { provider: 'openrouter', model: String(args[1]) }
    },
    async getStatus() {
      return {
        configured: active !== null,
        needsReentry: false,
        activeCredential: active,
        credentials: active ? [active] : []
      }
    },
    isEncryptionAvailable: () => true,
    async getCredential() { return null },
    async hasCredential() { return false },
    async setActiveCredential() { return true },
    async deleteCredential() { return undefined }
  }
}

function installFetch(mode: '401' | '429' | 'models503' | 'generation404' | 'success') {
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/api/v1/key')) {
      if (mode === '401') return jsonResponse(401, { error: { message: 'fake-key sk-or-v1-secret' } })
      if (mode === '429') return jsonResponse(429, { error: { message: 'rate limit' } }, { 'retry-after': '2' })
      return jsonResponse(200, { data: {} })
    }
    if (url.includes('/api/v1/models')) {
      if (mode === 'models503') return jsonResponse(503, { error: { message: 'catalog unavailable' } })
      return jsonResponse(200, models)
    }
    if (mode === 'generation404') {
      return jsonResponse(404, { error: { message: 'model missing' } })
    }
    return jsonResponse(200, {
      model: 'vendor/model-a:free',
      choices: [{ message: { content: 'synthetic answer' }, finish_reason: 'stop' }]
    })
  }) as typeof fetch
}

function autoHandler(): Handler {
  const fn = handlers.get(IPC.AI_AUTO_CONFIGURE_CREDENTIAL)
  assert.ok(fn, 'registered AI auto-configure IPC handler is required')
  return fn
}

async function runCredentialCase(
  mode: Parameters<typeof installFetch>[0],
  expected: { stage: string; category: string; status?: number; writes: number }
): Promise<void> {
  installFetch(mode)
  const store = credentialStore()
  // The real registered handler resolves getAIProvider internally; only transport and SecretStore are mocked.
  registerAiExplanationHandlers(
    store as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  )
  const result = await autoHandler()(trustedEvent, {
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'vendor/model-a:free'
  }) as AutoConfigureCredentialResult
  assert.equal(result.ok, false)
  assert.ok(result.diagnostic)
  assert.equal(result.diagnostic.stage, expected.stage)
  assert.equal(result.diagnostic.category, expected.category)
  if (expected.status !== undefined) assert.equal(result.diagnostic.httpStatus, expected.status)
  assert.equal(store.writes.length, expected.writes)
  assert.doesNotMatch(result.message, /sk-or-v1-test|sk-or-v1-secret/)
  const status = await store.getStatus()
  assert.equal(status.activeCredential?.model, 'old/model:free', 'validation failure must preserve the prior active credential')
}

async function main(): Promise<void> {
  configureTrustedRendererUrl('app://trusted/index.html')

  await runCredentialCase('401', { stage: 'key', category: 'authentication', status: 401, writes: 0 })
  handlers.clear()
  await runCredentialCase('429', { stage: 'key', category: 'rate_limited', status: 429, writes: 0 })
  handlers.clear()
  await runCredentialCase('models503', { stage: 'catalog', category: 'provider_unavailable', status: 503, writes: 0 })
  handlers.clear()
  await runCredentialCase('generation404', { stage: 'generation', category: 'model_unavailable', status: 404, writes: 0 })
  handlers.clear()
  installFetch('success')
  const failingStore = credentialStore({ failWrite: true })
  registerAiExplanationHandlers(
    failingStore as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  )
  const storageFailure = await autoHandler()(trustedEvent, {
    provider: 'openrouter',
    apiKey: 'sk-or-v1-test',
    model: 'vendor/model-a:free'
  }) as AutoConfigureCredentialResult
  assert.equal(storageFailure.ok, false)
  assert.equal(storageFailure.diagnostic?.stage, 'storage')
  assert.equal(storageFailure.diagnostic?.category, 'storage')
  assert.equal(failingStore.writes.length, 1)
  const failingStatus = await failingStore.getStatus()
  assert.equal(failingStatus.activeCredential?.model, 'old/model:free')
  assert.doesNotMatch(logOutput.join('\n'), /sk-or-v1-test|sk-or-v1-secret/)

  handlers.clear()
  let written: AppDataSnapshot | null = null
  let writtenPath: string | null = null
  let failWrite = false
  const dataStorage = {
    async readAppDataWithMigration() { return EMPTY_APP_DATA },
    async writeAbsoluteAsync(path: string, snapshot: AppDataSnapshot) {
      if (failWrite) throw new Error('synthetic destination failure')
      writtenPath = path
      written = snapshot
    }
  }
  registerDataHandlers(dataStorage as never)
  const exportHandler = handlers.get(IPC.DATA_EXPORT)
  assert.ok(exportHandler, 'registered DATA_EXPORT IPC handler is required')
  let dialogResult: { canceled: boolean; filePath?: string } = {
    canceled: false,
    filePath: 'C:\\synthetic\\backup.json'
  }
  const originalShowSaveDialog = dialog.showSaveDialog
  ;(dialog as unknown as { showSaveDialog: typeof dialog.showSaveDialog }).showSaveDialog =
    (async () => dialogResult) as typeof dialog.showSaveDialog
  try {
    const liveSnapshot: AppDataSnapshot = {
      ...EMPTY_APP_DATA,
      savedPositions: [{
        id: 'live-position',
        name: 'live',
        fen: EMPTY_APP_DATA.savedPositions[0]?.fen ?? '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z'
      }],
      conversations: [{
        id: 'live-conversation',
        analysisId: 'live-analysis',
        positionFen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        messages: []
      }]
    }
    const sourceBefore = JSON.stringify(liveSnapshot)
    const exported = await exportHandler(trustedEvent, liveSnapshot) as { ok: boolean }
    assert.equal(exported.ok, true)
    assert.equal(writtenPath, 'C:\\synthetic\\backup.json')
    assert.equal(written?.savedPositions[0]?.id, 'live-position')
    assert.equal(written?.conversations[0]?.id, 'live-conversation')
    assert.equal(JSON.stringify(liveSnapshot), sourceBefore, 'export must not mutate the source snapshot')

    dialogResult = { canceled: true }
    const cancelled = await exportHandler(trustedEvent, liveSnapshot) as { cancelled?: boolean }
    assert.equal(cancelled.cancelled, true)

    failWrite = true
    dialogResult = { canceled: false, filePath: 'C:\\synthetic\\failed.json' }
    const failed = await exportHandler(trustedEvent, liveSnapshot) as { ok: boolean }
    assert.equal(failed.ok, false)

    failWrite = false
    const invalid = await exportHandler(trustedEvent, { invalid: true }) as { ok: boolean }
    assert.equal(invalid.ok, false)
    const oversized = {
      ...EMPTY_APP_DATA,
      savedPositions: [{
        id: 'oversized',
        name: 'x'.repeat(MAX_APP_DATA_BYTES),
        fen: '9/9/9/9/9/9/9/9/9/9 w - - 0 1',
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z'
      }]
    }
    const tooLarge = await exportHandler(trustedEvent, oversized) as { ok: boolean }
    assert.equal(tooLarge.ok, false)
    await assert.rejects(
      () => exportHandler(rejectedEvent, liveSnapshot),
      /Rejected IPC call/
    )
  } finally {
    ;(dialog as unknown as { showSaveDialog: typeof dialog.showSaveDialog }).showSaveDialog =
      originalShowSaveDialog
  }
  console.log('IPC review boundary tests passed')
}

main().finally(() => {
  globalThis.fetch = originalFetch
  console.warn = originalWarn
  console.error = originalError
  ipcMain.handle = originalHandle
  ipcMain.on = originalOn
  ;(Module as unknown as { _load: typeof Module._load })._load = moduleLoader
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
