/**
 * 產生 P3-9 的「保留驗證集」（tests/fixtures/explain-v2/holdout-cases.json，不納入 npm test 的產生步驟）。
 *
 * 來源是 repo 裡已用 Pikafish 實際分析過的 PlayOK 對局局面（soak／full engine baseline）：
 * 這些局面從來沒拿來調整 v2 的 prompt、事實表或檢查，只用來確認改進不是只對 10 題固定題目有效。
 * 不需要引擎，也不連網；同一個 seed 每次產生相同的題目。
 *
 * 用法：npx tsx --tsconfig tsconfig.node.json tools/acceptance/build-holdout-cases.ts [--seed holdout-v1]
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseFen } from '../../src/shared/logic/board/fen'
import { formatChineseMove } from '../../src/shared/logic/board/ChineseNotation'
import { classifyMistakeLevel } from '../../src/shared/logic/analysis/MoveComparisonService'
import type { EngineAnalysis, EngineScore } from '../../src/shared/types/EngineAnalysis'
import type { MistakeLevel } from '../../src/shared/types/MoveComparisonResult'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOURCES = [
  'tests/fixtures/playok/soak-engine-baseline.json',
  'tests/fixtures/playok/full-engine-baseline.json'
]
export const HOLDOUT_PATH = resolve(repoRoot, 'tests/fixtures/explain-v2/holdout-cases.json')

/** 太懸殊的局面（例如 +24 兵）講不出教學重點，demo 也不具代表性。 */
const MAX_ABS_EVAL = 6
const MIN_BEST_LINE = 4
const MIN_USER_LINE = 3
const MIN_PLY = 8

interface BaselineScore {
  type: 'cp' | 'mate'
  cp?: number
  mateIn?: number
  comparableValue: number
  displayText: string
}

interface BaselinePosition {
  gameId: string
  ply: number
  preMoveFen: string
  actualMove: { uci: string }
  primary: {
    status: string
    bestMove: { uci: string }
    bestLine: { uci: string[] }
    actualLine: { uci: string[] }
    bestScore: BaselineScore | null
    actualScore: BaselineScore | null
    depth: number | null
    incomplete: boolean
    error: unknown
  }
}

export interface HoldoutCase {
  id: string
  mode: 'move' | 'position' | 'question'
  language: 'zh-TW'
  question?: string
  analysis: EngineAnalysis
}

/** 每種情況要幾題：涵蓋走對、各級錯誤與一題追問，共 10 題。 */
const QUOTA: Array<{ key: string; count: number }> = [
  { key: 'best', count: 1 },
  { key: 'acceptable_or_tiny_inaccuracy', count: 1 },
  { key: 'inaccuracy', count: 2 },
  { key: 'mistake', count: 2 },
  { key: 'serious_mistake', count: 2 },
  { key: 'major_blunder', count: 1 },
  { key: 'question', count: 1 }
]
const QUESTION = '為什麼引擎不建議我這一步？'

function toEngineScore(score: BaselineScore, source: 'root_analysis' | 'candidate_move'): EngineScore {
  if (score.type === 'mate') {
    return {
      type: 'mate',
      mateIn: score.mateIn ?? 0,
      comparableValue: score.comparableValue,
      raw: `score mate ${score.mateIn ?? 0}`,
      displayText: score.displayText,
      isTerminalMate: false,
      wasInverted: false,
      source
    }
  }
  const cp = score.cp ?? Math.round(score.comparableValue * 100)
  return {
    type: 'cp',
    cp,
    value: cp / 100,
    comparableValue: score.comparableValue,
    raw: `score cp ${cp}`,
    displayText: String(cp),
    wasInverted: false,
    source
  }
}

function displayMove(fen: string, move: string): string {
  const parsed = parseFen(fen)
  return (parsed.valid ? formatChineseMove(parsed.board, move) : null) ?? move
}

function toAnalysis(position: BaselinePosition, userIsBest: boolean): EngineAnalysis {
  const { primary } = position
  const parsed = parseFen(position.preMoveFen)
  if (!parsed.valid) throw new Error(`invalid FEN in ${position.gameId}#${position.ply}`)
  const best = toEngineScore(primary.bestScore!, 'root_analysis')
  const user = userIsBest ? best : toEngineScore(primary.actualScore!, 'candidate_move')
  const userMove = position.actualMove.uci
  const userLine = userIsBest ? primary.bestLine.uci : primary.actualLine.uci
  return {
    positionFen: position.preMoveFen,
    sideToMove: parsed.board.sideToMove,
    userMove,
    displayUserMove: displayMove(position.preMoveFen, userMove),
    userMovePrincipalVariation: userLine,
    scoreAfterUserMove: user,
    evaluationAfterUserMove: user.comparableValue,
    userMoveEvaluationSource: 'candidate_move',
    bestMove: primary.bestMove.uci,
    displayBestMove: displayMove(position.preMoveFen, primary.bestMove.uci),
    scoreAfterBestMove: best,
    evaluationAfterBestMove: best.comparableValue,
    depth: primary.depth,
    candidateMoves: [],
    principalVariation: primary.bestLine.uci,
    incomplete: false,
    warnings: [],
    engineId: 'pikafish-baseline',
    engineName: 'Pikafish（PlayOK 對局實際分析）'
  }
}

function usable(position: BaselinePosition): boolean {
  const { primary } = position
  if (primary.status !== 'ok' || primary.incomplete || primary.error) return false
  if (!primary.bestScore || !primary.actualScore) return false
  if (position.ply < MIN_PLY) return false
  if (primary.bestLine.uci.length < MIN_BEST_LINE || primary.actualLine.uci.length < MIN_USER_LINE) return false
  if (primary.bestScore.type !== 'cp' || primary.actualScore.type !== 'cp') return false
  return Math.abs(primary.bestScore.comparableValue) <= MAX_ABS_EVAL
}

function bucketOf(position: BaselinePosition): string {
  if (position.actualMove.uci === position.primary.bestMove.uci) return 'best'
  const gap = position.primary.bestScore!.comparableValue - position.primary.actualScore!.comparableValue
  return classifyMistakeLevel(gap) satisfies MistakeLevel
}

export function buildHoldoutCases(seed: string): HoldoutCase[] {
  const positions = SOURCES.flatMap(
    (path) => (JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as { positions: BaselinePosition[] }).positions
  )
  const seen = new Set<string>()
  const pool = positions
    .filter(usable)
    .filter((position) => {
      const key = `${position.gameId}#${position.ply}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((position) => ({
      position,
      bucket: bucketOf(position),
      rank: createHash('sha256').update(`${seed}:${position.gameId}:${position.ply}`).digest('hex')
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
  const usedGames = new Map<string, number>()
  const picked: HoldoutCase[] = []
  for (const { key, count } of QUOTA) {
    const bucket = key === 'question' ? 'inaccuracy' : key
    let taken = 0
    // 先挑還沒用過的對局，盡量分散；不夠才重複使用同一局。
    for (const pass of [0, 1, 2]) {
      for (const entry of pool) {
        if (taken >= count) break
        if (entry.bucket !== bucket) continue
        const id = `holdout-${entry.position.gameId}-${entry.position.ply}`
        if (picked.some((item) => item.id === id)) continue
        if ((usedGames.get(entry.position.gameId) ?? 0) > pass) continue
        picked.push({
          id,
          mode: key === 'question' ? 'question' : 'move',
          language: 'zh-TW',
          ...(key === 'question' ? { question: QUESTION } : {}),
          analysis: toAnalysis(entry.position, bucket === 'best')
        })
        usedGames.set(entry.position.gameId, (usedGames.get(entry.position.gameId) ?? 0) + 1)
        taken++
      }
    }
    if (taken < count) throw new Error(`not enough positions for ${key}: ${taken}/${count}`)
  }
  return picked
}

function main(): void {
  const index = process.argv.indexOf('--seed')
  const seed = index >= 0 ? process.argv[index + 1] : 'holdout-v1'
  const cases = buildHoldoutCases(seed)
  writeFileSync(HOLDOUT_PATH, `${JSON.stringify(cases, null, 2)}\n`)
  console.log(`已寫入 ${cases.length} 題保留驗證集（seed ${seed}）：${HOLDOUT_PATH}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
