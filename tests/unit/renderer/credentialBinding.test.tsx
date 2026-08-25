import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
import type { SecretStatus } from '../../../src/shared/types/ipc'
import { AiSettingsSection } from '../../../src/renderer/src/features/settings/AiSettingsSection'
import { SetupWizard } from '../../../src/renderer/src/pages/SetupWizard'

function render(options: {
  status?: SecretStatus
  apiKey?: string
  encryptionAvailable?: boolean
  onConnectKey?: () => void
  onDeleteKey?: () => void
} = {}): TestRenderer.ReactTestRenderer {
  return TestRenderer.create(
    <AiSettingsSection
      settings={DEFAULT_SETTINGS}
      update={() => undefined}
      apiKey={options.apiKey ?? ''}
      onApiKeyChange={() => undefined}
      secretStatus={options.status ?? {
        configured: false,
        needsReentry: false,
        activeCredential: null,
        credentials: []
      }}
      encryptionAvailable={options.encryptionAvailable ?? true}
      secretBusy={false}
      onConnectKey={options.onConnectKey ?? (() => undefined)}
      onDeleteKey={options.onDeleteKey ?? (() => undefined)}
    />
  )
}

const empty = render()
assert.equal(
  empty.root.findAll(
    (node) => node.type === 'select' && /Provider|模型/.test(node.props['aria-label'] ?? '')
  ).length,
  0,
  'AI 设定不得再要求选择 Provider 或绑定模型'
)
assert.equal(
  empty.root.findAll(
    (node) => node.type === 'input' && node.props['aria-label'] === 'AI API Key'
  ).length,
  1,
  'AI 设定只保留一个 API Key 栏位'
)

let connectCalls = 0
const connectable = render({
  apiKey: 'sk-example',
  onConnectKey: () => {
    connectCalls++
  }
})
const connect = connectable.root.findAllByType('button').find(
  (button) => button.children.join('') === '自动连线'
)
assert(connect)
TestRenderer.act(() => connect.props.onClick())
assert.equal(connectCalls, 1)

const noEncryption = render({ apiKey: 'sk-example', encryptionAvailable: false })
assert.equal(
  noEncryption.root.find(
    (node) => node.type === 'input' && node.props['aria-label'] === 'AI API Key'
  ).props.disabled,
  true,
  '没有 safeStorage 时不得接受明文金钥匙'
)

let deleteCalls = 0
const configured = render({
  status: {
    configured: true,
    needsReentry: false,
    activeCredential: { provider: 'gemini', model: 'gemini-3.5-flash' },
    credentials: [
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        configured: true,
        needsReentry: false
      }
    ]
  },
  onDeleteKey: () => {
    deleteCalls++
  }
})
assert.match(
  configured.root.findAllByType('span').map((node) => node.children.join('')).join(' '),
  /Google Gemini · gemini-3\.5-flash/
)
const firstDelete = configured.root.findAllByType('button').find(
  (button) => button.children.join('') === '删除金钥匙'
)
assert(firstDelete)
TestRenderer.act(() => firstDelete.props.onClick())
assert.equal(deleteCalls, 0)
const confirmedDelete = configured.root.findAllByType('button').find(
  (button) => button.children.join('') === '再次按下确认删除'
)
assert(confirmedDelete)
TestRenderer.act(() => confirmedDelete.props.onClick())
assert.equal(deleteCalls, 1)

const wizard = TestRenderer.create(
  <SetupWizard
    settings={DEFAULT_SETTINGS}
    onSettingsChange={() => undefined}
    onComplete={() => undefined}
  />
)
assert.equal(
  wizard.root.findAll(
    (node) => node.type === 'select' && /Provider|API 模型/.test(node.props['aria-label'] ?? '')
  ).length,
  0,
  '初始设定也不得出现 Provider／模型选择'
)
assert.equal(
  wizard.root.findAll(
    (node) =>
      node.type === 'input' &&
      typeof node.props.placeholder === 'string' &&
      node.props.placeholder.includes('OpenAI、Anthropic 或 Gemini')
  ).length,
  1
)

console.log('单一 API Key 自动连线 UI 测试：通过')
