/**
 * 引擎 adapter 端對端測試（以 tests/FakeEngine.cs 編譯的假引擎驅動）。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/engine.e2e.ts
 * （需先以 csc 編譯 fake-engine.exe，見 FakeEngine.cs 開頭說明）
 *
 * 涵蓋：UCI 握手與 MultiPV 解析、UCCI 偵測逾時 fallback、
 * 收到未知指令即退出引擎的重啟換協定、bestmove (none) 的無合法著法處理、
 * evaluateMove 的視角取負與 mate 轉換、協定偵測回呼。
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { PikafishAdapter } from '../src/main/engine/PikafishAdapter'
import { parseInfoLine } from '../src/main/engine/EngineOutputParser'
import { negateScore, scoreToCentipawns } from '../src/shared/types/EngineAnalysis'
import { basicMoveCheck, parseUciMove } from '../src/shared/logic/moves'
import { compareMove } from '../src/shared/logic/MoveComparisonService'
import { parseFen } from '../src/shared/logic/fen'
import { START_FEN } from '../src/shared/types/BoardState'

const FAKE_ENGINE = join(__dirname, 'fake-engine.exe')

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
}

function section(title: string): void {
  console.log(`\n## ${title}`)
}

async function main(): Promise<void> {
  // ---------- 純函式單元測試 ----------
  section('EngineOutputParser')
  const uciLine = parseInfoLine('info depth 12 multipv 2 score cp -37 nodes 5000 pv h2e2 h9g7')
  check('UCI score cp 解析', uciLine?.score.kind === 'cp' && uciLine.score.value === -37, uciLine)
  const mateLine = parseInfoLine('info depth 9 score mate -4 pv a0a1')
  check('UCI score mate 解析', mateLine?.score.kind === 'mate' && mateLine.score.value === -4, mateLine)
  const ucciLine = parseInfoLine('info depth 6 score 4 pv b0c2 b9c7')
  check('UCCI 裸數值 score 解析為 cp', ucciLine?.score.kind === 'cp' && ucciLine.score.value === 4, ucciLine)
  check('UCCI 行 depth/pv 正確', ucciLine?.depth === 6 && ucciLine.pv.join(' ') === 'b0c2 b9c7')
  const boundLine = parseInfoLine('info depth 10 score cp 55 lowerbound pv h2e2')
  check('lowerbound 不影響解析', boundLine?.score.kind === 'cp' && boundLine.score.value === 55)

  section('negateScore / scoreToCentipawns')
  check('cp 取負', JSON.stringify(negateScore({ kind: 'cp', value: 42 })) === '{"kind":"cp","value":-42}')
  check('mate 取負', JSON.stringify(negateScore({ kind: 'mate', value: 3 })) === '{"kind":"mate","value":-3}')
  check('mate 正規化為大值', scoreToCentipawns({ kind: 'mate', value: 2 }) > 90000)
  check('被將死為大負值', scoreToCentipawns({ kind: 'mate', value: -2 }) < -90000)

  section('moves 基本檢查')
  const start = parseFen(START_FEN)
  if (!start.valid) throw new Error('START_FEN 解析失敗')
  const h2 = parseUciMove('h2e2')
  check('h2e2 座標映射（紅炮 grid[7][7]）', h2?.fromRow === 7 && h2.fromCol === 7 && h2.toRow === 7 && h2.toCol === 4, h2)
  check('合法基本著法通過', basicMoveCheck(start.board.grid, 'red', 'h2e2').ok)
  check('起點無子被拒', !basicMoveCheck(start.board.grid, 'red', 'e4e5').ok)
  check('動到對方棋子被拒', !basicMoveCheck(start.board.grid, 'red', 'h9g7').ok)
  check('吃自己人被拒', !basicMoveCheck(start.board.grid, 'red', 'a0a3').ok)
  check('原地不動被拒', !basicMoveCheck(start.board.grid, 'red', 'h2h2').ok)
  check('格式錯誤被拒', !basicMoveCheck(start.board.grid, 'red', 'x9z9').ok)

  section('MoveComparisonService')
  const cmp = compareMove({
    playedMoveUci: 'b2e2',
    bestMoveUci: 'h2e2',
    bestScore: { kind: 'cp', value: 42 },
    playedScore: { kind: 'cp', value: -260 }
  })
  check('loss 計算', cmp.centipawnLoss === 302, cmp.centipawnLoss)
  check('302cp → Blunder（半開區間）', cmp.quality === 'Blunder')

  // ---------- 假引擎端對端 ----------
  if (!existsSync(FAKE_ENGINE)) {
    console.error('\n⚠ 找不到 fake-engine.exe，跳過端對端測試（請先用 csc 編譯）')
    return
  }

  section('E2E：UCI 引擎（FAKE_ENGINE_MODE=uci）')
  process.env.FAKE_ENGINE_MODE = 'uci'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    let detectedProtocol: string | null = null
    adapter.onProtocolDetected((p) => {
      detectedProtocol = p
    })
    const t = await adapter.test()
    check('test() 成功', t.ok, t)
    check('偵測為 uci', t.protocol === 'uci')
    check('回報 id name', t.engineName === 'FakeUCI 1.0', t.engineName)
    check('偵測回呼觸發', detectedProtocol === 'uci')

    const analysis = await adapter.analyze({ fen: START_FEN, depth: 10, multiPv: 2 })
    check('最佳著法', analysis.bestMoveUci === 'h2e2')
    check('MultiPV 兩條線', analysis.lines.length === 2, analysis.lines.length)
    check('分數 cp 42', analysis.score.kind === 'cp' && analysis.score.value === 42)
    check('engineName 用 id name', analysis.engineName === 'FakeUCI 1.0')

    const evaluation = await adapter.evaluateMove({ fen: START_FEN, moveUci: 'b2e2', depth: 10 })
    check('evaluateMove 視角取負（對手 +42 → 我方 -42）',
      evaluation.score.kind === 'cp' && evaluation.score.value === -42, evaluation.score)
    check('非終局', evaluation.terminatesGame === false)
  }

  section('E2E：UCCI 引擎，忽略未知指令（FAKE_ENGINE_MODE=ucci，2 秒偵測逾時 fallback）')
  process.env.FAKE_ENGINE_MODE = 'ucci'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    const t0 = Date.now()
    const t = await adapter.test()
    const elapsed = Date.now() - t0
    check('test() 成功', t.ok, t)
    check('偵測為 ucci', t.protocol === 'ucci')
    check('經過約 2 秒逾時才 fallback', elapsed >= 1900 && elapsed < 5000, elapsed)
    check('回報 id name', t.engineName === 'FakeUCCI 2.0', t.engineName)

    // 已知協定後第二次連線不再等待偵測逾時
    const t1 = Date.now()
    const analysis = await adapter.analyze({ fen: START_FEN, depth: 8 })
    const elapsed2 = Date.now() - t1
    check('已知協定直接握手（<1.5 秒）', elapsed2 < 1500, elapsed2)
    check('UCCI 裸 score 解析', analysis.score.kind === 'cp' && analysis.score.value === 33)
    check('UCCI bestmove', analysis.bestMoveUci === 'b2e2')
  }

  section('E2E：收到未知指令即退出的 UCCI 引擎（FAKE_ENGINE_MODE=ucci-strict，重啟換協定）')
  process.env.FAKE_ENGINE_MODE = 'ucci-strict'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    const t = await adapter.test()
    check('行程退出後以 ucci 重啟成功', t.ok && t.protocol === 'ucci', t)
  }

  section('E2E：無合法著法（FAKE_ENGINE_MODE=mate，bestmove (none)）')
  process.env.FAKE_ENGINE_MODE = 'mate'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    const t0 = Date.now()
    let analyzeError: Error | null = null
    try {
      await adapter.analyze({ fen: START_FEN, depth: 10 })
    } catch (err) {
      analyzeError = err as Error
    }
    const elapsed = Date.now() - t0
    check('analyze 以 EngineNoLegalMovesError 拒絕', analyzeError?.name === 'EngineNoLegalMovesError', analyzeError?.name)
    check('立即返回而非等 45 秒逾時', elapsed < 5000, elapsed)

    const evaluation = await adapter.evaluateMove({ fen: START_FEN, moveUci: 'h2e2', depth: 10 })
    check('evaluateMove 轉為 mate in 1', evaluation.score.kind === 'mate' && evaluation.score.value === 1, evaluation.score)
    check('terminatesGame = true', evaluation.terminatesGame === true)
  }

  console.log(`\n結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('測試執行失敗：', err)
  process.exit(1)
})
