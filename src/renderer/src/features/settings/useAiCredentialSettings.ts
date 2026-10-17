/**
 * 設定頁「AI」分類的狀態與 IPC。
 *
 * API Key 永遠走 SecretStore，絕不寫入 renderer 的 localStorage；
 * 輸入框中的金鑰只是草稿，連線成功後立即清空，已存金鑰永遠讀不回明文。
 */

import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '@shared/types/Settings'
import type { AIModelInfo } from '@shared/types/AIProviderTypes'
import type { SecretCredentialRef, SecretStatus } from '@shared/types/ipc'
import type { AiConnectionStage } from './AiConnectionStatus'
import { saveSettings } from '../../storage/localSettings'
import { withTimeout } from '../../utils/withTimeout'

const SECRET_OPERATION_TIMEOUT_MS = 10_000
const AI_CONNECT_TIMEOUT_MS = 45_000
const AI_RECONCILE_TIMEOUT_MS = 10_000
const SECRET_TIMEOUT_MESSAGE = '操作逾時，請確認磁碟權限或重試。'

const EMPTY_SECRET_STATUS: SecretStatus = {
  configured: false,
  needsReentry: false,
  activeCredential: null,
  credentials: []
}

interface Options {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  update: (patch: Partial<AppSettings>) => boolean
  setOperationError: (message: string | null) => void
  setSavedMessage: (message: string | null) => void
}

export interface AiCredentialSettings {
  apiKey: string
  secretStatus: SecretStatus
  encryptionAvailable: boolean | null
  secretBusy: boolean
  openRouterModels: AIModelInfo[]
  selectedOpenRouterModel: string
  savedModelsLoaded: boolean
  savedModelsError: string | null
  backupModels: string[]
  setBackupModels: (models: string[]) => void
  connectionStage: AiConnectionStage
  /** 開啟設定頁時查詢加密可用性與 API Key 狀態。 */
  loadSecretStatus: () => void
  /** 開啟設定頁時讀取已保存的 OpenRouter 備援模型。 */
  loadBackupModels: () => void
  changeApiKey: (value: string) => void
  changeOpenRouterModel: (model: string) => void
  connectKey: (refreshModels?: boolean) => Promise<void>
  loadSavedModels: () => Promise<void>
  switchSavedModel: () => Promise<void>
  saveBackupModels: () => Promise<void>
  deleteKey: () => Promise<void>
}

export function useAiCredentialSettings({
  settings,
  onSettingsChange,
  update,
  setOperationError,
  setSavedMessage
}: Options): AiCredentialSettings {
  const [apiKey, setApiKey] = useState('')
  const [openRouterModels, setOpenRouterModels] = useState<AIModelInfo[]>([])
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState('')
  const [savedModelsLoaded, setSavedModelsLoaded] = useState(false)
  const [savedModelsError, setSavedModelsError] = useState<string | null>(null)
  const [backupModels, setBackupModels] = useState<string[]>([])
  const [connectionStage, setConnectionStage] = useState<AiConnectionStage>('idle')
  const [secretStatus, setSecretStatus] = useState<SecretStatus>(EMPTY_SECRET_STATUS)
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null)
  const [secretBusy, setSecretBusy] = useState(false)
  const connectAttemptRef = useRef(0)
  const savedModelAttemptRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      connectAttemptRef.current += 1
      savedModelAttemptRef.current += 1
    }
  }, [])

  const loadSecretStatus = (): void => {
    withTimeout(
      window.api.secret.isAvailable(),
      SECRET_OPERATION_TIMEOUT_MS,
      SECRET_TIMEOUT_MESSAGE
    )
      .then(setEncryptionAvailable)
      .catch(() => setEncryptionAvailable(false))
    withTimeout(
      window.api.secret.status(),
      SECRET_OPERATION_TIMEOUT_MS,
      SECRET_TIMEOUT_MESSAGE
    )
      .then((status) => {
        setSecretStatus(status)
        if (status.activeCredential?.provider === 'openrouter') {
          setSelectedOpenRouterModel(status.activeCredential.model)
        }
      })
      .catch(() => setOperationError('無法查詢 API Key 狀態。'))
  }

  const loadBackupModels = (): void => {
    // 舊版 preload 或測試替身可能沒有這個通道；讀不到就維持空白，不影響其他設定。
    window.api.ai?.getOpenRouterBackupModels?.()
      ?.then((result) => {
        if (result.ok && mountedRef.current) setBackupModels(result.models)
      })
      .catch(() => undefined)
  }

  const useCredential = (credential: SecretCredentialRef): boolean => {
    return update({
      aiProvider: credential.provider,
      aiModel: credential.model,
      aiBaseUrl:
        credential.provider === 'openai-compatible'
          ? credential.baseUrl ?? ''
          : ''
    })
  }

  const mirrorActiveCredential = (credential: SecretCredentialRef): boolean => {
    const next = {
      ...settings,
      aiProvider: credential.provider,
      aiModel: credential.model,
      aiBaseUrl:
        credential.provider === 'openai-compatible'
          ? credential.baseUrl ?? ''
          : ''
    }
    const saved = saveSettings(next)
    // main active 是真實來源；即使 localStorage 失敗，記憶體鏡像也必須立即同步，
    // 避免下一次生成仍送出舊模型。
    onSettingsChange(next)
    if (!saved.ok) {
      setOperationError(
        `${saved.message ?? '設定儲存失敗。'} 已依目前使用中的憑證修正本次執行設定；請稍後重試儲存。`
      )
      return false
    }
    setOperationError(null)
    return true
  }

  const loadSavedModels = async (): Promise<void> => {
    const source = secretStatus.activeCredential
    if (source?.provider !== 'openrouter') return
    const attempt = ++savedModelAttemptRef.current
    setSecretBusy(true)
    setConnectionStage('catalog')
    setSavedModelsError(null)
    try {
      const result = await withTimeout(
        window.api.ai.listSavedOpenRouterModels({ sourceCredential: source }),
        AI_CONNECT_TIMEOUT_MS,
        'OpenRouter 模型清單讀取逾時，請稍後重試。'
      )
      if (!mountedRef.current || savedModelAttemptRef.current !== attempt) return
      setSavedModelsLoaded(true)
      if (!result.ok) {
        setSavedModelsError(result.message)
        setConnectionStage('enabled')
        return
      }
      setSecretStatus(result.status)
      const currentModel = selectedOpenRouterModel || source.model
      setOpenRouterModels(result.models)
      setSelectedOpenRouterModel(currentModel)
      setConnectionStage('awaiting-model')
    } catch (error) {
      if (!mountedRef.current || savedModelAttemptRef.current !== attempt) return
      setSavedModelsLoaded(true)
      setSavedModelsError(
        error instanceof Error ? error.message : 'OpenRouter 模型清單讀取失敗。'
      )
      setConnectionStage('enabled')
    } finally {
      if (mountedRef.current && savedModelAttemptRef.current === attempt) {
        setSecretBusy(false)
      }
    }
  }

  const applySavedSwitchResult = async (
    result: Awaited<ReturnType<typeof window.api.ai.switchSavedOpenRouterModel>>,
    attempt: number
  ): Promise<void> => {
    if (!mountedRef.current || savedModelAttemptRef.current !== attempt) return
    if (!result.ok) {
      setOperationError(result.message)
      setConnectionStage('awaiting-model')
      return
    }
    setSecretStatus(result.status)
    setSelectedOpenRouterModel(result.credential.model)
    const saved = mirrorActiveCredential(result.credential)
    setConnectionStage('enabled')
    setSavedMessage(saved ? result.message : null)
  }

  const switchSavedModel = async (): Promise<void> => {
    const source = secretStatus.activeCredential
    if (
      source?.provider !== 'openrouter' ||
      !openRouterModels.some((model) => model.id === selectedOpenRouterModel)
    ) return
    const attempt = ++savedModelAttemptRef.current
    const input = {
      sourceCredential: source,
      targetModel: selectedOpenRouterModel,
      operationId: crypto.randomUUID()
    }
    setSecretBusy(true)
    setConnectionStage('generation')
    setOperationError(null)
    try {
      const result = await withTimeout(
        window.api.ai.switchSavedOpenRouterModel(input),
        AI_CONNECT_TIMEOUT_MS,
        'OpenRouter 模型切換逾時，正在對帳目前使用中的模型。'
      )
      await applySavedSwitchResult(result, attempt)
    } catch (error) {
      if (!mountedRef.current || savedModelAttemptRef.current !== attempt) return
      const status = await withTimeout(
        window.api.secret.status(),
        AI_RECONCILE_TIMEOUT_MS,
        'API Key 狀態對帳逾時。'
      ).catch(() => null)
      if (!mountedRef.current || savedModelAttemptRef.current !== attempt) return
      if (
        status?.activeCredential?.provider === 'openrouter' &&
        status.activeCredential.model === selectedOpenRouterModel
      ) {
        setSecretStatus(status)
        mirrorActiveCredential(status.activeCredential)
        setConnectionStage('enabled')
        setSavedMessage(`已改用 ${selectedOpenRouterModel}。`)
        return
      }
      try {
        // 同 operationId 會接回 main 的同一個 bounded operation，不會重送驗證。
        const reconciled = await withTimeout(
          window.api.ai.switchSavedOpenRouterModel(input),
          AI_RECONCILE_TIMEOUT_MS,
          'OpenRouter 模型切換仍在處理；請稍後重新整理設定確認。'
        )
        await applySavedSwitchResult(reconciled, attempt)
      } catch {
        if (!mountedRef.current || savedModelAttemptRef.current !== attempt) return
        if (status) {
          setSecretStatus(status)
          if (status.activeCredential) mirrorActiveCredential(status.activeCredential)
        }
        setOperationError(
          error instanceof Error ? error.message : 'OpenRouter 模型切換失敗。'
        )
        setConnectionStage('enabled')
      }
    } finally {
      if (mountedRef.current && savedModelAttemptRef.current === attempt) {
        setSecretBusy(false)
      }
    }
  }

  const saveBackupModels = async (): Promise<void> => {
    const source = secretStatus.activeCredential
    if (source?.provider !== 'openrouter') return
    setSecretBusy(true)
    setOperationError(null)
    try {
      const result = await withTimeout(
        window.api.ai.setOpenRouterBackupModels({
          sourceCredential: source,
          models: backupModels
        }),
        AI_CONNECT_TIMEOUT_MS,
        '備援模型儲存逾時，請稍後重試。'
      )
      if (!mountedRef.current) return
      if (!result.ok) {
        setOperationError(result.message)
        return
      }
      setBackupModels(result.models)
      setSavedMessage(
        result.models.length > 0
          ? `已儲存備援模型：${result.models.join('、')}。`
          : '已停用備援模型。'
      )
    } catch (error) {
      if (!mountedRef.current) return
      setOperationError(error instanceof Error ? error.message : '備援模型儲存失敗。')
    } finally {
      if (mountedRef.current) setSecretBusy(false)
    }
  }

  const connectionStageForFailure = (): AiConnectionStage =>
    openRouterModels.length > 0 ? 'awaiting-model' : 'idle'

  const connectKey = async (refreshModels = false): Promise<void> => {
    const key = apiKey.trim()
    if (!key) return
    const attempt = ++connectAttemptRef.current
    const requestedModel = refreshModels
      ? undefined
      : selectedOpenRouterModel || undefined
    setSecretBusy(true)
    setConnectionStage(requestedModel ? 'generation' : 'catalog')
    try {
      const result = await withTimeout(
        window.api.ai.autoConfigureCredential(key, requestedModel),
        AI_CONNECT_TIMEOUT_MS,
        'AI 連線逾時，請檢查網路後重試。'
      )
      if (!mountedRef.current || connectAttemptRef.current !== attempt) return
      if (!result.ok) {
        setConnectionStage(connectionStageForFailure())
        setOperationError(result.message)
        return
      }
      if (!result.configured) {
        const previousModel = selectedOpenRouterModel
        const previousModelUnavailable =
          previousModel !== '' && !result.models.some((model) => model.id === previousModel)
        setOpenRouterModels(result.models)
        if (!previousModel) setSelectedOpenRouterModel(result.models[0]?.id ?? '')
        setConnectionStage('awaiting-model')
        setSavedMessage(result.message)
        setOperationError(
          previousModelUnavailable
            ? '目前選擇的模型已不在最新清單，請重新選擇模型。'
            : null
        )
        return
      }
      setConnectionStage('storage')
      const settingsSaved = useCredential(result.credential)
      setSecretStatus(result.status)
      if (!settingsSaved) {
        setSavedMessage(null)
        return
      }
      setApiKey('')
      setOpenRouterModels([])
      setSelectedOpenRouterModel(result.credential.model)
      setSavedModelsLoaded(false)
      setSavedModelsError(null)
      setConnectionStage('enabled')
      setSavedMessage(result.message)
    } catch (error) {
      if (!mountedRef.current || connectAttemptRef.current !== attempt) return
      setConnectionStage(connectionStageForFailure())
      setOperationError(
        error instanceof Error
          ? error.message
          : '無法完成 AI 連線。'
      )
    } finally {
      if (mountedRef.current && connectAttemptRef.current === attempt) {
        setSecretBusy(false)
      }
    }
  }

  const deleteKey = async (): Promise<void> => {
    const credential = secretStatus.activeCredential
    if (!credential) return
    setSecretBusy(true)
    try {
      const result = await withTimeout(
        window.api.secret.delete(credential),
        SECRET_OPERATION_TIMEOUT_MS,
        SECRET_TIMEOUT_MESSAGE
      )
      setSecretStatus(result.status)
      if (result.status.activeCredential) {
        useCredential(result.status.activeCredential)
      }
      setSavedMessage('AI API 金鑰已從本機刪除。')
      setOperationError(null)
    } catch (error) {
      setOperationError(
        error instanceof Error && error.message === SECRET_TIMEOUT_MESSAGE
          ? error.message
          : 'API Key 刪除失敗，請稍後重試。'
      )
    } finally {
      setSecretBusy(false)
    }
  }

  const changeApiKey = (value: string): void => {
    connectAttemptRef.current += 1
    setApiKey(value)
    if (value.trim()) {
      setOpenRouterModels([])
      setSavedModelsLoaded(false)
      setSavedModelsError(null)
    } else if (secretStatus.activeCredential?.provider === 'openrouter') {
      setSelectedOpenRouterModel(secretStatus.activeCredential.model)
    }
    setConnectionStage('idle')
  }

  const changeOpenRouterModel = (model: string): void => {
    setSelectedOpenRouterModel(model)
    setOperationError(null)
  }

  return {
    apiKey,
    secretStatus,
    encryptionAvailable,
    secretBusy,
    openRouterModels,
    selectedOpenRouterModel,
    savedModelsLoaded,
    savedModelsError,
    backupModels,
    setBackupModels,
    connectionStage,
    loadSecretStatus,
    loadBackupModels,
    changeApiKey,
    changeOpenRouterModel,
    connectKey,
    loadSavedModels,
    switchSavedModel,
    saveBackupModels,
    deleteKey
  }
}
