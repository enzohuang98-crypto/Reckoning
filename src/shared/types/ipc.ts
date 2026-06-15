/**
 * IPC 契約型別 (IPC contract types) — SDS v0.2 §2.16、§2.17
 *
 * 定義 main ↔ renderer 之間的通道名稱與 preload 暴露給 renderer 的 API 形狀。
 *
 * 設計原則（§2.16.1）：
 *  - EngineAnalysis 與 MoveComparisonResult 的真相來源在 main process；
 *    renderer 只接收顯示用資料與 analysisId，不得把分析資料再傳回 main
 *    作為 AI 解釋依據。
 *  - API Key 只能在 main process 取得，不暴露給 renderer。
 */

import type {
  AnalysisConfig,
  EngineAnalysis,
  EngineProtocol,
  EngineScore
} from './EngineAnalysis'
import type { MoveComparisonResult } from './MoveComparisonResult'
import type { AIProviderId, TokenUsage } from './AIProviderTypes'
import type { ExplanationLanguage, ExplanationStyle } from './AIExplanationTypes'
import type { UserLevel } from './Settings'
import type { LicenseStatus } from './License'
import type {
  AppDataImportSummary,
  AppDataSnapshot,
  ConversationMessage
} from './AppData'
import type {
  EngineInstallation,
  EngineProfileId,
  EngineRegistrySnapshot
} from './EngineRegistry'
import type {
  HarnessAnswerMode,
  HarnessBudget,
  HarnessEvidence,
  HarnessProgressPayload
} from './Harness'
import type { AppUpdateStatus } from './AppUpdate'

/** IPC 通道名稱常數 */
export const IPC = {
  // 引擎分析（事件式，§2.16.2）
  ENGINE_ANALYZE_POSITION_START: 'engine:analyze-position:start',
  ENGINE_ANALYSIS_PROGRESS: 'engine:analysis-progress',
  ENGINE_ANALYSIS_RESULT: 'engine:analysis-result',
  ENGINE_ANALYSIS_ERROR: 'engine:analysis-error',
  ENGINE_ANALYSIS_CANCEL: 'engine:analysis-cancel',
  // 引擎設定/狀態（invoke）
  ENGINE_STATUS: 'engine:status',
  ENGINE_GET_PATH: 'engine:getPath',
  ENGINE_SET_PATH: 'engine:setPath',
  ENGINE_BROWSE_PATH: 'engine:browsePath',
  ENGINE_TEST: 'engine:test',
  ENGINE_REGISTRY_LIST: 'engine:registry:list',
  ENGINE_REGISTRY_ADD: 'engine:registry:add',
  ENGINE_REGISTRY_REMOVE: 'engine:registry:remove',
  ENGINE_REGISTRY_SELECT: 'engine:registry:select',
  ENGINE_REGISTRY_TEST: 'engine:registry:test',
  // AI 解釋 streaming（§2.17.2）
  AI_GENERATE_EXPLANATION_START: 'ai:generate-explanation:start',
  AI_GENERATE_EXPLANATION_CHUNK: 'ai:generate-explanation:chunk',
  AI_GENERATE_EXPLANATION_DONE: 'ai:generate-explanation:done',
  AI_GENERATE_EXPLANATION_ERROR: 'ai:generate-explanation:error',
  AI_GENERATE_EXPLANATION_CANCEL: 'ai:generate-explanation:cancel',
  AI_HARNESS_CONTINUE: 'ai:harness:continue',
  AI_HARNESS_PROGRESS: 'ai:harness:progress',
  AI_HARNESS_TRACE_LIST: 'ai:harness:trace:list',
  AI_HARNESS_TRACE_CLEAR: 'ai:harness:trace:clear',
  AI_HARNESS_TRACE_EXPORT: 'ai:harness:trace:export',
  AI_HARNESS_TRACE_FEEDBACK: 'ai:harness:trace:feedback',
  // 永久資料與備份
  DATA_LOAD: 'data:load',
  DATA_SAVE: 'data:save',
  DATA_EXPORT: 'data:export',
  DATA_IMPORT: 'data:import',
  // 安全儲存 (SecretStore)
  SECRET_SET: 'secret:set',
  SECRET_STATUS: 'secret:status',
  SECRET_DELETE: 'secret:delete',
  SECRET_IS_AVAILABLE: 'secret:isAvailable',
  // 買斷授權 (License Key，SDS Q5)
  LICENSE_STATUS: 'license:status',
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_DEACTIVATE: 'license:deactivate',
  // 應用程式更新
  APP_UPDATE_STATUS: 'app-update:status',
  APP_UPDATE_CHECK: 'app-update:check',
  APP_UPDATE_DOWNLOAD: 'app-update:download',
  APP_UPDATE_INSTALL: 'app-update:install',
  APP_UPDATE_CHANGED: 'app-update:changed'
} as const

/* ---------- 引擎分析 payload（§2.16.3） ---------- */

export interface AnalyzePositionStartPayload {
  /** renderer 生成；analysisId 由 main 生成（§2.16.4） */
  requestId: string
  engineId?: string
  verificationEngineId?: string
  positionFen: string
  userMove?: string
  analysisConfig: AnalysisConfig
}

export interface EngineAnalysisResultPayload {
  requestId: string
  analysisId: string
  engineAnalysis: EngineAnalysis
  verificationEngineAnalysis?: EngineAnalysis
  engineDisagreement?: boolean
  moveComparison: MoveComparisonResult
}

export type EngineAnalysisProgressPhase =
  | 'preparing_engine'
  | 'root_analysis'
  | 'user_move_analysis'
  | 'finalizing'

export interface EngineAnalysisProgressPayload {
  requestId: string
  phase: EngineAnalysisProgressPhase
  elapsedMs: number
  targetMs: number | null
  percent: number
  depth: number | null
  score: EngineScore | null
  displayMove?: string
  displayPrincipalVariation: string[]
}

export type EngineAnalysisErrorCode =
  | 'invalid_fen'
  | 'invalid_analysis_config'
  | 'invalid_user_move'
  | 'engine_not_configured'
  | 'engine_start_failed'
  | 'engine_timeout'
  | 'engine_parse_error'
  | 'session_store_failed'
  | 'cancelled'
  | 'unknown_error'

export interface EngineAnalysisErrorPayload {
  requestId: string
  code: EngineAnalysisErrorCode
  message: string
  diagnostics?: string[]
}

/* ---------- 引擎狀態 / 測試 ---------- */

/** 引擎可用性狀態 */
export interface EngineStatus {
  engineId?: string
  available: boolean
  engineName: string
  message?: string
  pathSource?: 'user' | 'env' | 'resource' | null
  resolvedPath?: string | null
  /** 已偵測（或儲存）的引擎協定；null 表示尚未偵測 */
  protocol?: EngineProtocol | null
}

/** 引擎連線測試結果（engine:test） */
export interface EngineTestResult {
  ok: boolean
  protocol?: EngineProtocol
  engineName?: string
  message?: string
  diagnostics?: string[]
  capabilities?: {
    multiPv: boolean
    configurableThreads: boolean
    configurableHash: boolean
  }
}

export interface SecretStatus {
  configured: boolean
  provider: AIProviderId | null
}

/* ---------- AI 解釋 streaming（§2.17.3） ---------- */

/**
 * renderer 發起 AI 解釋的 payload。
 * 依 §2.17.3 不得包含 engineAnalysis / moveComparison；
 * 分析資料只透過 analysisId 由 main 自 AnalysisSessionStore 查出。
 * language 為本專案擴充欄位（SDS 未定義）。
 */
export interface GenerateExplanationStartPayload {
  requestId: string
  analysisId: string
  provider: AIProviderId
  model: string
  userLevel: UserLevel
  explanationStyle: ExplanationStyle
  language: ExplanationLanguage
  /** 同一局面的既有對話，視為不可信的使用者資料 */
  conversationHistory?: ConversationMessage[]
  /** 多輪追問內容；未提供時產生初次長篇解說 */
  followUpQuestion?: string
  attachedMove?: string
  answerMode?: HarnessAnswerMode
  budget?: HarnessBudget
  engineId?: string
  verificationEngineId?: string
  reuseEvidence?: boolean
}

export interface GenerateExplanationChunkPayload {
  requestId: string
  deltaText: string
}

export interface GenerateExplanationDonePayload {
  requestId: string
  finalText: string
  usage?: TokenUsage
  evidence?: HarnessEvidence[]
  warnings?: string[]
  traceId?: string
  clarificationRequired?: boolean
}

export type AIExplanationErrorCode =
  | 'invalid_request'
  | 'missing_api_key'
  | 'unsupported_model'
  | 'analysis_session_not_found'
  | 'provider_error'
  | 'network_error'
  | 'rate_limited'
  | 'cancelled'
  | 'unknown_error'

export interface GenerateExplanationErrorPayload {
  requestId: string
  code: AIExplanationErrorCode
  message: string
}

/* ---------- 永久資料與備份 ---------- */

export type DataLoadResult =
  | { ok: true; snapshot: AppDataSnapshot }
  | { ok: false; message: string }

export type DataSaveResult = { ok: true } | { ok: false; message: string }

export type DataExportResult =
  | { ok: true; filePath: string }
  | { ok: false; cancelled?: boolean; message?: string }

export type DataImportResult =
  | {
      ok: true
      snapshot: AppDataSnapshot
      summary: AppDataImportSummary
    }
  | { ok: false; cancelled?: boolean; message?: string }

export type HarnessTraceExportResult =
  | { ok: true; filePath: string }
  | { ok: false; cancelled?: boolean; message?: string }

/* ---------- preload API 形狀 ---------- */

export interface RendererApi {
  engine: {
    /** 開始分析（事件式）；結果經 onAnalysisResult / onAnalysisError 回傳 */
    startAnalysis(payload: AnalyzePositionStartPayload): void
    /** 訂閱分析結果；回傳取消訂閱函式 */
    onAnalysisResult(listener: (payload: EngineAnalysisResultPayload) => void): () => void
    /** 訂閱搜尋中的即時深度、評估與主要變例 */
    onAnalysisProgress(
      listener: (payload: EngineAnalysisProgressPayload) => void
    ): () => void
    /** 訂閱分析錯誤；回傳取消訂閱函式 */
    onAnalysisError(listener: (payload: EngineAnalysisErrorPayload) => void): () => void
    /** 取消進行中的分析 */
    cancelAnalysis(requestId: string): void
    status(): Promise<EngineStatus>
    getPath(): Promise<string | null>
    setPath(path: string | null): Promise<EngineStatus>
    browsePath(): Promise<string | null>
    test(): Promise<EngineTestResult>
    listInstallations(): Promise<EngineRegistrySnapshot>
    addInstallation(input: {
      profileId: EngineProfileId
      displayName?: string
      executablePath: string
    }): Promise<EngineInstallation>
    removeInstallation(id: string): Promise<EngineRegistrySnapshot>
    selectInstallation(
      activeEngineId: string,
      verificationEngineId?: string | null
    ): Promise<EngineRegistrySnapshot>
    testInstallation(id: string): Promise<EngineTestResult>
  }
  ai: {
    /** 開始 streaming 生成（§2.17.2）；結果經 onExplanation* 事件回傳 */
    startExplanation(payload: GenerateExplanationStartPayload): void
    /** 訂閱部分文字；回傳取消訂閱函式 */
    onExplanationChunk(
      listener: (payload: GenerateExplanationChunkPayload) => void
    ): () => void
    /** 訂閱完成事件；回傳取消訂閱函式 */
    onExplanationDone(
      listener: (payload: GenerateExplanationDonePayload) => void
    ): () => void
    /** 訂閱錯誤事件；回傳取消訂閱函式 */
    onExplanationError(
      listener: (payload: GenerateExplanationErrorPayload) => void
    ): () => void
    onHarnessProgress(
      listener: (payload: HarnessProgressPayload) => void
    ): () => void
    listHarnessTraces(): Promise<import('./Harness').HarnessTrace[]>
    clearHarnessTraces(): Promise<{ ok: true }>
    exportHarnessTraces(): Promise<HarnessTraceExportResult>
    setHarnessFeedback(
      traceId: string,
      feedback: NonNullable<import('./Harness').HarnessTrace['feedback']>
    ): Promise<{ ok: true }>
    /** 取消進行中的生成 */
    cancelExplanation(requestId: string): void
    /** Harness 停滯等待時，允許繼續加深研究 */
    continueExplanation(requestId: string): void
  }
  data: {
    load(): Promise<DataLoadResult>
    save(snapshot: AppDataSnapshot): Promise<DataSaveResult>
    exportBackup(): Promise<DataExportResult>
    importBackup(): Promise<DataImportResult>
  }
  secret: {
    set(apiKey: string): Promise<{ ok: boolean; provider: AIProviderId }>
    status(): Promise<SecretStatus>
    delete(): Promise<{ ok: boolean }>
    isAvailable(): Promise<boolean>
  }
  license: {
    status(): Promise<LicenseStatus>
    /** 驗證並啟用 License Key；失敗時回傳 activated=false + message */
    activate(licenseKey: string): Promise<LicenseStatus>
    deactivate(): Promise<LicenseStatus>
  }
  update: {
    status(): Promise<AppUpdateStatus>
    check(): Promise<AppUpdateStatus>
    download(): Promise<AppUpdateStatus>
    install(): Promise<AppUpdateStatus>
    onChanged(listener: (status: AppUpdateStatus) => void): () => void
  }
}

export type { TokenUsage }

declare global {
  interface Window {
    api: RendererApi
  }
}
