/**
 * 分析工作階段短期快取 (AnalysisSessionStore) — SDS v0.2 §2.18
 *
 * main process 的短期分析結果儲存層：只保存近期的
 * EngineAnalysis + MoveComparisonResult，讓 AI 解釋透過 analysisId 取得
 * canonical data。它不是錯題本、不是永久資料庫，也不是多輪對話儲存層；
 * 不得儲存 API key（§2.18.6）。
 *
 * 清理策略（§2.18.4 兩層）：
 *  1. 每次 save() 前呼叫 clearExpiredSessions()
 *  2. app 啟動後以 10 分鐘間隔定時清理（startAnalysisSessionCleanup）
 */

import type { EngineAnalysis } from '@shared/types/EngineAnalysis'
import type { MoveComparisonResult } from '@shared/types/MoveComparisonResult'

/** TTL：2 小時（§2.18.3） */
export const DEFAULT_ANALYSIS_SESSION_TTL_MS = 2 * 60 * 60 * 1000

/** 定時清理間隔：10 分鐘（§2.18.4） */
export const ANALYSIS_SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000
export const MAX_ANALYSIS_SESSIONS = 100

/** 分析工作階段（§2.18.2） */
export interface AnalysisSession {
  analysisId: string
  requestId: string
  /** ISO 字串 */
  createdAt: string
  /** ISO 字串 */
  expiresAt: string
  positionFen: string
  userMove?: string
  primaryEngineId?: string
  verificationEngineId?: string
  engineAnalysis: EngineAnalysis
  verificationEngineAnalysis?: EngineAnalysis
  engineDisagreement?: boolean
  moveComparison: MoveComparisonResult
}

/** 介面（§2.18.2） */
export interface AnalysisSessionStore {
  save(session: AnalysisSession): Promise<void>
  get(analysisId: string): Promise<AnalysisSession | null>
  delete(analysisId: string): Promise<void>
  clearExpiredSessions(): Promise<void>
}

/** analysisId 找不到或過期（§2.18.5） */
export class AnalysisSessionNotFoundError extends Error {
  constructor(public readonly analysisId: string) {
    super(`Analysis session not found or expired: ${analysisId}`)
    this.name = 'AnalysisSessionNotFoundError'
  }
}

/** 第一版實作：記憶體 Map + TTL（§2.18.3） */
export class InMemoryAnalysisSessionStore implements AnalysisSessionStore {
  private readonly sessions = new Map<string, AnalysisSession>()

  async save(session: AnalysisSession): Promise<void> {
    await this.clearExpiredSessions() // save() 前先清理（§2.18.4）
    this.sessions.set(session.analysisId, session)
    this.trimOldestSessions()
  }

  async get(analysisId: string): Promise<AnalysisSession | null> {
    const session = this.sessions.get(analysisId)
    if (!session) return null
    if (Date.now() > Date.parse(session.expiresAt)) {
      this.sessions.delete(analysisId)
      return null
    }
    return session
  }

  async delete(analysisId: string): Promise<void> {
    this.sessions.delete(analysisId)
  }

  async clearExpiredSessions(): Promise<void> {
    const now = Date.now()
    for (const [id, s] of this.sessions.entries()) {
      if (now > Date.parse(s.expiresAt)) this.sessions.delete(id)
    }
    this.trimOldestSessions()
  }

  private trimOldestSessions(): void {
    if (this.sessions.size <= MAX_ANALYSIS_SESSIONS) return
    const ordered = [...this.sessions.entries()].sort(
      ([, a], [, b]) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    )
    for (const [id] of ordered.slice(0, this.sessions.size - MAX_ANALYSIS_SESSIONS)) {
      this.sessions.delete(id)
    }
  }
}

/** 啟動 10 分鐘定時清理；回傳停止函式 */
export function startAnalysisSessionCleanup(store: AnalysisSessionStore): () => void {
  const timer = setInterval(() => {
    void store.clearExpiredSessions()
  }, ANALYSIS_SESSION_CLEANUP_INTERVAL_MS)
  // app 結束時不需要 timer 阻止行程退出
  timer.unref?.()
  return () => clearInterval(timer)
}
