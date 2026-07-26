/**
 * 設定頁控制器。
 *
 * UI 依領域拆到 features/settings；此檔只管理 IPC、狀態與持久化。
 * API Key 永遠走 SecretStore，絕不寫入 renderer 的 localStorage。
 */

import { useEffect, useState } from 'react'
import { PROVIDER_LABEL } from '@shared/types/AIProviderTypes'
import type { AppDataSnapshot } from '@shared/types/AppData'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import {
  type EngineProfileId,
  type EngineRegistrySnapshot
} from '@shared/types/EngineRegistry'
import type { LicenseStatus } from '@shared/types/License'
import type { AppSettings } from '@shared/types/Settings'
import type {
  EngineTestResult,
  SecretCredentialRef,
  SecretStatus,
  TestCredentialResult
} from '@shared/types/ipc'
import { LICENSE_GATE_DISABLED } from '../app/productFlags'
import { AiSettingsSection, credentialValue } from '../features/settings/AiSettingsSection'
import { EngineSettingsSection } from '../features/settings/EngineSettingsSection'
import { HarnessSettingsSection } from '../features/settings/HarnessSettingsSection'
import { SettingsNavigation } from '../features/settings/SettingsNavigation'
import { SystemSettingsSection } from '../features/settings/SystemSettingsSection'
import type { SettingsCategory } from '../features/settings/types'
import { saveSettings } from '../storage/localSettings'
import { withTimeout } from '../utils/withTimeout'

const SECRET_OPERATION_TIMEOUT_MS = 10_000
const SECRET_TIMEOUT_MESSAGE = '操作逾時，請確認磁碟權限或重試。'

interface Props {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  onDataImported: (snapshot: AppDataSnapshot) => void
}

const EMPTY_SECRET_STATUS: SecretStatus = {
  configured: false,
  needsReentry: false,
  activeCredential: null,
  credentials: []
}

const EMPTY_ENGINE_REGISTRY: EngineRegistrySnapshot = {
  installations: [],
  activeEngineId: null,
  verificationEngineId: null
}

export function SettingsPage({
  settings,
  onSettingsChange,
  onDataImported
}: Props): JSX.Element {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('ai')
  const [apiKey, setApiKey] = useState('')
  const [secretStatus, setSecretStatus] = useState<SecretStatus>(EMPTY_SECRET_STATUS)
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [secretBusy, setSecretBusy] = useState(false)
  const [testingCredentialKey, setTestingCredentialKey] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestCredentialResult>>({})
  const [engineTest, setEngineTest] = useState<EngineTestResult | null>(null)
  const [engineMessage, setEngineMessage] = useState<string | null>(null)
  const [engineRegistry, setEngineRegistry] =
    useState<EngineRegistrySnapshot>(EMPTY_ENGINE_REGISTRY)
  const [newEngineProfile, setNewEngineProfile] = useState<EngineProfileId>('pikafish')
  const [newEngineName, setNewEngineName] = useState('')
  const [newEnginePath, setNewEnginePath] = useState('')
  const [newEngineSelectionToken, setNewEngineSelectionToken] =
    useState<string | null>(null)
  const [testingEngineId, setTestingEngineId] = useState<string | null>(null)
  const [traceCount, setTraceCount] = useState(0)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [license, setLicense] = useState<LicenseStatus | null>(null)

  const refreshEngine = async (): Promise<void> => {
    try {
      setEngineRegistry(await window.api.engine.listInstallations())
      setOperationError(null)
    } catch {
      setOperationError('無法查詢引擎狀態。')
    }
  }

  useEffect(() => {
    const unsubscribeUpdate = window.api.update.onChanged(setUpdateStatus)
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
      .then(setSecretStatus)
      .catch(() => setOperationError('無法查詢 API Key 狀態。'))
    void refreshEngine()
    window.api.license.status().then(setLicense).catch(() => setLicense(null))
    window.api.update.status().then(setUpdateStatus).catch(() => setUpdateStatus(null))
    window.api.ai
      .listHarnessTraces()
      .then((traces) => setTraceCount(traces.length))
      .catch(() => setTraceCount(0))
    return unsubscribeUpdate
  }, [])

  useEffect(() => {
    if (!operationError) return
    setSavedMessage(null)
  }, [operationError])

  useEffect(() => {
    if (!savedMessage) return
    const timer = window.setTimeout(() => setSavedMessage(null), 10_000)
    return () => window.clearTimeout(timer)
  }, [savedMessage])

  const update = (patch: Partial<AppSettings>): void => {
    const next = { ...settings, ...patch }
    onSettingsChange(next)
    const saved = saveSettings(next)
    if (!saved.ok) setOperationError(saved.message ?? '設定儲存失敗。')
    else setOperationError(null)
  }

  const useCredential = (credential: SecretCredentialRef): void => {
    update({
      aiProvider: credential.provider,
      aiModel: credential.model,
      aiBaseUrl:
        credential.provider === 'openai-compatible'
          ? credential.baseUrl ?? ''
          : ''
    })
  }

  const saveKey = async (
    credential: SecretCredentialRef
  ): Promise<void> => {
    const key = apiKey.trim()
    if (!key) return
    setSecretBusy(true)
    try {
      const result = await withTimeout(
        window.api.secret.set({ ...credential, apiKey: key }),
        SECRET_OPERATION_TIMEOUT_MS,
        SECRET_TIMEOUT_MESSAGE
      )
      useCredential(result.status.activeCredential ?? credential)
      setApiKey('')
      setSecretStatus(result.status)
      setTestResults((previous) => {
        const next = { ...previous }
        delete next[credentialValue(credential)]
        return next
      })
      setSavedMessage(
        `${PROVIDER_LABEL[credential.provider]} · ${credential.model} 金鑰已安全儲存並設為使用中。`
      )
      setOperationError(null)
    } catch (error) {
      setOperationError(
        error instanceof Error && error.message === SECRET_TIMEOUT_MESSAGE
          ? error.message
          : '無法安全儲存 API Key。請確認已選正確服務，且金鑰不含換行或控制字元。'
      )
    } finally {
      setSecretBusy(false)
    }
  }

  const activateCredential = async (
    credential: SecretCredentialRef
  ): Promise<void> => {
    setSecretBusy(true)
    try {
      const result = await withTimeout(
        window.api.secret.activate(credential),
        SECRET_OPERATION_TIMEOUT_MS,
        SECRET_TIMEOUT_MESSAGE
      )
      setSecretStatus(result.status)
      useCredential(credential)
      setOperationError(null)
    } catch (error) {
      setOperationError(
        error instanceof Error && error.message === SECRET_TIMEOUT_MESSAGE
          ? error.message
          : '所選模型的 API Key 不存在或已無法解密。'
      )
    } finally {
      setSecretBusy(false)
    }
  }

  const deleteKey = async (
    credential: SecretCredentialRef = {
      provider: settings.aiProvider,
      model: settings.aiModel,
      ...(settings.aiProvider === 'openai-compatible'
        ? { baseUrl: settings.aiBaseUrl }
        : {})
    }
  ): Promise<void> => {
    setSecretBusy(true)
    try {
      const result = await withTimeout(
        window.api.secret.delete(credential),
        SECRET_OPERATION_TIMEOUT_MS,
        SECRET_TIMEOUT_MESSAGE
      )
      setSecretStatus(result.status)
      setTestResults((previous) => {
        const next = { ...previous }
        delete next[credentialValue(credential)]
        return next
      })
      const deletedCurrent =
        credential.provider === settings.aiProvider &&
        credential.model === settings.aiModel &&
        (credential.baseUrl ?? '') ===
          (settings.aiProvider === 'openai-compatible'
            ? settings.aiBaseUrl
            : '')
      if (deletedCurrent && result.status.activeCredential) {
        useCredential(result.status.activeCredential)
      }
      setSavedMessage(
        `${PROVIDER_LABEL[credential.provider]} · ${credential.model} 金鑰已從本機刪除；其他模型不受影響。`
      )
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

  const testKey = async (
    credential: SecretCredentialRef,
    draftApiKey?: string
  ): Promise<void> => {
    const key = credentialValue(credential)
    setTestingCredentialKey(key)
    try {
      const result = await withTimeout(
        window.api.ai.testCredential({
          provider: credential.provider,
          model: credential.model,
          baseUrl: credential.baseUrl,
          apiKey: draftApiKey?.trim() || undefined
        }),
        SECRET_OPERATION_TIMEOUT_MS,
        '測試逾時，請檢查網路連線後重試。'
      )
      setTestResults((previous) => ({ ...previous, [key]: result }))
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [key]: {
          ok: false,
          message: error instanceof Error ? error.message : '測試逾時，請稍後重試。'
        }
      }))
    } finally {
      setTestingCredentialKey(null)
    }
  }

  const browseNewEngine = async (): Promise<void> => {
    try {
      const picked = await window.api.engine.browsePath()
      if (picked) {
        setNewEnginePath(picked.displayPath)
        setNewEngineSelectionToken(picked.token)
      }
    } catch {
      setEngineMessage('無法開啟檔案選擇器，請稍後重試。')
    }
  }

  const addEngine = async (): Promise<void> => {
    if (!newEnginePath.trim() || !newEngineSelectionToken) {
      setEngineMessage('請先選擇本機引擎 EXE。')
      return
    }
    try {
      const installation = await window.api.engine.addInstallation({
        profileId: newEngineProfile,
        displayName: newEngineName.trim() || undefined,
        selectionToken: newEngineSelectionToken
      })
      setNewEngineName('')
      setNewEnginePath('')
      setNewEngineSelectionToken(null)
      setEngineMessage(
        `已加入 ${installation.displayName}；實際通過搜尋測試後才會標示已驗證。`
      )
      await refreshEngine()
    } catch {
      setEngineMessage('無法加入引擎，請確認是本機磁碟上的 EXE 絕對路徑。')
    }
  }

  const removeEngine = async (id: string): Promise<void> => {
    try {
      setEngineRegistry(await window.api.engine.removeInstallation(id))
      setEngineMessage('引擎已從清單移除；原始 EXE 不會被刪除。')
    } catch {
      setEngineMessage('無法移除引擎，可能仍有分析工作正在使用它。')
    }
  }

  const testEngine = async (id: string): Promise<void> => {
    setTestingEngineId(id)
    setEngineTest(null)
    try {
      const result = await window.api.engine.testInstallation(id)
      setEngineTest(result)
      if (result.ok) await refreshEngine()
    } catch {
      setEngineTest({ ok: false, message: '引擎測試失敗，請確認路徑與執行權限。' })
    } finally {
      setTestingEngineId(null)
    }
  }

  const selectEngines = async (
    activeEngineId: string,
    verificationEngineId: string | null = engineRegistry.verificationEngineId
  ): Promise<void> => {
    if (!activeEngineId) return
    try {
      setEngineRegistry(
        await window.api.engine.selectInstallation(
          activeEngineId,
          verificationEngineId === activeEngineId ? null : verificationEngineId
        )
      )
      setEngineMessage(null)
    } catch {
      setEngineMessage('主引擎與複核引擎必須是不同的已加入引擎。')
    }
  }

  const clearHarnessTraces = async (): Promise<void> => {
    try {
      await window.api.ai.clearHarnessTraces()
      setTraceCount(0)
      setSavedMessage('Harness 診斷紀錄已清除。')
    } catch {
      setOperationError('無法清除 Harness 診斷紀錄。')
    }
  }

  const exportHarnessTraces = async (): Promise<void> => {
    try {
      const result = await window.api.ai.exportHarnessTraces()
      if (result.ok) setSavedMessage(`Harness 診斷紀錄已匯出：${result.filePath}`)
    } catch {
      setOperationError('Harness 診斷紀錄匯出失敗。')
    }
  }

  const exportBackup = async (): Promise<void> => {
    try {
      const result = await window.api.data.exportBackup()
      if (result.ok) {
        setSavedMessage(`資料已匯出：${result.filePath}`)
        setOperationError(null)
      } else if (!result.cancelled) {
        setOperationError(result.message ?? '資料匯出失敗。')
      }
    } catch {
      setOperationError('資料匯出失敗，請確認儲存位置後重試。')
    }
  }

  const importBackup = async (): Promise<void> => {
    try {
      const result = await window.api.data.importBackup()
      if (result.ok) {
        onDataImported(result.snapshot)
        const total = Object.values(result.summary).reduce((sum, count) => sum + count, 0)
        setSavedMessage(`匯入完成，共新增 ${total} 筆資料；重複資料已略過。`)
        setOperationError(null)
      } else if (!result.cancelled) {
        setOperationError(result.message ?? '資料匯入失敗。')
      }
    } catch {
      setOperationError('資料匯入失敗；原有資料未被覆寫，請確認備份檔後重試。')
    }
  }

  const runUpdateAction = async (
    action: () => Promise<AppUpdateStatus>
  ): Promise<void> => {
    setUpdateBusy(true)
    setOperationError(null)
    try {
      setUpdateStatus(await action())
    } catch {
      setOperationError('更新操作失敗，請稍後再試。')
    } finally {
      setUpdateBusy(false)
    }
  }

  const deactivateLicense = async (): Promise<void> => {
    try {
      setLicense(await window.api.license.deactivate())
    } catch {
      setOperationError('解除授權失敗，請稍後再試。')
    }
  }

  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SYSTEM PREFERENCES</span>
          <h1>設定</h1>
          <p>設定依用途分類；一般選項與資料保存在本機，API Key 另行加密。</p>
        </div>
        <div className="heading-status">
          <span className="status-dot" />
          資料保存在本機
        </div>
      </div>

      {operationError && <div className="settings-global-message error-text">{operationError}</div>}
      {savedMessage && <div className="settings-global-message success-text">{savedMessage}</div>}

      <div className="settings-layout">
        <SettingsNavigation active={activeCategory} onChange={setActiveCategory} />
        <div className="settings-content">
          {activeCategory === 'ai' && (
            <AiSettingsSection
              settings={settings}
              update={update}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              secretStatus={secretStatus}
              encryptionAvailable={encryptionAvailable}
              secretBusy={secretBusy}
              testingCredentialKey={testingCredentialKey}
              testResults={testResults}
              onSaveKey={(credential) => void saveKey(credential)}
              onActivateCredential={(credential) =>
                void activateCredential(credential)
              }
              onUseLocalCredential={useCredential}
              onDeleteKey={(credential) => void deleteKey(credential)}
              onTestKey={(credential, draftApiKey) =>
                void testKey(credential, draftApiKey)
              }
            />
          )}

          {activeCategory === 'engines' && (
            <EngineSettingsSection
              settings={settings}
              update={update}
              registry={engineRegistry}
              newProfile={newEngineProfile}
              onNewProfileChange={setNewEngineProfile}
              newName={newEngineName}
              onNewNameChange={setNewEngineName}
              newPath={newEnginePath}
              testingEngineId={testingEngineId}
              message={engineMessage}
              testResult={engineTest}
              onBrowse={() => void browseNewEngine()}
              onAdd={() => void addEngine()}
              onRefresh={() => void refreshEngine()}
              onTest={(id) => void testEngine(id)}
              onRemove={(id) => void removeEngine(id)}
              onSelect={(activeId, verificationId) =>
                void selectEngines(activeId, verificationId)
              }
            />
          )}

          {activeCategory === 'harness' && (
            <HarnessSettingsSection
              settings={settings}
              update={update}
              canUseCrossEngine={engineRegistry.installations.length > 1}
              traceCount={traceCount}
              onExportTraces={() => void exportHarnessTraces()}
              onClearTraces={() => void clearHarnessTraces()}
            />
          )}

          {activeCategory === 'system' && (
            <SystemSettingsSection
              updateStatus={updateStatus}
              updateBusy={updateBusy}
              license={license}
              licenseGateDisabled={LICENSE_GATE_DISABLED}
              onExportBackup={() => void exportBackup()}
              onImportBackup={() => void importBackup()}
              onCheckUpdate={() => void runUpdateAction(() => window.api.update.check())}
              onDownloadUpdate={() =>
                void runUpdateAction(() => window.api.update.download())
              }
              onInstallUpdate={() =>
                void runUpdateAction(() => window.api.update.install())
              }
              onDeactivateLicense={() => void deactivateLicense()}
            />
          )}
        </div>
      </div>
    </div>
  )
}
