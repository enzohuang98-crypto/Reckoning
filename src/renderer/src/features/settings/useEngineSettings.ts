/**
 * 設定頁「引擎」分類的狀態與 IPC：查詢、測試、選擇與移除本機引擎。
 */

import { useState } from 'react'
import type { EngineRegistrySnapshot } from '@shared/types/EngineRegistry'
import type { EngineTestResult } from '@shared/types/ipc'

const EMPTY_ENGINE_REGISTRY: EngineRegistrySnapshot = {
  installations: [],
  activeEngineId: null
}

interface Options {
  setOperationError: (message: string | null) => void
}

export interface EngineSettings {
  engineRegistry: EngineRegistrySnapshot
  engineTest: EngineTestResult | null
  engineMessage: string | null
  testingEngineId: string | null
  refreshEngine: () => Promise<void>
  removeEngine: (id: string) => Promise<void>
  testEngine: (id: string) => Promise<void>
  selectEngine: (activeEngineId: string) => Promise<void>
}

export function useEngineSettings({ setOperationError }: Options): EngineSettings {
  const [engineTest, setEngineTest] = useState<EngineTestResult | null>(null)
  const [engineMessage, setEngineMessage] = useState<string | null>(null)
  const [engineRegistry, setEngineRegistry] =
    useState<EngineRegistrySnapshot>(EMPTY_ENGINE_REGISTRY)
  const [testingEngineId, setTestingEngineId] = useState<string | null>(null)

  const refreshEngine = async (): Promise<void> => {
    try {
      setEngineRegistry(await window.api.engine.listInstallations())
      setOperationError(null)
    } catch {
      setOperationError('無法查詢引擎狀態。')
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

  const selectEngine = async (activeEngineId: string): Promise<void> => {
    if (!activeEngineId) return
    try {
      setEngineRegistry(await window.api.engine.selectInstallation(activeEngineId))
      setEngineMessage(null)
    } catch {
      setEngineMessage('無法切換主引擎，請重新測試該引擎。')
    }
  }

  return {
    engineRegistry,
    engineTest,
    engineMessage,
    testingEngineId,
    refreshEngine,
    removeEngine,
    testEngine,
    selectEngine
  }
}
