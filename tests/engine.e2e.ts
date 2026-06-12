/**
 * 引擎邏輯測試：SDS v0.2 契約單元測試 + 假引擎端對端測試。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/engine.e2e.ts
 * （需先以 csc 編譯 fake-engine.exe，見 FakeEngine.cs 開頭說明）
 *
 * 涵蓋：
 *  - §2.14.6 必要單元測試（convertCpScore / convertMateScore / parseInfoLine）
 *  - §2.15.4 invertEngineScore（含 mate 0 反轉為 +MATE_SCORE）
 *  - §2.13 classifyMistakeLevel 半開區間與 computeConfidence 規則
 *  - §2.15.2 雙階段分析：userMove 在候選（不取負）、不在候選（二次分析取負）、
 *    二次分析遇殺棋（mate 0 → 殺棋（終局））
 *  - UCI/UCCI 協定偵測、退出重啟、無合法著法、取消機制（§2.16.5）
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  EngineAnalysisError,
  PikafishAdapter,
  invertEngineScore
} from '../src/main/engine/PikafishAdapter'
import {
  convertCpScore,
  convertMateScore,
  parseInfoLine,
  parseBestMove
} from '../src/main/engine/EngineOutputParser'
import { MATE_SCORE } from '../src/shared/types/EngineAnalysis'
import {
  classifyMistakeLevel,
  computeConfidence,
  compareMove,
  normalizeScore,
  SEPARATE_EVAL_FAILED_REASON
} from '../src/shared/logic/MoveComparisonService'
import type { EngineAnalysis } from '../src/shared/types/EngineAnalysis'
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

/** 建立測試用 EngineAnalysis（預設值對應「資料齊全」情境） */
function makeAnalysis(patch: Partial<EngineAnalysis>): EngineAnalysis {
  return {
    positionFen: START_FEN,
    sideToMove: 'red',
    userMove: 'b2e2',
    bestMove: 'h2e2',
    scoreAfterUserMove: convertCpScore(15, 'score cp 15', 'candidate_move'),
    scoreAfterBestMove: convertCpScore(42, 'score cp 42'),
    evaluationAfterUserMove: 0.15,
    evaluationAfterBestMove: 0.42,
    userMoveEvaluationSource: 'candidate_move',
    depth: 10,
    candidateMoves: [
      {
        move: 'h2e2',
        score: convertCpScore(42, 'score cp 42', 'candidate_move'),
        evaluation: 0.42,
        depth: 10,
        principalVariation: ['h2e2', 'h9g7']
      },
      {
        move: 'b2e2',
        score: convertCpScore(15, 'score cp 15', 'candidate_move'),
        evaluation: 0.15,
        depth: 10,
        principalVariation: ['b2e2', 'b9c7']
      }
    ],
    principalVariation: ['h2e2', 'h9g7'],
    incomplete: false,
    warnings: [],
    engineName: 'Pikafish',
    ...patch
  }
}

async function main(): Promise<void> {
  // ---------- §2.14.6 必要單元測試 ----------
  section('EngineOutputParser：convertCpScore / convertMateScore（§2.14.6）')
  {
    const pos = convertCpScore(120, 'score cp 120')
    check('cp 正分 +1.20', pos.type === 'cp' && pos.displayText === '+1.20' && pos.comparableValue === 1.2)
    check('cp 正分 wasInverted=false / source=root', !pos.wasInverted && pos.source === 'root_analysis')
    const neg = convertCpScore(-80, 'score cp -80')
    check('cp 負分 -0.80', neg.displayText === '-0.80' && neg.comparableValue === -0.8)
    const m3 = convertMateScore(3, 'score mate 3')
    check('mate 3 → 殺 3 / 29997', m3.type === 'mate' && m3.displayText === '殺 3' && m3.comparableValue === MATE_SCORE - 3)
    check('mate 3 非終局', m3.type === 'mate' && !m3.isTerminalMate)
    const mNeg = convertMateScore(-2, 'score mate -2')
    check('mate -2 → 被殺 2 / -29998', mNeg.displayText === '被殺 2' && mNeg.comparableValue === -(MATE_SCORE - 2))
    const m0 = convertMateScore(0, 'score mate 0')
    check(
      'mate 0 terminal case：已被將死 / -30000',
      m0.type === 'mate' && m0.isTerminalMate && m0.displayText === '已被將死' && m0.comparableValue === -MATE_SCORE
    )
    const candidate = convertCpScore(10, 'score cp 10', 'candidate_move')
    check('candidate 來源', candidate.source === 'candidate_move')
    const separate = convertMateScore(2, 'score mate 2', 'separate_engine_call')
    check('separate 來源', separate.source === 'separate_engine_call')
  }

  section('EngineOutputParser：parseInfoLine / parseBestMove')
  {
    const uciLine = parseInfoLine('info depth 12 multipv 2 score cp -37 nodes 5000 pv h2e2 h9g7')
    check('UCI score cp 解析', uciLine?.score?.type === 'cp' && uciLine.score.cp === -37, uciLine)
    check('multipv / depth / pv', uciLine?.multipv === 2 && uciLine.depth === 12 && uciLine.pv.join(' ') === 'h2e2 h9g7')
    const mateLine = parseInfoLine('info depth 9 score mate -4 pv a0a1')
    check('UCI score mate 解析', mateLine?.score?.type === 'mate' && mateLine.score.mateIn === -4)
    const ucciLine = parseInfoLine('info depth 6 score 4 pv b0c2 b9c7')
    check('UCCI 裸數值 score 解析為 cp', ucciLine?.score?.type === 'cp' && ucciLine.score.cp === 4)
    const boundLine = parseInfoLine('info depth 10 score cp 55 lowerbound pv h2e2')
    check('lowerbound 不影響解析', boundLine?.score?.type === 'cp' && boundLine.score.cp === 55)
    const invalidScore = parseInfoLine('info depth 10 score cp abc pv h2e2')
    check('無效 score → score null 但 pv 保留（§2.14.6）', invalidScore !== null && invalidScore.score === null)
    const noScoreNoPv = parseInfoLine('info nodes 12345 nps 100000')
    check('無 score 無 pv → null', noScoreNoPv === null)
    check('bestmove 解析', parseBestMove('bestmove h2e2 ponder h9g7') === 'h2e2')
    check('bestmove (none) → null', parseBestMove('bestmove (none)') === null)
  }

  // ---------- §2.15.4 視角反轉 ----------
  section('invertEngineScore（§2.15.4）')
  {
    const cp = invertEngineScore(convertCpScore(42, 'score cp 42', 'separate_engine_call'))
    check('cp 取負 -0.42', cp.type === 'cp' && cp.cp === -42 && cp.comparableValue === -0.42)
    check('cp 反轉標記', cp.wasInverted && cp.source === 'separate_engine_call')
    const mate = invertEngineScore(convertMateScore(2, 'score mate 2', 'separate_engine_call'))
    check('mate 2 反轉 → 被殺 2', mate.type === 'mate' && mate.mateIn === -2 && mate.displayText === '被殺 2')
    const mate0 = invertEngineScore(convertMateScore(0, 'score mate 0', 'separate_engine_call'))
    check(
      'mate 0 反轉 → +MATE_SCORE「殺棋（終局）」（§2.15.8）',
      mate0.type === 'mate' &&
        mate0.comparableValue === MATE_SCORE &&
        mate0.displayText === '殺棋（終局）' &&
        mate0.isTerminalMate &&
        mate0.wasInverted
    )
    check('raw 保留原始字串（僅 debug 用）', mate0.raw === 'score mate 0')
  }

  // ---------- §2.13 錯誤分級 ----------
  section('classifyMistakeLevel 半開區間（§2.13.3、§2.13.5）')
  {
    check('負分不判錯誤', classifyMistakeLevel(-0.5) === 'acceptable_or_tiny_inaccuracy')
    check('0.00 → acceptable', classifyMistakeLevel(0) === 'acceptable_or_tiny_inaccuracy')
    check('0.305 → acceptable（不得用四捨五入值）', classifyMistakeLevel(0.305) === 'acceptable_or_tiny_inaccuracy')
    check('0.31 → inaccuracy（半開區間左含）', classifyMistakeLevel(0.31) === 'inaccuracy')
    check('0.81 → mistake', classifyMistakeLevel(0.81) === 'mistake')
    check('1.51 → serious_mistake', classifyMistakeLevel(1.51) === 'serious_mistake')
    check('3.01 → major_blunder', classifyMistakeLevel(3.01) === 'major_blunder')
    check('null → unknown', classifyMistakeLevel(null) === 'unknown')
    check('NaN → unknown', classifyMistakeLevel(Number.NaN) === 'unknown')
    check('Infinity → unknown', classifyMistakeLevel(Number.POSITIVE_INFINITY) === 'unknown')
    check('normalizeScore 黑方反轉（§2.13.2）', normalizeScore(1.5, 'black') === -1.5 && normalizeScore(1.5, 'red') === 1.5)
  }

  section('computeConfidence（§2.13.6）')
  {
    const base = {
      depth: 10,
      candidateMoveCount: 3,
      principalVariationLength: 5,
      evaluationAfterUserMove: 0.1,
      evaluationAfterBestMove: 0.4,
      scoreDifference: 0.3,
      engineBestMove: 'h2e2'
    }
    check('0 個 reason → high', computeConfidence(base).confidence === 'high')
    check('1 個 reason → medium', computeConfidence({ ...base, depth: null }).confidence === 'medium')
    check(
      '2 個 reason → low',
      computeConfidence({ ...base, depth: null, candidateMoveCount: 1 }).confidence === 'low'
    )
    const forced = computeConfidence({
      ...base,
      evaluationAfterUserMove: null,
      scoreDifference: null
    })
    check('eval 缺失強制 low', forced.confidence === 'low')
    check('reasons 含具體文字', forced.uncertaintyReasons.length >= 2)
    check(
      'PV 空且候選 < 2 強制 low',
      computeConfidence({ ...base, principalVariationLength: 0, candidateMoveCount: 1 }).confidence === 'low'
    )
    check(
      'minDepth 低於設定列入 reason',
      computeConfidence({ ...base, minDepth: 15 }).confidence === 'medium'
    )
  }

  section('compareMove（§2.13.2、§2.15.7）')
  {
    const ok = compareMove(makeAnalysis({}))
    check('差值直接相減（行棋方視角）', Math.abs((ok.scoreDifference ?? 0) - 0.27) < 1e-9, ok.scoreDifference)
    check('0.27 → acceptable', ok.mistakeLevel === 'acceptable_or_tiny_inaccuracy')
    check('資料齊全 → high', ok.confidence === 'high')

    const missing = compareMove(
      makeAnalysis({
        scoreAfterUserMove: null,
        evaluationAfterUserMove: null,
        userMoveEvaluationSource: 'unavailable'
      })
    )
    check('eval 缺失 → scoreDifference null（不得補 0）', missing.scoreDifference === null)
    check('→ unknown / low', missing.mistakeLevel === 'unknown' && missing.confidence === 'low')
    check(
      '帶 §2.15.7 指定 uncertainty reason',
      missing.uncertaintyReasons.includes(SEPARATE_EVAL_FAILED_REASON)
    )
  }

  // ---------- 假引擎端對端 ----------
  if (!existsSync(FAKE_ENGINE)) {
    console.error('\n⚠ 找不到 fake-engine.exe，跳過端對端測試（請先用 csc 編譯）')
    return
  }
  const config = { rootAnalysisMovetimeMs: 300, userMoveEvalMovetimeMs: 200, multiPv: 2 }

  section('E2E：UCI 引擎雙階段分析（FAKE_ENGINE_MODE=uci）')
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

    // 無 userMove
    const root = await adapter.analyzePosition({ positionFen: START_FEN }, config)
    check('最佳著法 h2e2', root.bestMove === 'h2e2')
    check('MultiPV 兩條候選', root.candidateMoves.length === 2, root.candidateMoves.length)
    check(
      'scoreAfterBestMove +0.42（root_analysis）',
      root.scoreAfterBestMove?.displayText === '+0.42' && root.scoreAfterBestMove.source === 'root_analysis'
    )
    check('EngineAnalysis.engineName 固定為 Pikafish', root.engineName === 'Pikafish')
    check('無 userMove → source unavailable', root.userMoveEvaluationSource === 'unavailable')

    // userMove 在候選中（§2.15.3：不取負號）
    const inCand = await adapter.analyzePosition({ positionFen: START_FEN, userMove: 'b2e2' }, config)
    check('候選 fast path：source=candidate_move', inCand.userMoveEvaluationSource === 'candidate_move')
    check(
      '候選分數未反轉 +0.15',
      inCand.scoreAfterUserMove?.displayText === '+0.15' && inCand.scoreAfterUserMove.wasInverted === false
    )
    check('evaluation 派生一致（§2.14.5）', inCand.evaluationAfterUserMove === inCand.scoreAfterUserMove?.comparableValue)

    // userMove 不在候選中（§2.15.3：二次分析取負號）
    const sep = await adapter.analyzePosition({ positionFen: START_FEN, userMove: 'g3g4' }, config)
    check('二次分析：source=separate_engine_call', sep.userMoveEvaluationSource === 'separate_engine_call')
    check(
      '對手視角 +0.42 反轉為 -0.42',
      sep.scoreAfterUserMove?.type === 'cp' &&
        sep.scoreAfterUserMove.comparableValue === -0.42 &&
        sep.scoreAfterUserMove.wasInverted === true,
      sep.scoreAfterUserMove
    )

    // 非法 userMove 在送引擎前被攔（invalid_user_move）
    let illegalErr: unknown = null
    try {
      await adapter.analyzePosition({ positionFen: START_FEN, userMove: 'h0h2' }, config)
    } catch (err) {
      illegalErr = err
    }
    check(
      '非法著法 → EngineAnalysisError(invalid_user_move)',
      illegalErr instanceof EngineAnalysisError && illegalErr.code === 'invalid_user_move'
    )
  }

  section('E2E：UCCI 引擎（FAKE_ENGINE_MODE=ucci，2 秒偵測逾時 fallback）')
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
    const analysis = await adapter.analyzePosition({ positionFen: START_FEN }, config)
    const elapsed2 = Date.now() - t1
    check('已知協定直接握手（<1.5 秒）', elapsed2 < 1500, elapsed2)
    check(
      'UCCI 裸 score 解析 +0.33',
      analysis.scoreAfterBestMove?.type === 'cp' && analysis.scoreAfterBestMove.comparableValue === 0.33
    )
    check('UCCI bestmove', analysis.bestMove === 'b2e2')
  }

  section('E2E：收到未知指令即退出的 UCCI 引擎（FAKE_ENGINE_MODE=ucci-strict）')
  process.env.FAKE_ENGINE_MODE = 'ucci-strict'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    const t = await adapter.test()
    check('行程退出後以 ucci 重啟成功', t.ok && t.protocol === 'ucci', t)
  }

  section('E2E：root 局面已終局（FAKE_ENGINE_MODE=mate）')
  process.env.FAKE_ENGINE_MODE = 'mate'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    const t0 = Date.now()
    let err: unknown = null
    try {
      await adapter.analyzePosition({ positionFen: START_FEN }, config)
    } catch (e) {
      err = e
    }
    const elapsed = Date.now() - t0
    check(
      'root 無合法著法 → EngineAnalysisError（將死/困斃訊息）',
      err instanceof EngineAnalysisError && err.message.includes('將死'),
      err instanceof Error ? err.message : err
    )
    check('立即返回而非等逾時', elapsed < 5000, elapsed)
  }

  section('E2E：userMove 將死對方（FAKE_ENGINE_MODE=mate-after-move）')
  process.env.FAKE_ENGINE_MODE = 'mate-after-move'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    const result = await adapter.analyzePosition(
      { positionFen: START_FEN, userMove: 'g3g4' },
      config
    )
    check(
      '二次分析 mate 0 反轉 → 殺棋（終局）/+30000（§2.15.8）',
      result.scoreAfterUserMove?.type === 'mate' &&
        result.scoreAfterUserMove.comparableValue === MATE_SCORE &&
        result.scoreAfterUserMove.displayText === '殺棋（終局）' &&
        result.scoreAfterUserMove.wasInverted === true,
      result.scoreAfterUserMove
    )
    check('source=separate_engine_call', result.userMoveEvaluationSource === 'separate_engine_call')
  }

  section('E2E：取消機制（FAKE_ENGINE_MODE=slow，§2.16.5）')
  process.env.FAKE_ENGINE_MODE = 'slow'
  {
    const adapter = new PikafishAdapter(FAKE_ENGINE)
    const controller = new AbortController()
    let phaseSeen: string | null = null
    const t0 = Date.now()
    const pending = adapter.analyzePosition({ positionFen: START_FEN }, config, {
      signal: controller.signal,
      onPhase: (phase) => {
        phaseSeen = phase
      }
    })
    setTimeout(() => controller.abort(), 300)
    let err: unknown = null
    try {
      await pending
    } catch (e) {
      err = e
    }
    const elapsed = Date.now() - t0
    check(
      '取消後以 AbortError 拒絕，不回傳結果',
      err instanceof DOMException && err.name === 'AbortError',
      err instanceof Error ? err.name : err
    )
    check('取消即時生效（停止等引擎跑完）', elapsed < 3000, elapsed)
    check('onPhase 回報 root_analysis', phaseSeen === 'root_analysis')
  }

  console.log(`\n結果：${passed} 通過，${failed} 失敗`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('測試執行失敗：', err)
  process.exit(1)
})
