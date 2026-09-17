import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { installPreparedUpdateSafely } from '../../../src/renderer/src/App'
import { flushLatestSnapshot } from '../../../src/renderer/src/features/app-data/useAppDataStore'
import { SystemSettingsSection } from '../../../src/renderer/src/features/settings/SystemSettingsSection'
import {
  AnalysisWorkspace,
  isUnsavedAnalysisDraft
} from '../../../src/renderer/src/features/workspace/AnalysisWorkspace'
import { parseFen } from '../../../src/shared/logic/board/fen'
import type { AppUpdateStatus } from '../../../src/shared/types/AppUpdate'
import { START_FEN } from '../../../src/shared/types/BoardState'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/Settings'
import type { RendererApi } from '../../../src/shared/types/ipc'

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function verifyWorkspaceDraftBlocksInstall(): Promise<void> {
  const parsed = parseFen(START_FEN)
  assert.equal(parsed.valid, true)
  if (!parsed.valid) throw new Error(parsed.message)

  const unsubscribe = (): void => undefined
  const api = {
    engine: {
      startAnalysis: () => undefined,
      cancelAnalysis: () => undefined,
      onAnalysisResult: () => unsubscribe,
      onAnalysisProgress: () => unsubscribe,
      onAnalysisError: () => unsubscribe,
      status: async () => ({
        engineId: null,
        available: false,
        engineName: null,
        protocol: null
      }),
      test: async () => ({ ok: false, error: 'fixture unavailable' }),
      listInstallations: async () => ({
        activeEngineId: null,
        verificationEngineId: null,
        installations: []
      }),
      selectInstallation: async () => ({
        activeEngineId: null,
        verificationEngineId: null,
        installations: []
      })
    },
    ai: {
      startExplanation: () => undefined,
      cancelExplanation: () => undefined,
      continueExplanation: () => undefined,
      onExplanationChunk: () => unsubscribe,
      onExplanationDone: () => unsubscribe,
      onExplanationError: () => unsubscribe,
      onHarnessProgress: () => unsubscribe,
      setHarnessFeedback: async () => ({ ok: true as const })
    },
    teacherTest: {
      status: async () => ({
        currentAppVersion: '0.4.14',
        active: false,
        manifest: null
      })
    }
  } as unknown as RendererApi

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      setInterval: () => 1,
      clearInterval: () => undefined,
      requestAnimationFrame: () => 1,
      confirm: () => true
    } as unknown as Window & typeof globalThis
  })

  let hasUnsavedDraft = false
  let saves = 0
  let installs = 0
  let renderer: TestRenderer.ReactTestRenderer | null = null
  try {
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <AnalysisWorkspace
          hidden={false}
          headerCommandMount={null}
          board={parsed.board}
          settings={DEFAULT_SETTINGS}
          canUndo={false}
          canRedo={false}
          onBoardChange={() => undefined}
          onUndo={() => undefined}
          onRedo={() => undefined}
          onRestoreOriginal={() => undefined}
          savedPositions={[]}
          onSavePosition={() => undefined}
          onLoadSavedPosition={() => undefined}
          onDeleteSavedPosition={() => undefined}
          conversation={null}
          onConversationChange={() => undefined}
          onRecordGuess={() => undefined}
          onOpenAiSettings={() => undefined}
          onUnsavedDraftChange={(value) => {
            hasUnsavedDraft = value
          }}
        />
      )
      await flushMicrotasks()
    })
    assert.ok(renderer)

    TestRenderer.act(() => {
      renderer?.root.findByProps({ id: 'analysis-tab-guess' }).props.onClick()
    })
    TestRenderer.act(() => {
      renderer?.root.findByProps({ id: 'guess-reason-input' }).props.onChange({
        target: { value: '尚未送出的理由' }
      })
    })
    assert.equal(hasUnsavedDraft, true, '分析頁草稿必須同步到更新阻擋狀態')

    await assert.rejects(
      () => installPreparedUpdateSafely(
        async () => {
          saves++
          return true
        },
        async () => {
          installs++
          return { phase: 'installing' } as AppUpdateStatus
        },
        () => hasUnsavedDraft
      ),
      /尚未提交/
    )
    assert.equal(saves, 0, '實際分析頁草稿存在時不得開始保存')
    assert.equal(installs, 0, '實際分析頁草稿存在時不得呼叫安裝')
  } finally {
    if (renderer) TestRenderer.act(() => renderer?.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

async function run(): Promise<void> {
  assert.equal(isUnsavedAnalysisDraft('h2e2', '', null), true)
  assert.equal(isUnsavedAnalysisDraft('', '我想搶先手', null), true)
  assert.equal(isUnsavedAnalysisDraft('h2e2', '我想搶先手', {
    submissionId: 'submitted-1',
    move: 'h2e2',
    reason: '我想搶先手',
    submittedAt: 1
  }), false)

  const first = { revision: 1 }
  const second = { revision: 2 }
  let current = first
  const persisted: number[] = []
  assert.equal(
    await flushLatestSnapshot(
      () => current,
      async (snapshot) => {
        persisted.push(snapshot.revision)
        if (snapshot.revision === 1) current = second
        return true
      },
      (snapshot) => ({ ...snapshot })
    ),
    true
  )
  assert.deepEqual(persisted, [1, 2], 'flush 中出現新狀態時必須再保存最新快照')

  let installs = 0
  assert.equal(
    await installPreparedUpdateSafely(async () => false, async () => {
      installs++
      throw new Error('must not install')
    }),
    null
  )
  assert.equal(installs, 0, '保存失敗不得退出安裝')

  let saves = 0
  await assert.rejects(
    () => installPreparedUpdateSafely(
      async () => {
        saves++
        return true
      },
      async () => {
        installs++
        return { phase: 'installing' } as AppUpdateStatus
      },
      () => true
    ),
    /尚未提交/
  )
  assert.equal(saves, 0, '尚未提交草稿時不得開始保存或退出流程')
  assert.equal(installs, 0, '尚未提交草稿時不得呼叫安裝')

  let draftAppearedDuringSave = false
  await assert.rejects(
    () => installPreparedUpdateSafely(
      async () => {
        draftAppearedDuringSave = true
        return true
      },
      async () => {
        installs++
        return { phase: 'installing' } as AppUpdateStatus
      },
      () => draftAppearedDuringSave
    ),
    /尚未提交/
  )
  assert.equal(installs, 0, '保存期間出現新草稿時仍不得呼叫安裝')

  const installed = { phase: 'installing' } as AppUpdateStatus
  assert.equal(
    await installPreparedUpdateSafely(async () => true, async () => {
      installs++
      return installed
    }),
    installed
  )
  assert.equal(installs, 1)

  await verifyWorkspaceDraftBlocksInstall()

  let downloads = 0
  let readyInstalls = 0
  const status: AppUpdateStatus = {
    phase: 'downloaded',
    currentVersion: '0.4.13',
    availableVersion: '0.4.14',
    downloadPercent: 100,
    automaticChecksEnabled: true,
    preferences: {
      backgroundPreparationEnabled: true,
      skippedVersion: null,
      snoozedVersion: null,
      snoozeUntil: null
    },
    promptSuppressed: false,
    message: '已準備完成。'
  }
  const renderer = TestRenderer.create(
    <SystemSettingsSection
      updateStatus={status}
      updateBusy={false}
      license={null}
      licenseGateDisabled={true}
      onExportBackup={() => undefined}
      canExportBackup={true}
      onImportBackup={() => undefined}
      onCheckUpdate={() => undefined}
      onDownloadUpdate={() => downloads++}
      onInstallUpdate={() => readyInstalls++}
      onSetBackgroundPreparation={() => undefined}
      onDeactivateLicense={() => undefined}
    />
  )
  const testWindow = globalThis as typeof globalThis & {
    window?: { confirm: (message?: string) => boolean }
  }
  const originalWindow = testWindow.window
  testWindow.window = { confirm: () => true }
  try {
    TestRenderer.act(() => {
      renderer.root.findByProps({ 'data-update-action': 'install' }).props.onClick()
    })
  } finally {
    testWindow.window = originalWindow
  }
  assert.equal(readyInstalls, 1)
  assert.equal(downloads, 0, 'ready 按鈕只可 install，不得再 download')
  console.log('更新前保存與 ready-only-install 測試：通過')
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
