import { useState } from 'react'
import {
  AI_COMPATIBLE_PRESETS,
  ALL_PROVIDER_IDS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABEL,
  type AIProviderId
} from '@shared/types/AIProviderTypes'
import type { AppSettings } from '@shared/types/Settings'
import type {
  SecretCredentialMetadata,
  SecretCredentialRef,
  SecretStatus
} from '@shared/types/ipc'
import type { SettingsUpdater } from './types'

interface Props {
  settings: AppSettings
  update: SettingsUpdater
  apiKey: string
  onApiKeyChange: (value: string) => void
  secretStatus: SecretStatus
  encryptionAvailable: boolean | null
  onSaveKey: (credential: SecretCredentialRef) => void
  onActivateCredential: (credential: SecretCredentialRef) => void
  onUseLocalCredential: (credential: SecretCredentialRef) => void
  onDeleteKey: (credential?: SecretCredentialRef) => void
}

function credentialValue(credential: SecretCredentialRef): string {
  return JSON.stringify([
    credential.provider,
    credential.model,
    credential.baseUrl ?? ''
  ])
}

function sameCredential(
  left: SecretCredentialRef,
  right: SecretCredentialRef
): boolean {
  return credentialValue(left) === credentialValue(right)
}

function credentialLabel(credential: SecretCredentialRef): string {
  const catalog = PROVIDER_DEFAULT_MODELS[credential.provider].find(
    (model) => model.id === credential.model
  )
  const model = catalog?.label ?? credential.model
  const endpoint =
    credential.provider === 'openai-compatible' && credential.baseUrl
      ? ` · ${credential.baseUrl}`
      : ''
  return `${PROVIDER_LABEL[credential.provider]} · ${model}${endpoint}`
}

function settingsCredential(settings: AppSettings): SecretCredentialRef {
  return {
    provider: settings.aiProvider,
    model: settings.aiModel,
    ...(settings.aiProvider === 'openai-compatible'
      ? { baseUrl: settings.aiBaseUrl }
      : {})
  }
}

export function AiSettingsSection({
  settings,
  update,
  apiKey,
  onApiKeyChange,
  secretStatus,
  encryptionAvailable,
  onSaveKey,
  onActivateCredential,
  onUseLocalCredential,
  onDeleteKey
}: Props): JSX.Element {
  const [addProvider, setAddProvider] = useState<AIProviderId>(settings.aiProvider)
  const [addModel, setAddModel] = useState(settings.aiModel)
  const [addBaseUrl, setAddBaseUrl] = useState(settings.aiBaseUrl)

  const currentCredential = settingsCredential(settings)
  const localCompatibleWithoutKey =
    currentCredential.provider === 'openai-compatible' &&
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
      currentCredential.baseUrl ?? ''
    )
  const configuredCredentials = secretStatus.credentials.filter(
    (credential) => credential.configured
  )
  // This dropdown is deliberately credential-only. A loopback model that does
  // not need a key remains selectable from the separate setup controls below,
  // but must not masquerade as a saved API credential here.
  const selectableCredentials: SecretCredentialRef[] = configuredCredentials
  const activeValue = selectableCredentials.some((credential) =>
    sameCredential(credential, currentCredential)
  )
    ? credentialValue(currentCredential)
    : ''
  const currentMetadata = secretStatus.credentials.find((credential) =>
    sameCredential(credential, currentCredential)
  )
  const compatiblePreset =
    AI_COMPATIBLE_PRESETS.find(
      (preset) => preset.baseUrl && preset.baseUrl === addBaseUrl
    )?.id ?? 'custom'
  const draftCredential: SecretCredentialRef = {
    provider: addProvider,
    model: addModel,
    ...(addProvider === 'openai-compatible' ? { baseUrl: addBaseUrl } : {})
  }
  const draftIsLoopback =
    addProvider === 'openai-compatible' &&
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
      addBaseUrl
    )

  const changeAddProvider = (provider: AIProviderId): void => {
    const defaultModel =
      PROVIDER_DEFAULT_MODELS[provider].find((model) => model.isDefault) ??
      PROVIDER_DEFAULT_MODELS[provider][0]
    setAddProvider(provider)
    setAddModel(defaultModel.id)
    setAddBaseUrl(
      provider === 'openai-compatible'
        ? AI_COMPATIBLE_PRESETS.find((preset) => preset.id === 'ollama')
            ?.baseUrl ?? ''
        : ''
    )
  }

  const changeCompatiblePreset = (id: string): void => {
    const preset = AI_COMPATIBLE_PRESETS.find((item) => item.id === id)
    if (!preset) return
    setAddBaseUrl(preset.baseUrl)
    setAddModel(preset.suggestedModel)
  }

  const changeActiveCredential = (value: string): void => {
    const credential = selectableCredentials.find(
      (candidate) => credentialValue(candidate) === value
    )
    if (!credential) return
    onActivateCredential(credential)
  }

  const deleteApiKey = (): void => {
    if (!window.confirm('確定要刪除目前模型綁定的 AI API Key 嗎？其他模型的金鑰會保留。')) return
    onDeleteKey()
  }

  const deleteSpecificApiKey = (credential: SecretCredentialMetadata): void => {
    if (!window.confirm(`確定刪除 ${credentialLabel(credential)} 的 API Key 嗎？`)) return
    onDeleteKey(credential)
  }

  return (
    <div className="settings-section-grid">
      <section className="card settings-feature-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SECURE ACCESS</span>
            <h3>已設定的 AI 模型</h3>
          </div>
          <span
            className={`badge ${
              currentMetadata?.configured || localCompatibleWithoutKey
                ? 'on'
                : currentMetadata?.needsReentry
                  ? 'warn'
                  : 'off'
            }`}
          >
            {localCompatibleWithoutKey && !currentMetadata?.configured
              ? '本機免金鑰'
              : currentMetadata?.configured
                ? '已設定'
                : currentMetadata?.needsReentry
                  ? '需重新輸入'
                  : '未設定'}
          </span>
        </div>

        {encryptionAvailable === false && (
          <div className="error-text">
            此系統不支援安全加密儲存，程式會拒絕以明文保存金鑰。
          </div>
        )}

        <p className="muted">
          使用中的選單只列出已儲存且可解密的精確模型。新增其他模型時，必須另外儲存對應金鑰；
          程式不會把某個模型的金鑰自動套用到同供應商的其他模型。
        </p>

        <div className="field">
          <label className="field-label" htmlFor="active-ai-credential">
            使用中的 API 模型
          </label>
          <select
            id="active-ai-credential"
            aria-label="使用中的 API 模型"
            className="select"
            value={activeValue}
            disabled={selectableCredentials.length === 0}
            onChange={(event) => changeActiveCredential(event.target.value)}
          >
            {selectableCredentials.length === 0 && (
              <option value="">
                {localCompatibleWithoutKey
                  ? '目前使用本機免金鑰模型；尚無 API 模型'
                  : '請先在下方新增模型金鑰'}
              </option>
            )}
            {selectableCredentials.length > 0 && !activeValue && (
              <option value="">
                {localCompatibleWithoutKey
                  ? '目前使用本機免金鑰模型'
                  : '請選擇已設定的模型'}
              </option>
            )}
            {selectableCredentials.map((credential) => (
              <option
                key={credentialValue(credential)}
                value={credentialValue(credential)}
              >
                {credentialLabel(credential)}
              </option>
            ))}
          </select>
        </div>

        {currentMetadata?.needsReentry && (
          <div className="error-text">
            目前模型先前保存的金鑰已無法解密，需要在下方為同一模型重新貼上一次。
          </div>
        )}

        {(currentMetadata?.configured || currentMetadata?.needsReentry) && (
          <button className="btn danger" onClick={deleteApiKey}>
            刪除目前模型金鑰
          </button>
        )}

        {secretStatus.credentials.length > 0 && (
          <div className="key-row">
            <div className="key-head"><b>本機保存的模型</b></div>
            {secretStatus.credentials.map((credential) => (
              <div className="row gap" key={credentialValue(credential)}>
                <span>
                  {credentialLabel(credential)}
                  {credential.needsReentry ? '（需重新輸入）' : ''}
                </span>
                <button
                  className="btn danger"
                  onClick={() => deleteSpecificApiKey(credential)}
                >
                  刪除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ADD CREDENTIAL</span>
            <h3>新增或更新模型金鑰</h3>
          </div>
        </div>

        <div className="field">
          <label className="field-label">Provider</label>
          <select
            className="select"
            value={addProvider}
            onChange={(event) =>
              changeAddProvider(event.target.value as AIProviderId)
            }
          >
            {ALL_PROVIDER_IDS.map((provider) => (
              <option value={provider} key={provider}>
                {PROVIDER_LABEL[provider]}
              </option>
            ))}
          </select>
        </div>

        {addProvider === 'openai-compatible' ? (
          <>
            <div className="field">
              <label className="field-label">相容服務</label>
              <select
                className="select"
                value={compatiblePreset}
                onChange={(event) => changeCompatiblePreset(event.target.value)}
              >
                {AI_COMPATIBLE_PRESETS.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Base URL</label>
              <input
                className="text-input"
                value={addBaseUrl}
                placeholder="https://服務網址/v1 或 http://127.0.0.1:連接埠/v1"
                onChange={(event) => setAddBaseUrl(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">模型 ID</label>
              <input
                className="text-input"
                value={addModel}
                onChange={(event) => setAddModel(event.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label className="field-label">要綁定的模型</label>
            <select
              aria-label="要新增金鑰的模型"
              className="select"
              value={addModel}
              onChange={(event) => setAddModel(event.target.value)}
            >
              {PROVIDER_DEFAULT_MODELS[addProvider].map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}{model.isDefault ? '（預設）' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="settings-key-input">
          <input
            className="text-input"
            type="password"
            placeholder={
              addProvider === 'openai-compatible'
                ? '貼上服務金鑰；本機 Ollama / LM Studio 可留空'
                : `貼上 ${credentialLabel(draftCredential)} 的 API Key`
            }
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
          <button
            className="btn"
            onClick={() => onSaveKey(draftCredential)}
            disabled={!apiKey.trim()}
          >
            儲存並使用
          </button>
          {draftIsLoopback && !apiKey.trim() && (
            <button
              className="btn"
              onClick={() => onUseLocalCredential(draftCredential)}
            >
              使用本機免金鑰模型
            </button>
          )}
        </div>

        <div className="field">
          <label className="field-label">你的棋力（影響解說深淺）</label>
          <select
            className="select"
            value={settings.userLevel}
            onChange={(event) =>
              update({ userLevel: event.target.value as AppSettings['userLevel'] })
            }
          >
            <option value="basic">初學</option>
            <option value="intermediate">中級</option>
            <option value="advanced">進階</option>
          </select>
        </div>

        <div className="field">
          <label className="field-label">解說語言</label>
          <select
            className="select"
            value={settings.language}
            onChange={(event) =>
              update({ language: event.target.value as AppSettings['language'] })
            }
          >
            <option value="zh-TW">繁體中文</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>
    </div>
  )
}
