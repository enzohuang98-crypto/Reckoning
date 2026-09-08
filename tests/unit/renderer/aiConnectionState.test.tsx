import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
import type { AIModelInfo } from '../../../src/shared/types/AIProviderTypes'
import type { EngineRegistrySnapshot } from '../../../src/shared/types/EngineRegistry'
import type { AppDataSnapshot } from '../../../src/shared/types/AppData'
import type { AppSettings } from '../../../src/shared/types/Settings'
import type {
  AutoConfigureCredentialResult,
  RendererApi,
  SecretStatus
} from '../../../src/shared/types/ipc'
import { SettingsPage } from '../../../src/renderer/src/pages/SettingsPage'
import { SetupWizard } from '../../../src/renderer/src/pages/SetupWizard'
import { AiConnectionStatus } from '../../../src/renderer/src/features/settings/AiConnectionStatus'

const models: AIModelInfo[] = [
  { id: 'vendor/model-a:free', label: 'Model A' },
  { id: 'vendor/model-b:free', label: 'Model B' }
]

const emptySecretStatus: SecretStatus = {
  configured: false,
  needsReentry: false,
  activeCredential: null,
  credentials: []
}

const emptyEngineRegistry: EngineRegistrySnapshot = {
  installations: [],
  activeEngineId: null,
  verificationEngineId: null
}

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('')
}

function buttonByText(
  root: TestRenderer.ReactTestInstance,
  label: string
): TestRenderer.ReactTestInstance {
  const button = root
    .findAllByType('button')
    .find(
      (candidate) =>
        candidate.props.className?.split(' ').includes('btn') &&
        textContent(candidate).includes(label)
    )
  assert.ok(button, `找不到按鈕：${label}`)
  return button
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function flush(): Promise<void> {
  await TestRenderer.act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
}

function anyButtonByText(
  root: TestRenderer.ReactTestInstance,
  label: string
): TestRenderer.ReactTestInstance {
  const button = root
    .findAllByType('button')
    .find((candidate) => textContent(candidate).includes(label))
  assert.ok(button, `找不到按鈕：${label}`)
  return button
}

async function setupWizardFlow(): Promise<void> {
  const requests: Array<{
    apiKey: string
    model?: string
    deferred: ReturnType<typeof deferred<AutoConfigureCredentialResult>>
  }> = []
  const storage = new Map<string, string>()
  const settingsChanges: AppSettings[] = []
  let completed = false
  const api = {
    ai: {
      autoConfigureCredential: (apiKey: string, model?: string) => {
        const pending = deferred<AutoConfigureCredentialResult>()
        requests.push({ apiKey, model, deferred: pending })
        return pending.promise
      }
    },
    engine: {
      browsePath: async () => null,
      setPath: async () => undefined,
      test: async () => ({ ok: true, protocol: 'uci' as const })
    }
  } as unknown as RendererApi
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { api, setTimeout, clearTimeout, localStorage }
  })
  let renderer: TestRenderer.ReactTestRenderer | null = null
  try {
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <SetupWizard
          settings={DEFAULT_SETTINGS}
          onSettingsChange={(next) => {
            settingsChanges.push(next)
          }}
          onComplete={() => {
            completed = true
          }}
        />
      )
    })
    assert.ok(renderer)
    const input = (): TestRenderer.ReactTestInstance =>
      renderer!.root.findByProps({
        placeholder: '贴上 OpenAI、Anthropic、Gemini 或 OpenRouter 官方 API Key'
      })
    TestRenderer.act(() => input().props.onChange({ target: { value: 'sk-or-v1-setup-test' } }))
    TestRenderer.act(() => buttonByText(renderer!.root, '完成設定').props.onClick())
    assert.equal(requests.length, 1, '嚮導首次提交只應讀取一次模型目錄')
    assert.equal(requests[0]!.model, undefined)
    TestRenderer.act(() => {
      requests[0]!.deferred.resolve({
        ok: true,
        configured: false,
        provider: 'openrouter',
        models,
        message: 'catalog ready'
      })
    })
    await flush()
    const select = (): TestRenderer.ReactTestInstance =>
      renderer!.root.findByProps({ id: 'setup-openrouter-free-model' })
    assert.equal(select().props.value, models[0]!.id, '首次目錄成功仍可自動選第一個模型')
    TestRenderer.act(() => select().props.onChange({ target: { value: models[1]!.id } }))
    TestRenderer.act(() => buttonByText(renderer!.root, '验证模型并完成設定').props.onClick())
    assert.equal(requests.length, 2)
    assert.equal(requests[1]!.model, models[1]!.id)
    TestRenderer.act(() => {
      requests[1]!.deferred.resolve({ ok: false, message: '429 暫時限流' })
    })
    await flush()
    assert.equal(input().props.value, 'sk-or-v1-setup-test')
    assert.equal(select().props.value, models[1]!.id, '429 必須保留金鑰草稿與模型選擇')
    assert.match(textContent(renderer.root), /429 暫時限流/)
    TestRenderer.act(() => buttonByText(renderer!.root, '验证模型并完成設定').props.onClick())
    assert.equal(requests.length, 3)
    assert.equal(requests[2]!.model, models[1]!.id)
    TestRenderer.act(() => {
      requests[2]!.deferred.resolve({
        ok: false,
        message: '生成階段逾時',
        diagnostic: {
          stage: 'generation',
          category: 'timeout',
          retryable: true,
          message: '生成階段逾時'
        }
      })
    })
    await flush()
    assert.equal(select().props.value, models[1]!.id, '逾時必須保留原選擇供再次驗證')
    assert.match(textContent(renderer.root), /生成階段逾時/)
    TestRenderer.act(() => buttonByText(renderer!.root, '重新讀取免費模型').props.onClick())
    assert.equal(requests.length, 4, '手動刷新應只再讀取一次目錄')
    assert.equal(requests[3]!.model, undefined)
    TestRenderer.act(() => {
      requests[3]!.deferred.resolve({
        ok: true,
        configured: false,
        provider: 'openrouter',
        models: [models[0]!],
        message: 'catalog refreshed'
      })
    })
    await flush()
    assert.equal(select().props.value, models[1]!.id, '消失的模型 ID 必須保留')
    assert.match(textContent(renderer.root), /已不在最新清單，請重新選擇模型/)
    const finishButton = buttonByText(renderer!.root, '验证模型并完成設定')
    assert.equal(finishButton.props.disabled, true, '失效模型不可直接送出驗證')
    TestRenderer.act(() => select().props.onChange({ target: { value: models[0]!.id } }))
    assert.equal(finishButton.props.disabled, false)
    TestRenderer.act(() => finishButton.props.onClick())
    assert.equal(requests.length, 5, '重新選擇後才應發出唯一一次成功驗證')
    assert.equal(requests[4]!.model, models[0]!.id)
    TestRenderer.act(() => {
      requests[4]!.deferred.resolve({
        ok: true,
        configured: true,
        credential: { provider: 'openrouter', model: models[0]!.id },
        status: {
          configured: true,
          needsReentry: false,
          activeCredential: { provider: 'openrouter', model: models[0]!.id },
          credentials: []
        },
        message: 'AI 已啟用'
      })
    })
    await flush()
    assert.equal(completed, true, '設定儲存成功後才完成嚮導')
    assert.equal(settingsChanges.at(-1)?.aiModel, models[0]!.id)
    assert.equal(storage.get('setup_completed'), '1')
    console.log('SetupWizard 目錄、重試、失效模型與成功啟用測試：通過')
  } finally {
    if (renderer) TestRenderer.act(() => renderer?.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

async function settingsBackupFlow(): Promise<void> {
  const snapshotA: AppDataSnapshot = {
    schemaVersion: 2,
    savedPositions: [],
    conversations: [],
    userGuesses: []
  }
  const snapshotB: AppDataSnapshot = {
    ...snapshotA,
    conversations: [{
      id: 'conversation-b',
      analysisId: 'analysis-b',
      positionFen: 'startpos',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
      messages: []
    }]
  }
  const snapshotC: AppDataSnapshot = {
    ...snapshotB,
    savedPositions: [{
      id: 'position-c',
      name: 'current',
      fen: 'startpos',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z'
    }]
  }
  const exported: AppDataSnapshot[] = []
  let currentSnapshot = snapshotA
  let exportResult: { ok: boolean; cancelled?: boolean; filePath?: string; message?: string } = {
    ok: true,
    filePath: 'backup-a.json'
  }
  const api = {
    secret: {
      isAvailable: async () => true,
      status: async () => emptySecretStatus
    },
    engine: {
      listInstallations: async () => emptyEngineRegistry
    },
    license: {
      status: async () => ({ activated: false, message: 'not activated' })
    },
    update: {
      onChanged: () => () => undefined,
      status: async () => null
    },
    data: {
      exportBackup: async (snapshot: AppDataSnapshot) => {
        exported.push(snapshot)
        return exportResult
      },
      importBackup: async () => ({ cancelled: true })
    }
  } as unknown as RendererApi
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { api, setTimeout, clearTimeout }
  })
  const renderPage = (dataRecoveryRequired: boolean): TestRenderer.ReactTestRenderer =>
    TestRenderer.create(
      <SettingsPage
        settings={DEFAULT_SETTINGS}
        onSettingsChange={() => undefined}
        onDataImported={() => undefined}
        getCurrentDataSnapshot={() => currentSnapshot}
        dataRecoveryRequired={dataRecoveryRequired}
      />
    )
  let renderer: TestRenderer.ReactTestRenderer | null = null
  try {
    TestRenderer.act(() => {
      renderer = renderPage(false)
    })
    assert.ok(renderer)
    await flush()
    TestRenderer.act(() => anyButtonByText(renderer!.root, '資料與系統').props.onClick())
    await flush()
    TestRenderer.act(() => buttonByText(renderer!.root, '匯出 JSON 備份').props.onClick())
    await flush()
    assert.deepEqual(exported[0], snapshotA, '匯出必須取得當下完整資料快照')
    assert.match(textContent(renderer.root), /資料已匯出：backup-a\.json/)
    currentSnapshot = snapshotB
    exportResult = { ok: false, cancelled: true }
    TestRenderer.act(() => buttonByText(renderer!.root, '匯出 JSON 備份').props.onClick())
    await flush()
    assert.deepEqual(exported[1], snapshotB, '取消匯出仍不得改寫輸入快照')
    currentSnapshot = snapshotC
    exportResult = { ok: false, message: '磁碟已滿' }
    TestRenderer.act(() => buttonByText(renderer!.root, '匯出 JSON 備份').props.onClick())
    await flush()
    assert.deepEqual(exported[2], snapshotC, '匯出失敗仍必須使用當下輸入快照')
    assert.match(textContent(renderer.root), /磁碟已滿/)
    renderer.unmount()
    renderer = null
    TestRenderer.act(() => {
      renderer = renderPage(true)
    })
    await flush()
    TestRenderer.act(() => anyButtonByText(renderer!.root, '資料與系統').props.onClick())
    await flush()
    const protectedExport = buttonByText(renderer!.root, '匯出 JSON 備份')
    assert.equal(protectedExport.props.disabled, true)
    TestRenderer.act(() => protectedExport.props.onClick())
    await flush()
    assert.equal(exported.length, 3, '資料復原保護狀態不得呼叫匯出 API')
    assert.match(textContent(renderer.root), /不能把空白保護資料當作完整備份/)
    console.log('SettingsPage 備份快照、取消／失敗與復原保護測試：通過')
  } finally {
    if (renderer) TestRenderer.act(() => renderer?.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

async function main(): Promise<void> {
  const requests: Array<{
    apiKey: string
    model?: string
    deferred: ReturnType<typeof deferred<AutoConfigureCredentialResult>>
  }> = []
  const api = {
    ai: {
      autoConfigureCredential: (apiKey: string, model?: string) => {
        const pending = deferred<AutoConfigureCredentialResult>()
        requests.push({ apiKey, model, deferred: pending })
        return pending.promise
      }
    },
    secret: {
      isAvailable: async () => true,
      status: async () => emptySecretStatus,
      delete: async () => ({ ok: true, status: emptySecretStatus })
    },
    engine: {
      listInstallations: async () => emptyEngineRegistry
    },
    license: {
      status: async () => ({ activated: false, message: 'not activated' })
    },
    update: {
      onChanged: () => () => undefined,
      status: async () => null
    }
  } as unknown as RendererApi

  const previousWindow = globalThis.window
  globalThis.window = {
    api,
    setTimeout,
    clearTimeout
  } as unknown as Window & typeof globalThis

  let renderer: TestRenderer.ReactTestRenderer | null = null
  try {
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        <SettingsPage
          settings={DEFAULT_SETTINGS}
          onSettingsChange={() => undefined}
          onDataImported={() => undefined}
          getCurrentDataSnapshot={() => ({
            schemaVersion: 2,
            savedPositions: [],
            conversations: [],
            userGuesses: []
          })}
          dataRecoveryRequired={false}
        />
      )
    })
    assert.ok(renderer)
    await flush()

    const statusRenderer = TestRenderer.create(
      <AiConnectionStatus stage="catalog" configured />
    )
    assert.match(textContent(statusRenderer.root.findByProps({ role: 'status' })), /驗證金鑰／讀取免費模型/)
    statusRenderer.unmount()

    const input = (): TestRenderer.ReactTestInstance =>
      renderer!.root.findByProps({ 'aria-label': 'AI API Key' })
    TestRenderer.act(() => input().props.onChange({ target: { value: 'sk-or-v1-test' } }))
    await flush()
    assert.equal(input().props.value, 'sk-or-v1-test')
    const connectButton = buttonByText(renderer!.root, '自动连线')
    assert.equal(typeof connectButton.props.onClick, 'function')
    assert.equal(typeof globalThis.window.api.ai.autoConfigureCredential, 'function')
    TestRenderer.act(() => connectButton.props.onClick())
    assert.equal(requests.length, 1)
    assert.equal(
      renderer.root.findAll((node) => node.props.role === 'status')[0]?.children.join(''),
      'AI 連線狀態：驗證金鑰／讀取免費模型'
    )

    TestRenderer.act(() => {
      requests[0]!.deferred.resolve({
        ok: true,
        configured: false,
        provider: 'openrouter',
        models,
        message: 'catalog ready'
      })
    })
    await flush()
    assert.equal(renderer.root.findByProps({ id: 'openrouter-free-model' }).props.value, models[0]!.id)
    assert.match(
      textContent(renderer.root.findAll((node) => node.props.role === 'status')[0]!),
      /等待選擇模型/
    )

    TestRenderer.act(() => buttonByText(renderer!.root, '验证并使用此模型').props.onClick())
    assert.equal(requests[1]?.model, models[0]!.id)
    TestRenderer.act(() => {
      requests[1]!.deferred.resolve({
        ok: false,
        message: '生成階段逾時',
        diagnostic: {
          stage: 'generation',
          category: 'timeout',
          retryable: true,
          message: '生成階段逾時'
        }
      })
    })
    await flush()
    assert.equal(
      renderer.root.findByProps({ id: 'openrouter-free-model' }).props.value,
      models[0]!.id,
      '暫時性生成失敗不得清空模型清單或目前選擇'
    )
    assert.match(textContent(renderer.root), /生成階段逾時/)

    TestRenderer.act(() => buttonByText(renderer!.root, '重新讀取免費模型').props.onClick())
    assert.equal(requests.length, 3)
    TestRenderer.act(() => {
      requests[2]!.deferred.resolve({
        ok: true,
        configured: false,
        provider: 'openrouter',
        models: [models[1]!],
        message: 'catalog refreshed'
      })
    })
    await flush()
    const modelSelect = renderer.root.findByProps({ id: 'openrouter-free-model' })
    assert.equal(
      modelSelect.props.value,
      models[0]!.id,
      '模型從目錄消失時必須保留原 ID，不能靜默換成第一個模型'
    )
    assert.match(textContent(renderer.root), /已不在最新清單，請重新選擇模型/)
    assert.equal(
      buttonByText(renderer!.root, '验证并使用此模型').props.disabled,
      true,
      '失效模型必須先由使用者重新選擇'
    )
    TestRenderer.act(() => modelSelect.props.onChange({ target: { value: models[1]!.id } }))
    assert.equal(buttonByText(renderer!.root, '验证并使用此模型').props.disabled, false)
    TestRenderer.act(() => buttonByText(renderer!.root, '验证并使用此模型').props.onClick())
    assert.equal(requests.length, 4)
    TestRenderer.act(() => {
      requests[3]!.deferred.resolve({
        ok: true,
        configured: true,
        credential: { provider: 'openrouter', model: models[1]!.id },
        status: {
          configured: true,
          needsReentry: false,
          activeCredential: { provider: 'openrouter', model: models[1]!.id },
          credentials: []
        },
        message: 'AI 已啟用'
      })
    })
    await flush()
    assert.equal(input().props.value, 'sk-or-v1-test', '設定儲存失敗時保留可重試的金鑰草稿')
    assert.equal(
      renderer.root.findByProps({ id: 'openrouter-free-model' }).props.value,
      models[1]!.id,
      '設定儲存失敗時保留模型選擇'
    )
    assert.match(textContent(renderer.root), /設定儲存失敗|保存/)
    assert.doesNotMatch(textContent(renderer.root), /AI 已啟用/)
    assert.match(
      textContent(renderer.root.findAll((node) => node.props.role === 'status')[0]!),
      /安全儲存中/
    )
    console.log('AI 連線狀態與失敗保留 UI 測試：通過')
  } finally {
    if (renderer) TestRenderer.act(() => renderer?.unmount())
    globalThis.window = previousWindow
  }
  await setupWizardFlow()
  await settingsBackupFlow()
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
