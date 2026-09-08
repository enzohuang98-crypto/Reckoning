import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
import type { AIModelInfo } from '../../../src/shared/types/AIProviderTypes'
import type { EngineRegistrySnapshot } from '../../../src/shared/types/EngineRegistry'
import type {
  AutoConfigureCredentialResult,
  RendererApi,
  SecretStatus
} from '../../../src/shared/types/ipc'
import { SettingsPage } from '../../../src/renderer/src/pages/SettingsPage'
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
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
