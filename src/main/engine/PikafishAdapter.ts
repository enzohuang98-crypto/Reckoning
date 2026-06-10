/**
 * Pikafish 介面 (PikafishAdapter)
 *
 * Pikafish 為「本機 UCI 象棋引擎」（非雲端 API）。
 * 本類別以子行程驅動 Pikafish 可執行檔，透過 UCI 協定取得分析結果。
 *
 * 二進位檔尋找順序：
 *   1. 環境變數 PIKAFISH_PATH
 *   2. <resources>/engine/pikafish.exe（打包後）
 * 若找不到，isAvailable() 回 false，analyze() 拋出明確錯誤，
 * 由上層 IPC 轉成 renderer 可顯示的訊息。MVP 不內含二進位檔。
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

function resolveEnginePath(): string | null {
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

export class PikafishAdapter {
  private readonly enginePath: string | null

  constructor(enginePath: string | null = resolveEnginePath()) {
    this.enginePath = enginePath
  }

  get engineName(): string {
    return ENGINE_NAME
  }

  isAvailable(): boolean {
    return this.enginePath !== null
  }

  /**
   * 分析單一局面。回傳完整 EngineAnalysis。
   * 若引擎不可用則拋出 EngineUnavailableError。
   */
  async analyze(request: EngineAnalysisRequest): Promise<EngineAnalysis> {
    if (!this.enginePath) {
      throw new EngineUnavailableError(
        '找不到 Pikafish 引擎。請設定 PIKAFISH_PATH 環境變數或放置 resources/engine/pikafish.exe。'
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
        child = spawn(this.enginePath as string, [], { windowsHide: true })
      } catch (err) {
        reject(new EngineUnavailableError(`無法啟動 Pikafish：${String(err)}`))
        return
      }

      let buffer = ''
      let bestMoveUci: string | null = null
      let settled = false

      const cleanup = (): void => {
        try {
          child.stdin.write('quit\n')
        } catch {
          /* ignore */
        }
        child.kill()
      }

      const finish = (): void => {
        if (settled) return
        settled = true
        const lines = accumulator.getLines()
        const best: EngineLine | undefined =
          lines.find((l) => l.multipv === 1) ?? lines[0]
        if (!best) {
          cleanup()
          reject(new Error('引擎未回傳任何候選線'))
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

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line) continue
          accumulator.ingestLine(line)
          const bm = parseBestMove(line)
          if (bm !== null) {
            bestMoveUci = bm
            finish()
          }
        }
      })

      child.on('error', (err) => {
        if (settled) return
        settled = true
        reject(new EngineUnavailableError(`Pikafish 行程錯誤：${err.message}`))
      })

      child.on('exit', () => finish())

      // 驅動 UCI 流程
      const go = request.movetimeMs
        ? `go movetime ${request.movetimeMs}`
        : `go depth ${request.depth ?? 15}`
      const commands = [
        'uci',
        'isready',
        `setoption name MultiPV value ${multiPv}`,
        `position fen ${request.fen}`,
        go
      ]
      child.stdin.write(commands.join('\n') + '\n')

      // 安全逾時
      setTimeout(() => finish(), (request.movetimeMs ?? 30000) + 15000)
    })
  }
}
