/**
 * Pikafish 介面 (PikafishAdapter)
 *
 * Pikafish 為「本機 UCI 象棋引擎」（非雲端 API）。
 * 本類別以子行程驅動 Pikafish 可執行檔，透過 UCI 協定取得分析結果。
 *
 * 二進位檔尋找順序：
 *   1. 使用者於設定頁指定並由 StorageService 持久化的路徑（userPath）
 *   2. 環境變數 PIKAFISH_PATH
 *   3. <resources>/engine/pikafish.exe（打包後）
 * 若找不到，isAvailable() 回 false，analyze() 拋出明確錯誤，
 * 由上層 IPC 轉成 renderer 可顯示的訊息。MVP 不內含二進位檔。
 *
 * UCI 握手採「分段等待」：先送 uci 等 uciok，再送 isready 等 readyok，
 * 確認引擎就緒後才送 position / go，避免對未就緒引擎送出指令。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  EngineAnalysis,
  EngineAnalysisRequest,
  EngineLine
} from '@shared/types/EngineAnalysis'
import { parseFen } from '@shared/logic/fen'
import { MultiPvAccumulator, parseBestMove } from './EngineOutputParser'

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineUnavailableError'
  }
}

const ENGINE_NAME = 'Pikafish'

/** 由環境變數 / 打包資源解析引擎路徑（不含使用者自訂路徑） */
function resolveBundledEnginePath(): string | null {
  const fromEnv = process.env.PIKAFISH_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const resourceCandidates = [
    join(process.resourcesPath ?? '', 'engine', 'pikafish.exe'),
    join(process.cwd(), 'resources', 'engine', 'pikafish.exe')
  ]
  for (const candidate of resourceCandidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

/** 引擎路徑來源，供 UI 提示用 */
export type EnginePathSource = 'user' | 'env' | 'resource' | null

export class PikafishAdapter {
  /** 使用者於設定頁指定的路徑（最高優先；可為 null） */
  private userPath: string | null

  constructor(userPath: string | null = null) {
    this.userPath = userPath
  }

  get engineName(): string {
    return ENGINE_NAME
  }

  /** 設定（或清除）使用者自訂引擎路徑。傳入 null / 空字串代表清除。 */
  setUserPath(path: string | null): void {
    const trimmed = path?.trim()
    this.userPath = trimmed ? trimmed : null
  }

  /** 取得使用者自訂路徑（未設定回 null） */
  getUserPath(): string | null {
    return this.userPath
  }

  /** 實際會使用的引擎路徑（依優先序解析）；找不到回 null。 */
  resolveEnginePath(): string | null {
    if (this.userPath && existsSync(this.userPath)) return this.userPath
    return resolveBundledEnginePath()
  }

  /** 目前生效路徑的來源，供 UI 顯示。 */
  pathSource(): EnginePathSource {
    if (this.userPath && existsSync(this.userPath)) return 'user'
    const fromEnv = process.env.PIKAFISH_PATH
    if (fromEnv && existsSync(fromEnv)) return 'env'
    if (resolveBundledEnginePath()) return 'resource'
    return null
  }

  isAvailable(): boolean {
    return this.resolveEnginePath() !== null
  }

  /**
   * 分析單一局面。回傳完整 EngineAnalysis。
   * 若引擎不可用則拋出 EngineUnavailableError。
   */
  async analyze(request: EngineAnalysisRequest): Promise<EngineAnalysis> {
    const enginePath = this.resolveEnginePath()
    if (!enginePath) {
      throw new EngineUnavailableError(
        '找不到 Pikafish 引擎。請至設定頁指定引擎路徑，或設定 PIKAFISH_PATH 環境變數 / 放置 resources/engine/pikafish.exe。'
      )
    }

    const parsed = parseFen(request.fen)
    if (!parsed.valid) {
      throw new Error(`無效的 FEN：${parsed.message}`)
    }
    const sideToMove = parsed.board.sideToMove

    const multiPv = Math.max(1, request.multiPv ?? 1)
    const accumulator = new MultiPvAccumulator()

    return new Promise<EngineAnalysis>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(enginePath, [], { windowsHide: true })
      } catch (err) {
        reject(new EngineUnavailableError(`無法啟動 Pikafish：${String(err)}`))
        return
      }

      let buffer = ''
      let bestMoveUci: string | null = null
      let settled = false
      /** 握手狀態機：init → uciok 後送 isready → readyok 後送 position/go */
      let phase: 'awaiting-uciok' | 'awaiting-readyok' | 'searching' = 'awaiting-uciok'

      const send = (cmd: string): void => {
        try {
          child.stdin.write(cmd + '\n')
        } catch {
          /* 行程可能已結束，忽略 */
        }
      }

      const cleanup = (): void => {
        send('quit')
        child.kill()
      }

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      }

      const finish = (): void => {
        if (settled) return
        settled = true
        const lines = accumulator.getLines()
        const best: EngineLine | undefined =
          lines.find((l) => l.multipv === 1) ?? lines[0]
        if (!best) {
          cleanup()
          reject(new Error('引擎未回傳任何候選線（可能 FEN 不合法或引擎異常）'))
          return
        }
        const analysis: EngineAnalysis = {
          fen: request.fen,
          sideToMove,
          depth: best.depth,
          bestMoveUci: bestMoveUci ?? best.bestMoveUci,
          bestLine: best,
          lines,
          score: best.score,
          engineName: ENGINE_NAME,
          computedAt: Date.now()
        }
        cleanup()
        resolve(analysis)
      }

      const startSearch = (): void => {
        phase = 'searching'
        const go = request.movetimeMs
          ? `go movetime ${request.movetimeMs}`
          : `go depth ${request.depth ?? 15}`
        send(`position fen ${request.fen}`)
        send(go)
      }

      const handleLine = (line: string): void => {
        // 握手推進：依目前 phase 對 uciok / readyok 反應
        if (phase === 'awaiting-uciok' && line === 'uciok') {
          phase = 'awaiting-readyok'
          send(`setoption name MultiPV value ${multiPv}`)
          send('isready')
          return
        }
        if (phase === 'awaiting-readyok' && line === 'readyok') {
          startSearch()
          return
        }

        // 搜尋結果累積
        accumulator.ingestLine(line)
        const bm = parseBestMove(line)
        if (bm !== null) {
          bestMoveUci = bm
          finish()
        }
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const rawLine = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!rawLine) continue
          handleLine(rawLine)
        }
      })

      child.on('error', (err) => {
        fail(new EngineUnavailableError(`Pikafish 行程錯誤：${err.message}`))
      })

      child.on('exit', () => finish())

      // 啟動握手
      send('uci')

      // 安全逾時：握手 + 搜尋總時長上限
      setTimeout(() => {
        if (phase === 'searching') {
          // 已在搜尋，停手取目前最佳結果
          send('stop')
          finish()
        } else {
          fail(
            new EngineUnavailableError(
              '引擎握手逾時（未在時限內回應 uciok/readyok），請確認指定的檔案為有效的 Pikafish 可執行檔。'
            )
          )
        }
      }, (request.movetimeMs ?? 30000) + 15000)
    })
  }
}
