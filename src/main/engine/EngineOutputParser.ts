/**
 * 引擎輸出解析器 (EngineOutputParser)
 *
 * 將引擎 stdout 文字行解析為結構化資料。
 * 同時支援 UCI（score cp/mate <n>，如 Pikafish）與
 * UCCI（score <n> 裸數值，如象棋小蟲/旋風/名手/烏雲）兩種 info 格式。
 * 純函式，便於單元測試，不持有任何子行程。
 */

import type { EngineLine, EngineScore } from '@shared/types/EngineAnalysis'

/** 解析單行 `info ...` 為 EngineLine（無法解析時回傳 null） */
export function parseInfoLine(line: string): EngineLine | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('info ')) return null
  const tokens = trimmed.split(/\s+/)

  let depth: number | undefined
  let selDepth: number | undefined
  let multipv = 1
  let score: EngineScore | undefined
  let nodes: number | undefined
  let nps: number | undefined
  let timeMs: number | undefined
  let pv: string[] = []

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    switch (token) {
      case 'depth':
        depth = Number(tokens[++i])
        break
      case 'seldepth':
        selDepth = Number(tokens[++i])
        break
      case 'multipv':
        multipv = Number(tokens[++i])
        break
      case 'nodes':
        nodes = Number(tokens[++i])
        break
      case 'nps':
        nps = Number(tokens[++i])
        break
      case 'time':
        timeMs = Number(tokens[++i])
        break
      case 'score': {
        const next = tokens[i + 1]
        if (next === 'cp' || next === 'mate') {
          // UCI：score cp <n> / score mate <n>
          score = { kind: next, value: Number(tokens[i + 2]) }
          i += 2
        } else if (next !== undefined && Number.isFinite(Number(next))) {
          // UCCI：score <n>（裸數值，視為厘子分）
          score = { kind: 'cp', value: Number(next) }
          i += 1
        }
        break
      }
      case 'pv':
        pv = tokens.slice(i + 1)
        i = tokens.length
        break
      default:
        // 忽略其他欄位 (hashfull, tbhits, currmove, ...)
        break
    }
  }

  // 一行至少要有分數與深度才視為有效候選線
  if (score === undefined || depth === undefined || pv.length === 0) return null

  return {
    multipv,
    depth,
    selDepth,
    score,
    nodes,
    nps,
    timeMs,
    pv,
    bestMoveUci: pv[0]
  }
}

/** 從 `bestmove xxxx [ponder yyyy]` 取出最佳著法 */
export function parseBestMove(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('bestmove')) return null
  const tokens = trimmed.split(/\s+/)
  const move = tokens[1]
  if (!move || move === '(none)') return null
  return move
}

/**
 * 累積器：在串流多行 info 時，保留每個 multipv 的最新（最深）一行。
 */
export class MultiPvAccumulator {
  private readonly byMultiPv = new Map<number, EngineLine>()

  ingestLine(line: string): void {
    const parsed = parseInfoLine(line)
    if (!parsed) return
    const existing = this.byMultiPv.get(parsed.multipv)
    if (!existing || parsed.depth >= existing.depth) {
      this.byMultiPv.set(parsed.multipv, parsed)
    }
  }

  /** 取得依 multipv 排序（1 為最佳）的候選線 */
  getLines(): EngineLine[] {
    return [...this.byMultiPv.values()].sort((a, b) => a.multipv - b.multipv)
  }

  clear(): void {
    this.byMultiPv.clear()
  }
}
