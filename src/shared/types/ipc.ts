/**
 * IPC 契約型別 (IPC contract types)
 *
 * 定義 main ↔ renderer 之間的通道名稱與 preload 暴露給 renderer 的 API 形狀。
 * renderer 透過 window.api 呼叫，型別由此檔保證一致。
 */

import type {
  EngineAnalysis,
  EngineAnalysisRequest,
  EngineProtocol,
  EvaluateMoveRequest,
  MoveEvaluation
} from './EngineAnalysis'
import type { AIExplanationRequest, AIExplanationResponse } from './AIExplanationTypes'
import type { AIProviderId } from './AIProviderTypes'

/** IPC 通道名稱常數 */
export const IPC = {
  // 引擎分析
  ENGINE_ANALYZE: 'engine:analyze',
  ENGINE_STATUS: 'engine:status',
  ENGINE_GET_PATH: 'engine:getPath',
  ENGINE_SET_PATH: 'engine:setPath',
  ENGINE_BROWSE_PATH: 'engine:browsePath',
  ENGINE_TEST: 'engine:test',
  ENGINE_EVALUATE_MOVE: 'engine:evaluateMove',
  // AI 解釋
  AI_EXPLAIN: 'ai:explain',
  // 安全儲存 (SecretStore)
  SECRET_SET: 'secret:set',
  SECRET_HAS: 'secret:has',
  SECRET_DELETE: 'secret:delete',
  SECRET_IS_AVAILABLE: 'secret:isAvailable'
} as const

/** 引擎可用性狀態 */
export interface EngineStatus {
  /** 引擎可執行檔是否就緒 */
  available: boolean
  /** 引擎名稱 */
  engineName: string
  /** 若不可用的說明 */
  message?: string
  /** 目前生效路徑的來源：使用者設定 / 環境變數 / 打包資源 */
  pathSource?: 'user' | 'env' | 'resource' | null
  /** 目前生效的引擎路徑（若有） */
  resolvedPath?: string | null
  /** 已偵測（或儲存）的引擎協定；null 表示尚未偵測 */
  protocol?: EngineProtocol | null
}

/** 引擎連線測試結果（engine:test） */
export interface EngineTestResult {
  /** 是否成功完成握手（含 isready/readyok） */
  ok: boolean
  /** 偵測到的協定（成功時） */
  protocol?: EngineProtocol
  /** 引擎回報的 id name（成功時；無回報則為驅動預設名稱） */
  engineName?: string
  /** 失敗原因（失敗時） */
  message?: string
}

/**
 * preload 暴露在 window.api 的 API。
 * renderer 端僅透過這些方法與 main 溝通，從不直接接觸 Node/Electron。
 */
export interface RendererApi {
  engine: {
    analyze(request: EngineAnalysisRequest): Promise<EngineAnalysis>
    status(): Promise<EngineStatus>
    /** 取得使用者自訂的引擎路徑（未設定回 null） */
    getPath(): Promise<string | null>
    /** 設定（或以 null 清除）使用者自訂引擎路徑，回傳更新後狀態 */
    setPath(path: string | null): Promise<EngineStatus>
    /** 開啟原生檔案選擇器挑選引擎可執行檔；取消回 null（不自動儲存） */
    browsePath(): Promise<string | null>
    /** 實際啟動引擎做握手測試（自動偵測 UCI/UCCI），回傳結果與版本名 */
    test(): Promise<EngineTestResult>
    /** 評估單一著法的精確分數（猜著模式用），視角已換算回原局面輪走方 */
    evaluateMove(request: EvaluateMoveRequest): Promise<MoveEvaluation>
  }
  ai: {
    explain(request: AIExplanationRequest): Promise<AIExplanationResponse>
  }
  /**
   * 安全金鑰儲存。renderer 只能寫入/查詢是否存在/刪除，
   * 永遠無法讀回明文金鑰（金鑰只在 main 行程內解密使用）。
   */
  secret: {
    set(providerId: AIProviderId, apiKey: string): Promise<{ ok: boolean }>
    has(providerId: AIProviderId): Promise<boolean>
    delete(providerId: AIProviderId): Promise<{ ok: boolean }>
    /** 作業系統是否支援加密儲存 */
    isAvailable(): Promise<boolean>
  }
}

declare global {
  interface Window {
    api: RendererApi
  }
}
