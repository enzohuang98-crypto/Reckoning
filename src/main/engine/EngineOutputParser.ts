/**
 * 引擎輸出解析器 (EngineOutputParser) — SDS v0.2 §2.14
 *
 * 將引擎 stdout 文字行解析為結構化資料。
 * 同時支援 UCI（score cp/mate <n>，如 Pikafish）與
 * UCCI（score <n> 裸數值，如象棋小蟲/旋風/名手/烏雲）兩種 info 格式。
 *
 * 規則重點（§2.14.7）：
 *  - convertCpScore / convertMateScore 必須回傳 wasInverted 與 source。
 *  - mateIn === 0 必須有獨立 terminal case。
 *  - Parser 階段不得取負號；視角反轉只由 PikafishAdapter 的 invertEngineScore 負責。
 *  - 不得讓 Infinity / -Infinity 進入 EngineScore。
 *  - raw 只供 debug，不得供 UI、PromptBuilder、MoveComparisonService 或分級邏輯使用。
 *
 * 純函式，便於單元測試，不持有任何子行程。
 */

import {
  MATE_SCORE,
  type EngineCandidateMove,
  type EngineScore,
  type ScoreSource
} from '@shared/types/EngineAnalysis'

/** cp 分數轉 EngineScore（§2.14.2） */
export function convertCpScore(
  cp: number,
  raw: string,
  source: ScoreSource = 'root_analysis'
): EngineScore {
  const value = cp / 100
  return {
    type: 'cp',
    cp,
    value,
    comparableValue: value,
    raw,
    displayText: value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2),
    wasInverted: false,
    source
  }
}

/** mate 分數轉 EngineScore，含 mate 0 terminal case（§2.14.3） */
export function convertMateScore(
  mateIn: number,
  raw: string,
  source: ScoreSource = 'root_analysis'
): EngineScore {
  if (mateIn === 0) {
    // 未反轉語義：目前分析局面的行棋方已被將死
    return {
      type: 'mate',
      mateIn: 0,
      comparableValue: -MATE_SCORE,
      raw,
      displayText: '已被將死',
      isTerminalMate: true,
      wasInverted: false,
      source
    }
  }
  const sign = mateIn > 0 ? 1 : -1
  const distancePenalty = Math.min(Math.abs(mateIn), 100)
  const comparableValue = sign * (MATE_SCORE - distancePenalty)
  return {
    type: 'mate',
    mateIn,
    comparableValue,
    raw,
    displayText: mateIn > 0 ? `殺 ${mateIn}` : `被殺 ${Math.abs(mateIn)}`,
    isTerminalMate: false,
    wasInverted: false,
    source
  }
}

/** 單行 info 的解析結果（內部結構，由 accumulator 聚合成 EngineCandidateMove） */
export interface ParsedInfoLine {
  multipv: number
  depth: number | null
  /** 解析失敗或缺失為 null（§2.14.6「無效 score」） */
  score: EngineScore | null
  pv: string[]
}

/**
 * 解析單行 `info ...`。
 * 至少要有 score 或 pv 其中之一才視為有效（mate 0 終局行沒有 pv）。
 */
export function parseInfoLine(
  line: string,
  source: ScoreSource = 'root_analysis'
): ParsedInfoLine | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('info ')) return null
  const tokens = trimmed.split(/\s+/)

  let depth: number | null = null
  let multipv = 1
  let score: EngineScore | null = null
  let pv: string[] = []

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    switch (token) {
      case 'depth': {
        const d = Number(tokens[i + 1])
        if (Number.isFinite(d)) depth = d
        i += 1
        break
      }
      case 'multipv': {
        const m = Number(tokens[i + 1])
        if (Number.isFinite(m)) multipv = m
        i += 1
        break
      }
      case 'score': {
        const kind = tokens[i + 1]
        if (kind === 'cp' || kind === 'mate') {
          const n = Number(tokens[i + 2])
          // 防 Infinity / NaN 進入 EngineScore（§2.14.7）
          if (Number.isFinite(n)) {
            const raw = `score ${kind} ${tokens[i + 2]}`
            score = kind === 'cp' ? convertCpScore(n, raw, source) : convertMateScore(n, raw, source)
          }
          i += 2
        } else if (kind !== undefined && Number.isFinite(Number(kind))) {
          // UCCI：score <n>（裸數值，視為 centipawn）
          score = convertCpScore(Number(kind), `score ${kind}`, source)
          i += 1
        }
        break
      }
      case 'pv':
        pv = tokens.slice(i + 1)
        i = tokens.length
        break
      default:
        // 忽略其他欄位 (seldepth, nodes, nps, time, hashfull, currmove, ...)
        break
    }
  }

  if (score === null && pv.length === 0) return null
  return { multipv, depth, score, pv }
}

/** 從 `bestmove xxxx [ponder yyyy]` 取出最佳著法；(none)/nobestmove 回 null */
export function parseBestMove(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('bestmove')) return null
  const tokens = trimmed.split(/\s+/)
  const move = tokens[1]
  if (!move || move === '(none)') return null
  return move
}

/**
 * 累積器：在串流多行 info 時，保留每個 multipv 的最新（最深）一行，
 * 最後輸出依 multipv 排序的 EngineCandidateMove（§2.6.2）。
 */
export class MultiPvAccumulator {
  private readonly byMultiPv = new Map<number, ParsedInfoLine>()
  private readonly source: ScoreSource

  constructor(source: ScoreSource = 'root_analysis') {
    this.source = source
  }

  ingestLine(line: string): void {
    const parsed = parseInfoLine(line, this.source)
    if (!parsed) return
    const existing = this.byMultiPv.get(parsed.multipv)
    if (!existing || (parsed.depth ?? 0) >= (existing.depth ?? 0)) {
      this.byMultiPv.set(parsed.multipv, parsed)
    }
  }

  /** 取得依 multipv 排序（1 為最佳）的候選著法；無著法的行（mate 0 終局）不列入 */
  getCandidateMoves(): EngineCandidateMove[] {
    return [...this.byMultiPv.values()]
      .sort((a, b) => a.multipv - b.multipv)
      .filter((l) => l.pv.length > 0)
      .map((l) => ({
        move: l.pv[0],
        score: l.score,
        evaluation: l.score === null ? null : l.score.comparableValue,
        depth: l.depth,
        principalVariation: l.pv
      }))
  }

  /** 最佳行（multipv 最小）的分數，包含無 pv 的 mate 0 終局行 */
  getTopScore(): EngineScore | null {
    const lines = [...this.byMultiPv.values()].sort((a, b) => a.multipv - b.multipv)
    return lines[0]?.score ?? null
  }

  clear(): void {
    this.byMultiPv.clear()
  }
}
