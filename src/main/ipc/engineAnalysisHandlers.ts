/**
 * 引擎分析 IPC 處理器 (engineAnalysisHandlers) — SDS v0.2 §2.16
 *
 * 事件式分析通道：
 *   engine:analyze-position:start (renderer→main)
 *   engine:analysis-result        (main→renderer，含 analysisId)
 *   engine:analysis-error         (main→renderer)
 *   engine:analysis-cancel        (renderer→main)
 *
 * 規則：
 *  - analysisId 由 main 生成，必須在 EngineAnalysis 與 MoveComparisonResult
 *    都建立後產生，先 save() 進 AnalysisSessionStore 再 reply（§2.16.4）。
 *  - save() 失敗送 engine:analysis-error（code: session_store_failed）。
 *  - 取消：AbortController + UCI "stop" + 寬限期 kill（§2.16.5）；
 *    取消後不得發送 analysis-result，改送 error（code: cancelled）。
 *  - 主分析迴圈 try/catch/finally；finally 移除 handle 避免洩漏。
 */

import { randomUUID } from 'node:crypto'
import { dialog, ipcMain } from 'electron'
import {
  IPC,
  type AnalyzePositionStartPayload,
  type EngineAnalysisErrorPayload,
  type EngineAnalysisProgressPayload,
  type EngineStatus,
  type EngineTestResult
} from '@shared/types/ipc'
import type { EngineProtocol } from '@shared/types/EngineAnalysis'
import { compareMove } from '@shared/logic/MoveComparisonService'
import {
  EngineAnalysisError,
  PikafishAdapter,
  type EngineProcessControls
} from '../engine/PikafishAdapter'
import type { StorageService } from '../storage/StorageService'
import { logger } from '../Logger'
import {
  DEFAULT_ANALYSIS_SESSION_TTL_MS,
  type AnalysisSession,
  type AnalysisSessionStore
} from '../storage/AnalysisSessionStore'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import {
  normalizeEnginePath,
  safeRequestId,
  sanitizePublicErrorMessage,
  SecurityValidationError,
  validateAnalyzePositionPayload
} from '../security/InputValidation'

/** 引擎設定持久化檔名（userData 下） */
export const ENGINE_CONFIG_FILE = 'engine-config.json'

export interface EngineConfig {
  enginePath: string | null
  engineProtocol: EngineProtocol | null
}

const DEFAULT_ENGINE_CONFIG: EngineConfig = { enginePath: null, engineProtocol: null }

export function loadEngineConfig(storage: StorageService): EngineConfig {
  const stored = storage.read<unknown>(ENGINE_CONFIG_FILE, DEFAULT_ENGINE_CONFIG)
  if (typeof stored !== 'object' || stored === null) return DEFAULT_ENGINE_CONFIG
  const value = stored as Record<string, unknown>
  let enginePath: string | null = null
  try {
    enginePath = normalizeEnginePath(value.enginePath)
  } catch {
    enginePath = null
  }
  const engineProtocol =
    value.engineProtocol === 'uci' || value.engineProtocol === 'ucci'
      ? value.engineProtocol
      : null
  return { enginePath, engineProtocol }
}

/** 進行中分析的取消 handle（§2.16.5） */
interface EngineAnalysisHandle {
  requestId: string
  controller: AbortController
  phase: 'root_analysis' | 'user_move_analysis'
  sendStop: () => void
  killEngine: () => void
}

function buildStatus(adapter: PikafishAdapter): EngineStatus {
  const available = adapter.isAvailable()
  return {
    available,
    engineName: adapter.engineName,
    pathSource: adapter.pathSource(),
    resolvedPath: adapter.resolveEnginePath(),
    protocol: adapter.getKnownProtocol(),
    message: available
      ? undefined
      : '未偵測到引擎。請於下方指定引擎路徑，或設定 PIKAFISH_PATH / 放置 resources/engine/pikafish.exe。'
  }
}

function mapAnalysisError(requestId: string, error: unknown): EngineAnalysisErrorPayload {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { requestId, code: 'cancelled', message: '分析已取消。' }
  }
  if (error instanceof EngineAnalysisError) {
    return {
      requestId,
      code: error.code,
      message: sanitizePublicErrorMessage(error.message, '引擎分析失敗。'),
      diagnostics: error.diagnostics
    }
  }
  return {
    requestId,
    code: 'unknown_error',
    message: '分析發生未知錯誤。'
  }
}

export function registerEngineAnalysisHandlers(
  adapter: PikafishAdapter,
  storage: StorageService,
  sessionStore: AnalysisSessionStore
): void {
  const activeEngineAnalyses = new Map<string, EngineAnalysisHandle>()

  const persistConfig = (): void => {
    storage.write<EngineConfig>(ENGINE_CONFIG_FILE, {
      enginePath: adapter.getUserPath(),
      engineProtocol: adapter.getKnownProtocol()
    })
  }

  // 自動偵測到協定（UCI/UCCI）時持久化，下次啟動直接以已知協定握手
  adapter.onProtocolDetected(() => persistConfig())

  /* ---------- 事件式分析流程 ---------- */

  ipcMain.on(
    IPC.ENGINE_ANALYZE_POSITION_START,
    async (event, rawPayload: unknown) => {
      try {
        assertTrustedIpcSender(event)
      } catch {
        return
      }
      let payload: AnalyzePositionStartPayload
      try {
        payload = validateAnalyzePositionPayload(rawPayload)
      } catch (error) {
        const validationError =
          error instanceof SecurityValidationError ? error : null
        event.reply(IPC.ENGINE_ANALYSIS_ERROR, {
          requestId: safeRequestId(
            typeof rawPayload === 'object' && rawPayload !== null
              ? (rawPayload as Record<string, unknown>).requestId
              : undefined
          ),
          code:
            validationError?.code === 'invalid_fen' ||
            validationError?.code === 'invalid_user_move'
              ? validationError.code
              : 'invalid_analysis_config',
          message: validationError?.message ?? '分析請求格式無效。'
        } satisfies EngineAnalysisErrorPayload)
        return
      }
      const { requestId } = payload
      const previous = activeEngineAnalyses.get(requestId)
      if (previous) {
        previous.controller.abort()
        previous.sendStop()
      }
      const controller = new AbortController()
      const handle: EngineAnalysisHandle = {
        requestId,
        controller,
        phase: 'root_analysis',
        sendStop: () => undefined,
        killEngine: () => undefined
      }
      activeEngineAnalyses.set(requestId, handle)
      const analysisStartedAt = Date.now()
      const sendProgress = (
        progress: Omit<EngineAnalysisProgressPayload, 'requestId'>
      ): void => {
        if (
          controller.signal.aborted ||
          activeEngineAnalyses.get(requestId) !== handle
        ) {
          return
        }
        event.reply(IPC.ENGINE_ANALYSIS_PROGRESS, { requestId, ...progress })
      }
      sendProgress({
        phase: 'preparing_engine',
        elapsedMs: 0,
        targetMs: null,
        percent: 2,
        depth: null,
        score: null,
        displayPrincipalVariation: []
      })

      try {
        const engineAnalysis = await adapter.analyzePosition(
          { positionFen: payload.positionFen, userMove: payload.userMove },
          payload.analysisConfig,
          {
            signal: controller.signal,
            onPhase: (phase, controls: EngineProcessControls) => {
              handle.phase = phase
              handle.sendStop = controls.sendStop
              handle.killEngine = controls.killEngine
              sendProgress({
                phase,
                elapsedMs: 0,
                targetMs:
                  phase === 'root_analysis'
                    ? payload.analysisConfig.rootAnalysisMovetimeMs
                    : payload.analysisConfig.userMoveEvalMovetimeMs,
                percent: phase === 'root_analysis' ? 5 : 68,
                depth: null,
                score: null,
                displayPrincipalVariation: []
              })
            },
            onProgress: (progress) => {
              const ratio = Math.min(
                1,
                progress.elapsedMs / Math.max(1, progress.targetMs)
              )
              const percent =
                progress.phase === 'root_analysis'
                  ? Math.round(
                      5 + ratio * (payload.userMove ? 60 : 88)
                    )
                  : Math.round(68 + ratio * 27)
              sendProgress({
                ...progress,
                percent: Math.min(95, percent)
              })
            }
          }
        )
        if (controller.signal.aborted || activeEngineAnalyses.get(requestId) !== handle) {
          throw new DOMException('Analysis cancelled', 'AbortError')
        }
        const moveComparison = compareMove(engineAnalysis)
        sendProgress({
          phase: 'finalizing',
          elapsedMs: Date.now() - analysisStartedAt,
          targetMs: null,
          percent: 98,
          depth: engineAnalysis.depth,
          score: engineAnalysis.scoreAfterBestMove,
          displayMove: engineAnalysis.displayBestMove,
          displayPrincipalVariation:
            engineAnalysis.displayPrincipalVariation ?? []
        })

        // analysisId：兩者都建立後才生成；先 save 再 reply（§2.16.4）
        const analysisId = randomUUID()
        const now = Date.now()
        const session: AnalysisSession = {
          analysisId,
          requestId,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + DEFAULT_ANALYSIS_SESSION_TTL_MS).toISOString(),
          positionFen: payload.positionFen,
          userMove: payload.userMove,
          engineAnalysis,
          moveComparison
        }
        try {
          await sessionStore.save(session)
          if (controller.signal.aborted || activeEngineAnalyses.get(requestId) !== handle) {
            await sessionStore.delete(analysisId)
            throw new DOMException('Analysis cancelled', 'AbortError')
          }
          event.reply(IPC.ENGINE_ANALYSIS_RESULT, {
            requestId,
            analysisId,
            engineAnalysis,
            moveComparison
          })
        } catch (saveError) {
          logger.error('AnalysisSessionStore.save 失敗', saveError)
          event.reply(IPC.ENGINE_ANALYSIS_ERROR, {
            requestId,
            code: 'session_store_failed',
            message: 'Failed to store analysis session.'
          } satisfies EngineAnalysisErrorPayload)
        }
      } catch (error) {
        const payload = mapAnalysisError(requestId, error)
        // 取消屬正常操作不記 error；其他失敗經 Logger（自動遮蔽敏感字串）記錄
        if (payload.code !== 'cancelled') logger.error('引擎分析失敗', payload.code, error)
        event.reply(IPC.ENGINE_ANALYSIS_ERROR, payload)
      } finally {
        if (activeEngineAnalyses.get(requestId) === handle) {
          activeEngineAnalyses.delete(requestId)
        }
      }
    }
  )

  ipcMain.on(IPC.ENGINE_ANALYSIS_CANCEL, (event, payload: unknown) => {
    try {
      assertTrustedIpcSender(event)
    } catch {
      return
    }
    const requestId = safeRequestId(
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).requestId
        : undefined
    )
    if (requestId === 'invalid-request') return
    const handle = activeEngineAnalyses.get(requestId)
    if (!handle) return
    handle.controller.abort()
    handle.sendStop()
  })

  /* ---------- 引擎設定 / 狀態（invoke） ---------- */

  ipcMain.handle(IPC.ENGINE_STATUS, (event): EngineStatus => {
    assertTrustedIpcSender(event)
    return buildStatus(adapter)
  })

  ipcMain.handle(IPC.ENGINE_GET_PATH, (event): string | null => {
    assertTrustedIpcSender(event)
    return adapter.getUserPath()
  })

  ipcMain.handle(IPC.ENGINE_SET_PATH, (event, path: unknown): EngineStatus => {
    assertTrustedIpcSender(event)
    const normalized = normalizeEnginePath(path)
    const pathChanged = normalized !== adapter.getUserPath()
    adapter.setUserPath(normalized)
    // 換了引擎檔就重置已知協定，下次連線重新偵測
    if (pathChanged) adapter.setKnownProtocol(null)
    persistConfig()
    return buildStatus(adapter)
  })

  ipcMain.handle(IPC.ENGINE_BROWSE_PATH, async (event): Promise<string | null> => {
    assertTrustedIpcSender(event)
    const result = await dialog.showOpenDialog({
      title: '選擇象棋引擎可執行檔',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: '可執行檔', extensions: ['exe'] }, { name: '所有檔案', extensions: ['*'] }]
          : [{ name: '所有檔案', extensions: ['*'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizeEnginePath(result.filePaths[0])
  })

  ipcMain.handle(IPC.ENGINE_TEST, async (event): Promise<EngineTestResult> => {
    assertTrustedIpcSender(event)
    const result = await adapter.test()
    return result.ok
      ? result
      : {
          ...result,
          message: sanitizePublicErrorMessage(
            result.message,
            '引擎連線測試失敗。'
          )
        }
  })
}
