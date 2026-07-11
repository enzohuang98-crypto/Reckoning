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
import type { EngineAnalysis, EngineProtocol } from '@shared/types/EngineAnalysis'
import type { EngineProfileId } from '@shared/types/EngineRegistry'
import { compareMove } from '@shared/logic/MoveComparisonService'
import { buildDualEngineComparison } from '@shared/logic/DualEngineComparison'
import {
  EngineAnalysisError,
  type EngineProcessControls
} from '../engine/PikafishAdapter'
import type { EngineRegistryService } from '../engine/EngineRegistryService'
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

export const ENGINE_CONFIG_FILE = 'engine-config.json'

export interface EngineConfig {
  enginePath: string | null
  engineProtocol: EngineProtocol | null
}

const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  enginePath: null,
  engineProtocol: null
}
const MAX_ACTIVE_ANALYSES = 3

// Kept for backwards-compatible tests and migration tooling.
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

interface EngineAnalysisHandle {
  controller: AbortController
  controls: Set<EngineProcessControls>
}

function buildStatus(registry: EngineRegistryService, engineId?: string): EngineStatus {
  const installation = registry.getInstallation(engineId)
  const adapter = registry.getAdapter(engineId)
  if (!installation || !adapter) {
    return {
      engineId,
      available: false,
      engineName: '尚未設定引擎',
      message: '請先在設定頁加入本機 UCI 或 UCCI 象棋引擎。'
    }
  }
  const available = adapter.isAvailable()
  return {
    engineId: installation.id,
    available,
    engineName: installation.detectedName ?? installation.displayName,
    pathSource: adapter.pathSource(),
    resolvedPath: adapter.resolveEnginePath(),
    protocol: installation.protocol ?? adapter.getKnownProtocol(),
    message: available ? undefined : '找不到引擎執行檔，請重新選擇本機 EXE。'
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
    message: error instanceof Error
      ? sanitizePublicErrorMessage(error.message, '分析發生未知錯誤。')
      : '分析發生未知錯誤。'
  }
}

function validateEngineId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  ) {
    throw new SecurityValidationError('引擎識別碼格式無效。')
  }
  return value
}

const PROFILE_IDS = new Set<EngineProfileId>([
  'pikafish',
  'chessmaster',
  'cyclone',
  'bugchess',
  'alphacat',
  'custom'
])

export function registerEngineAnalysisHandlers(
  registry: EngineRegistryService,
  sessionStore: AnalysisSessionStore
): void {
  const activeAnalyses = new Map<string, EngineAnalysisHandle>()

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

      const primaryInstallation = registry.getInstallation(payload.engineId)
      const primaryAdapter = registry.getAdapter(payload.engineId)
      if (!primaryInstallation || !primaryAdapter) {
        event.reply(IPC.ENGINE_ANALYSIS_ERROR, {
          requestId: payload.requestId,
          code: 'engine_not_configured',
          message: '尚未設定可用的主引擎。'
        } satisfies EngineAnalysisErrorPayload)
        return
      }
      const verificationInstallation = payload.verificationEngineId
        ? registry.getInstallation(payload.verificationEngineId)
        : null
      const verificationAdapter = payload.verificationEngineId
        ? registry.getAdapter(payload.verificationEngineId)
        : null

      const previous = activeAnalyses.get(payload.requestId)
      if (!previous && activeAnalyses.size >= MAX_ACTIVE_ANALYSES) {
        event.reply(IPC.ENGINE_ANALYSIS_ERROR, {
          requestId: payload.requestId,
          code: 'too_many_requests',
          message: '同時分析工作過多，請等目前分析完成後再試。'
        } satisfies EngineAnalysisErrorPayload)
        return
      }
      if (previous) {
        previous.controller.abort()
        for (const controls of previous.controls) controls.sendStop()
      }
      const handle: EngineAnalysisHandle = {
        controller: new AbortController(),
        controls: new Set()
      }
      activeAnalyses.set(payload.requestId, handle)
      const startedAt = Date.now()
      const sendProgress = (
        progress: Omit<EngineAnalysisProgressPayload, 'requestId'>
      ): void => {
        if (
          handle.controller.signal.aborted ||
          activeAnalyses.get(payload.requestId) !== handle
        ) {
          return
        }
        event.reply(IPC.ENGINE_ANALYSIS_PROGRESS, {
          requestId: payload.requestId,
          ...progress
        })
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

      const runEngine = (
        adapter: NonNullable<ReturnType<EngineRegistryService['getAdapter']>>,
        installation: typeof primaryInstallation,
        engineRole: 'primary' | 'verification'
      ): Promise<EngineAnalysis> =>
        adapter.analyzePosition(
          { positionFen: payload.positionFen, userMove: payload.userMove },
          payload.analysisConfig,
          {
            signal: handle.controller.signal,
            onPhase: (phase, controls) => {
              handle.controls.add(controls)
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
                displayPrincipalVariation: [],
                engineRole,
                engineId: installation.id,
                engineName: installation.detectedName ?? installation.displayName
              })
            },
            onProgress: (progress) => {
                  const ratio = Math.min(
                    1,
                    progress.elapsedMs / Math.max(1, progress.targetMs)
                  )
                  const percent =
                    progress.phase === 'root_analysis'
                      ? Math.round(5 + ratio * (payload.userMove ? 60 : 88))
                      : Math.round(68 + ratio * 27)
                  sendProgress({
                    ...progress,
                    percent: Math.min(95, percent),
                    engineRole,
                    engineId: installation.id,
                    engineName: installation.detectedName ?? installation.displayName
                  })
                }
          }
        )

      try {
        let verificationWarning =
          verificationInstallation && !verificationAdapter
            ? '複核引擎目前無法啟動；已保留主引擎結果。'
            : undefined
        const [engineAnalysis, verificationEngineAnalysis] = await Promise.all([
          runEngine(primaryAdapter, primaryInstallation, 'primary'),
          verificationAdapter && verificationInstallation
            ? runEngine(
                verificationAdapter,
                verificationInstallation,
                'verification'
              ).catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') {
                  throw error
                }
                verificationWarning = `複核引擎未完成：${sanitizePublicErrorMessage(
                  error instanceof Error ? error.message : '',
                  '複核引擎分析失敗。'
                )}`
                logger.warn('複核引擎分析失敗，保留主引擎結果', verificationWarning)
                return undefined
              })
            : Promise.resolve(undefined)
        ])
        if (
          handle.controller.signal.aborted ||
          activeAnalyses.get(payload.requestId) !== handle
        ) {
          throw new DOMException('Analysis cancelled', 'AbortError')
        }
        const moveComparison = compareMove(engineAnalysis)
        const dualEngineComparison = buildDualEngineComparison(
          engineAnalysis,
          verificationEngineAnalysis
        )
        const engineDisagreement =
          dualEngineComparison?.status === 'disagreement'
        sendProgress({
          phase: 'finalizing',
          elapsedMs: Date.now() - startedAt,
          targetMs: null,
          percent: 98,
          depth: engineAnalysis.depth,
          score: engineAnalysis.scoreAfterBestMove,
          displayMove: engineAnalysis.displayBestMove,
          displayPrincipalVariation:
            engineAnalysis.displayPrincipalVariation ?? [],
          engineRole: 'primary',
          engineId: primaryInstallation.id,
          engineName:
            primaryInstallation.detectedName ?? primaryInstallation.displayName
        })

        const analysisId = randomUUID()
        const now = Date.now()
        const session: AnalysisSession = {
          analysisId,
          requestId: payload.requestId,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(
            now + DEFAULT_ANALYSIS_SESSION_TTL_MS
          ).toISOString(),
          positionFen: payload.positionFen,
          userMove: payload.userMove,
          primaryEngineId: primaryInstallation.id,
          verificationEngineId: verificationInstallation?.id,
          engineAnalysis,
          verificationEngineAnalysis,
          engineDisagreement,
          dualEngineComparison: dualEngineComparison ?? undefined,
          verificationWarning,
          moveComparison
        }
        await sessionStore.save(session)
        if (
          handle.controller.signal.aborted ||
          activeAnalyses.get(payload.requestId) !== handle
        ) {
          await sessionStore.delete(analysisId)
          throw new DOMException('Analysis cancelled', 'AbortError')
        }
        event.reply(IPC.ENGINE_ANALYSIS_RESULT, {
          requestId: payload.requestId,
          analysisId,
          engineAnalysis,
          verificationEngineAnalysis,
          engineDisagreement,
          dualEngineComparison: dualEngineComparison ?? undefined,
          verificationWarning,
          moveComparison
        })
      } catch (error) {
        const errorPayload = mapAnalysisError(payload.requestId, error)
        if (errorPayload.code !== 'cancelled') {
          logger.error('引擎分析失敗', errorPayload.code, error)
        }
        event.reply(IPC.ENGINE_ANALYSIS_ERROR, errorPayload)
      } finally {
        if (activeAnalyses.get(payload.requestId) === handle) {
          activeAnalyses.delete(payload.requestId)
        }
      }
    }
  )

  ipcMain.on(IPC.ENGINE_ANALYSIS_CANCEL, (event, raw: unknown) => {
    try {
      assertTrustedIpcSender(event)
    } catch {
      return
    }
    const requestId = safeRequestId(
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>).requestId
        : undefined
    )
    const handle = activeAnalyses.get(requestId)
    if (!handle) return
    handle.controller.abort()
    for (const controls of handle.controls) controls.sendStop()
  })

  ipcMain.handle(IPC.ENGINE_STATUS, (event): EngineStatus => {
    assertTrustedIpcSender(event)
    return buildStatus(registry)
  })

  ipcMain.handle(IPC.ENGINE_GET_PATH, (event): string | null => {
    assertTrustedIpcSender(event)
    return registry.getInstallation()?.executablePath ?? null
  })

  ipcMain.handle(IPC.ENGINE_SET_PATH, (event, rawPath: unknown): EngineStatus => {
    assertTrustedIpcSender(event)
    registry.replaceLegacyPath(normalizeEnginePath(rawPath))
    return buildStatus(registry)
  })

  ipcMain.handle(IPC.ENGINE_BROWSE_PATH, async (event): Promise<string | null> => {
    assertTrustedIpcSender(event)
    const result = await dialog.showOpenDialog({
      title: '選擇象棋引擎執行檔',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [
              { name: '可執行檔', extensions: ['exe'] },
              { name: '所有檔案', extensions: ['*'] }
            ]
          : [{ name: '所有檔案', extensions: ['*'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizeEnginePath(result.filePaths[0])
  })

  const testInstallation = async (id?: string): Promise<EngineTestResult> => {
    const installation = registry.getInstallation(id)
    const adapter = registry.getAdapter(id)
    if (!installation || !adapter) {
      return { ok: false, message: '找不到指定的引擎。' }
    }
    const result = await adapter.test()
    const capabilities = {
      multiPv: result.ok,
      configurableThreads: false,
      configurableHash: false
    }
    registry.updateDetected(installation.id, {
      protocol: result.protocol ?? installation.protocol,
      detectedName: result.engineName ?? installation.detectedName,
      verified: result.ok,
      capabilities,
      lastTestedAt: new Date().toISOString(),
      lastError: result.ok
        ? undefined
        : sanitizePublicErrorMessage(result.message, '引擎測試失敗。')
    })
    return {
      ...result,
      capabilities,
      message: result.ok
        ? result.message
        : sanitizePublicErrorMessage(result.message, '引擎連線測試失敗。')
    }
  }

  ipcMain.handle(IPC.ENGINE_TEST, (event) => {
    assertTrustedIpcSender(event)
    return testInstallation()
  })

  ipcMain.handle(IPC.ENGINE_REGISTRY_LIST, (event) => {
    assertTrustedIpcSender(event)
    return registry.list()
  })

  ipcMain.handle(IPC.ENGINE_REGISTRY_ADD, (event, raw: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof raw !== 'object' || raw === null) {
      throw new SecurityValidationError('引擎資料格式無效。')
    }
    const input = raw as Record<string, unknown>
    if (
      typeof input.profileId !== 'string' ||
      !PROFILE_IDS.has(input.profileId as EngineProfileId)
    ) {
      throw new SecurityValidationError('引擎類型無效。')
    }
    const executablePath = normalizeEnginePath(input.executablePath)
    if (!executablePath) {
      throw new SecurityValidationError('必須選擇引擎執行檔。')
    }
    const displayName =
      typeof input.displayName === 'string'
        ? input.displayName.trim().slice(0, 80)
        : undefined
    return registry.add({
      profileId: input.profileId as EngineProfileId,
      displayName,
      executablePath
    })
  })

  ipcMain.handle(IPC.ENGINE_REGISTRY_REMOVE, (event, rawId: unknown) => {
    assertTrustedIpcSender(event)
    return registry.remove(validateEngineId(rawId))
  })

  ipcMain.handle(IPC.ENGINE_REGISTRY_SELECT, (event, raw: unknown) => {
    assertTrustedIpcSender(event)
    if (typeof raw !== 'object' || raw === null) {
      throw new SecurityValidationError('引擎選擇格式無效。')
    }
    const input = raw as Record<string, unknown>
    return registry.select(
      validateEngineId(input.activeEngineId),
      input.verificationEngineId === null ||
        input.verificationEngineId === undefined ||
        input.verificationEngineId === ''
        ? null
        : validateEngineId(input.verificationEngineId)
    )
  })

  ipcMain.handle(IPC.ENGINE_REGISTRY_TEST, (event, rawId: unknown) => {
    assertTrustedIpcSender(event)
    return testInstallation(validateEngineId(rawId))
  })
}
