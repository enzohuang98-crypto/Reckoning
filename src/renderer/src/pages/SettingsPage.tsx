/**
 * 設定頁控制器。
 *
 * UI 依領域拆到 features/settings；此檔只管理 IPC、狀態與持久化。
 * API Key 永遠走 SecretStore，絕不寫入 renderer 的 localStorage。
 */

import { useEffect, useState } from 'react'
import {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABEL
} from '@shared/types/AIProviderTypes'
import type { AppDataSnapshot } from '@shared/types/AppData'
import type { AppUpdateStatus } from '@shared/types/AppUpdate'
import {
  type EngineProfileId,
  type EngineRegistrySnapshot
} from '@shared/types/EngineRegistry'
import type { LicenseStatus } from '@shared/types/License'
import type { AppSettings } from '@shared/types/Settings'
import type { EngineTestResult, SecretStatus } from '@shared/types/ipc'
import { LICENSE_GATE_DISABLED } from '../app/productFlags'
import { AiSettingsSection } from '../features/settings/AiSettingsSection'
import { EngineSettingsSection } from '../features/settings/EngineSettingsSection'
import { HarnessSettingsSection } from '../features/settings/HarnessSettingsSection'
import { SettingsNavigation } from '../features/settings/SettingsNavigation'
import { SystemSettingsSection } from '../features/settings/SystemSettingsSection'
import type { SettingsCategory } from '../features/settings/types'
import { saveSettings } from '../storage/localSettings'

interface Props {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
  onDataImported: (snapshot: AppDataSnapshot) => void
}

const EMPTY_SECRET_STATUS: SecretStatus = {
  configured: false,
  provider: null,
  needsReentry: false
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
  const [engineTest, setEngineTest] = useState<EngineTestResult | null>(null)
  const [engineMessage, setEngineMessage] = useState<string | null>(null)
  const [engineRegistry, setEngineRegistry] =
    useState<EngineRegistrySnapshot>(EMPTY_ENGINE_REGISTRY)
  const [newEngineProfile, setNewEngineProfile] = useState<EngineProfileId>('pikafish')
  const [newEngineName, setNewEngineName] = useState('')
  const [newEnginePath, setNewEnginePath] = useState('')
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
    window.api.secret
      .isAvailable()
      .then(setEncryptionAvailable)
      .catch(() => setEncryptionAvailable(false))
    window.api.secret
      .status()
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

  const saveKey = async (): Promise<void> => {
    const key = apiKey.trim()
    if (!key) return
    try {
      const result = await window.api.secret.set(key, settings.aiProvider)
      const defaultModel =
        result.provider === 'openai-compatible'
          ? null
          : PROVIDER_DEFAULT_MODELS[result.provider].find(
              (model) => model.isDefault
            ) ?? PROVIDER_DEFAULT_MODELS[result.provider][0]
      update({
        aiProvider: result.provider,
        aiModel: defaultModel?.id ?? settings.aiModel
      })
      setApiKey('')
      setSecretStatus({ configured: true, provider: result.provider, needsReentry: false })
      setSavedMessage(`${PROVIDER_LABEL[result.provider]} 金鑰已安全儲存並設為使用中。`)
      setOperationError(null)
    } catch {
      setOperationError(
        '無法安全儲存 API Key。請確認已選正確服務，且金鑰不含換行或控制字元。'
      )
    }
  }

  const deleteKey = async (): Promise<void> => {
    try {
      await window.api.secret.delete()
      setSecretStatus(EMPTY_SECRET_STATUS)
      setSavedMessage('API Key 已從本機安全儲存中刪除。')
      setOperationError(null)
    } catch {
      setOperationError('API Key 刪除失敗，請稍後重試。')
    }
  }

  const browseNewEngine = async (): Promise<void> => {
    try {
      const picked = await window.api.engine.browsePath()
      if (picked) setNewEnginePath(picked)
    } catch {
      setEngineMessage('無法開啟檔案選擇器，請手動輸入引擎路徑。')
    }
  }

  const addEngine = async (): Promise<void> => {
    if (!newEnginePath.trim()) {
      setEngineMessage('請先選擇本機引擎 EXE。')
      return
    }
    try {
      const installation = await window.api.engine.addInstallation({
        profileId: newEngineProfile,
        displayName: newEngineName.trim() || undefined,
        executablePath: newEnginePath.trim()
      })
      setNewEngineName('')
      setNewEnginePath('')
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
              onSaveKey={() => void saveKey()}
              onDeleteKey={() => void deleteKey()}
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
              onNewPathChange={setNewEnginePath}
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
