import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import {
  DEFAULT_SETTINGS,
  type AppSettings
} from '../../../src/shared/types/Settings'
import type { SecretStatus } from '../../../src/shared/types/ipc'
import { AiSettingsSection } from '../../../src/renderer/src/features/settings/AiSettingsSection'
import { SetupWizard } from '../../../src/renderer/src/pages/SetupWizard'

function render(
  status: SecretStatus,
  settings: Partial<AppSettings> = {},
  onDeleteKey: () => void = () => undefined
): TestRenderer.ReactTestRenderer {
  return TestRenderer.create(
    <AiSettingsSection
      settings={{
        ...DEFAULT_SETTINGS,
        aiProvider: 'gemini',
        aiModel: 'gemini-3.5-flash',
        ...settings
      }}
      update={() => undefined}
      apiKey=""
      onApiKeyChange={() => undefined}
      secretStatus={status}
      encryptionAvailable
      secretBusy={false}
      testingCredentialKey={null}
      testResults={{}}
      onSaveKey={() => undefined}
      onActivateCredential={() => undefined}
      onUseLocalCredential={() => undefined}
      onDeleteKey={onDeleteKey}
      onTestKey={() => undefined}
    />
  )
}

function activeOptions(
  renderer: TestRenderer.ReactTestRenderer
): TestRenderer.ReactTestInstance[] {
  const select = renderer.root.find(
    (node) => node.type === 'select' && node.props['aria-label'] === '使用中的 API 模型'
  )
  return select.findAllByType('option')
}

const onlyFlash = render({
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
})
assert.equal(activeOptions(onlyFlash).length, 1)
assert.match(String(activeOptions(onlyFlash)[0].children.join('')), /Gemini 3\.5 Flash/)
assert.doesNotMatch(
  activeOptions(onlyFlash).map((option) => option.children.join('')).join(' '),
  /3\.1 Pro/,
  '只有 3.5 Flash key 時，使用中選單不得出現 3.1 Pro'
)

const claudeAndGemini = render({
  configured: true,
  needsReentry: false,
  activeCredential: { provider: 'gemini', model: 'gemini-3.5-flash' },
  credentials: [
    {
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      configured: true,
      needsReentry: false
    },
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      configured: true,
      needsReentry: false
    },
    {
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      configured: false,
      needsReentry: true
    }
  ]
})
const labels = activeOptions(claudeAndGemini).map((option) =>
  option.children.join('')
)
assert.equal(labels.length, 2)
assert(labels.some((label) => /Gemini 3\.5 Flash/.test(label)))
assert(labels.some((label) => /Claude Sonnet 4\.6/.test(label)))
assert(labels.every((label) => !/3\.1 Pro/.test(label)))

const localWithoutKey = render(
  {
    configured: false,
    needsReentry: false,
    activeCredential: null,
    credentials: []
  },
  {
    aiProvider: 'openai-compatible',
    aiModel: 'local-model',
    aiBaseUrl: 'http://127.0.0.1:11434/v1'
  }
)
const localOptions = activeOptions(localWithoutKey)
assert.equal(
  localOptions.filter((option) => option.props.value !== '').length,
  0,
  '本機免金鑰模型不得混入使用中的 API credential 選單'
)
assert.match(localOptions[0].children.join(''), /本機免金鑰模型/)

const twoCompatibleEndpoints = render(
  {
    configured: true,
    needsReentry: false,
    activeCredential: {
      provider: 'openai-compatible',
      model: 'local-model',
      baseUrl: 'https://one.example/v1'
    },
    credentials: [
      {
        provider: 'openai-compatible',
        model: 'local-model',
        baseUrl: 'https://one.example/v1',
        configured: true,
        needsReentry: false
      },
      {
        provider: 'openai-compatible',
        model: 'local-model',
        baseUrl: 'https://two.example/v1',
        configured: true,
        needsReentry: false
      }
    ]
  },
  {
    aiProvider: 'openai-compatible',
    aiModel: 'local-model',
    aiBaseUrl: 'https://one.example/v1'
  }
)
const compatibleLabels = activeOptions(twoCompatibleEndpoints).map((option) =>
  option.children.join('')
)
assert.equal(compatibleLabels.length, 2)
assert(compatibleLabels.some((label) => label.includes('https://one.example/v1')))
assert(compatibleLabels.some((label) => label.includes('https://two.example/v1')))

const addModelSelect = onlyFlash.root.find(
  (node) => node.type === 'select' && node.props['aria-label'] === '要新增金鑰的模型'
)
assert(
  addModelSelect.findAllByType('option').some((option) =>
    /3\.1 Pro/.test(option.children.join(''))
  ),
  '新增金鑰區仍可從 catalog 選擇另一個模型'
)
assert(
  addModelSelect.findAllByType('option').some(
    (option) => option.props.value === '__custom_model_id__'
  ),
  '官方供應商必須能輸入新開放的自訂 model ID'
)

let deleteCalls = 0
const inlineDelete = render(
  {
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
  {},
  () => {
    deleteCalls++
  }
)
const firstDelete = inlineDelete.root.findAllByType('button').find(
  (button) => button.children.join('') === '刪除目前模型金鑰'
)
assert(firstDelete)
TestRenderer.act(() => firstDelete.props.onClick())
assert.equal(deleteCalls, 0, '第一次按下只在頁內要求確認，不得直接刪除')
const confirmedDelete = inlineDelete.root.findAllByType('button').find(
  (button) => button.children.join('') === '再次按下確認刪除'
)
assert(confirmedDelete)
TestRenderer.act(() => confirmedDelete.props.onClick())
assert.equal(deleteCalls, 1, '第二次按下才刪除，不使用阻塞式 window.confirm')

const wizard = TestRenderer.create(
  <SetupWizard
    settings={DEFAULT_SETTINGS}
    onSettingsChange={() => undefined}
    onComplete={() => undefined}
  />
)
const wizardProvider = wizard.root.find(
  (node) =>
    node.type === 'select' &&
    node.props['aria-label'] === '初始設定 API Provider'
)
TestRenderer.act(() => {
  wizardProvider.props.onChange({ target: { value: 'gemini' } })
})
const wizardModel = wizard.root.find(
  (node) =>
    node.type === 'select' && node.props['aria-label'] === '初始設定 API 模型'
)
assert.equal(wizardModel.props.value, 'gemini-3.5-flash')
assert(
  wizardModel.findAllByType('option').some(
    (option) => option.props.value === 'gemini-3.1-pro-preview'
  ),
  'SetupWizard 必須先讓使用者選定 provider + model，再綁定 key'
)

console.log('API 模型選單精確綁定測試：通過')
