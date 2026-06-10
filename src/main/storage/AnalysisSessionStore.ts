/**
 * 分析工作階段儲存 (AnalysisSessionStore)
 *
 * 保存使用者的分析工作階段（局面 + 引擎分析 + AI 解釋）於 userData 下的 JSON 檔。
 * MVP 階段提供基本 CRUD；錯題本主要存於 renderer 的 localStorage（依 Q2），
 * 此 store 作為主行程側的可選持久化（例如較大的引擎結果快取）。
 */

import { randomUUID } from 'node:crypto'
import type { EngineAnalysis } from '@shared/types/EngineAnalysis'
import type { AIExplanationResponse } from '@shared/types/AIExplanationTypes'
import { StorageService } from './StorageService'

export interface AnalysisSession {
  id: string
  createdAt: number
  fen: string
  engineAnalysis?: EngineAnalysis
  explanation?: AIExplanationResponse
  label?: string
}

interface SessionsFile {
  sessions: AnalysisSession[]
  version: number
}

const SESSIONS_FILENAME = 'analysis_sessions.json'

export class AnalysisSessionStore {
  private readonly storage: StorageService

  constructor(storage: StorageService = new StorageService()) {
    this.storage = storage
  }

  list(): AnalysisSession[] {
    return this.load().sessions
  }

  get(id: string): AnalysisSession | undefined {
    return this.load().sessions.find((s) => s.id === id)
  }

  create(input: Omit<AnalysisSession, 'id' | 'createdAt'>): AnalysisSession {
    const data = this.load()
    const session: AnalysisSession = {
      id: randomUUID(),
      createdAt: Date.now(),
      ...input
    }
    data.sessions.unshift(session)
    this.save(data)
    return session
  }

  remove(id: string): void {
    const data = this.load()
    data.sessions = data.sessions.filter((s) => s.id !== id)
    this.save(data)
  }

  private load(): SessionsFile {
    return this.storage.read<SessionsFile>(SESSIONS_FILENAME, {
      sessions: [],
      version: 1
    })
  }

  private save(data: SessionsFile): void {
    this.storage.write(SESSIONS_FILENAME, data)
  }
}
