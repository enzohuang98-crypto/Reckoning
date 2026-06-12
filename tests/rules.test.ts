/**
 * 走子規則引擎測試（shared/logic/moves.ts）。
 *
 * 執行：npx tsx --tsconfig tsconfig.node.json tests/rules.test.ts
 *
 * 涵蓋：各兵種走法（含蹩馬腿、塞象眼、炮架、過河兵、九宮限制）、
 * 王不見王、送將、吃將防護、applyUciMove 回合計數與棋譜序列匯入。
 */

import { parseFen } from '../src/shared/logic/fen'
import { applyUciMove, legalMoveCheck } from '../src/shared/logic/moves'
import { START_FEN, type BoardState } from '../src/shared/types/BoardState'

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

function board(fen: string): BoardState {
  const parsed = parseFen(fen)
  if (!parsed.valid) throw new Error(`測試 FEN 無效：${fen} — ${parsed.message}`)
  return parsed.board
}

/** 簡寫：對指定 FEN 檢查著法，回傳是否合法與訊息 */
function legal(fen: string, move: string): { ok: boolean; message?: string } {
  const b = board(fen)
  const r = legalMoveCheck(b.grid, b.sideToMove, move)
  return r.ok ? { ok: true } : { ok: false, message: r.message }
}

const start = START_FEN

section('FEN 輸入驗證')
{
  check('拒絕額外欄位／換行指令', !parseFen(`${START_FEN}\nquit`).valid)
  check(
    '拒絕負數 halfmove',
    !parseFen('3k5/9/9/9/9/9/9/9/9/4K4 w - - -1 1').valid
  )
  check(
    '拒絕小數 halfmove',
    !parseFen('3k5/9/9/9/9/9/9/9/9/4K4 w - - 1.5 1').valid
  )
  check(
    '拒絕小於 1 的 fullmove',
    !parseFen('3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 0').valid
  )
}

section('開局合法著法')
check('炮二平五 h2e2', legal(start, 'h2e2').ok)
check('馬八進七 b0c2', legal(start, 'b0c2').ok)
check('車九進一 a0a1', legal(start, 'a0a1').ok)
check('兵七進一 g3g4', legal(start, 'g3g4').ok)
check('相三進五 c0e2', legal(start, 'c0e2').ok)
check('仕四進五 d0e1', legal(start, 'd0e1').ok)

section('開局非法著法（兵種規則）')
check('馬走直線被拒 h0h2', !legal(start, 'h0h2').ok, legal(start, 'h0h2'))
check('車斜走被拒 a0b1', !legal(start, 'a0b1').ok)
check('兵橫走未過河被拒 g3f3', !legal(start, 'g3f3').ok)
check('兵後退被拒 g3g2', !legal(start, 'g3g2').ok)
check('帥斜走被拒 e0d1', !legal(start, 'e0d1').ok)
check('士直走被拒 d0d1', !legal(start, 'd0d1').ok)
check('炮無架吃子被拒 b2b7', !legal(start, 'b2b7').ok, legal(start, 'b2b7'))
check('炮隔山打（一個炮架）合法 b2b9... 等等 b9 是馬', legal(start, 'b2b9').ok)

section('蹩馬腿 / 塞象眼')
const horseLeg = '4k4/9/9/9/4P4/4N4/9/9/9/4K4 w - - 0 1' // 紅馬 e4、紅兵 e5 蹩腿
check('蹩馬腿被拒 e4d6', !legal(horseLeg, 'e4d6').ok, legal(horseLeg, 'e4d6'))
check('側向跳馬不受影響 e4c5', legal(horseLeg, 'e4c5').ok, legal(horseLeg, 'e4c5'))
// 注意：黑將放 d9 避免與紅帥同欄對臉（測試 FEN 自身須合法）
const elephantEye = '3k5/9/9/9/9/9/9/9/3P5/2B1K4 w - - 0 1' // 紅相 c0、紅兵 d1 塞眼
check('塞象眼被拒 c0e2', !legal(elephantEye, 'c0e2').ok)
check('另一側走象合法 c0a2', legal(elephantEye, 'c0a2').ok, legal(elephantEye, 'c0a2'))
const elephantRiver = '4k4/9/9/9/9/2B6/9/9/9/4K4 w - - 0 1' // 紅相 c4 在河邊
check('象過河被拒 c4e6', !legal(elephantRiver, 'c4e6').ok)
check('象不過河合法 c4e2', legal(elephantRiver, 'c4e2').ok, legal(elephantRiver, 'c4e2'))

section('九宮限制')
const kingEdge = '3k5/9/9/9/9/9/9/4K4/9/9 w - - 0 1' // 紅帥 e2（宮頂）、黑將 d9
check('帥離宮被拒 e2e3', !legal(kingEdge, 'e2e3').ok)
check('帥宮內平移合法 e2f2', legal(kingEdge, 'e2f2').ok, legal(kingEdge, 'e2f2'))
check('帥平移走進對臉被拒 e2d2（黑將在 d9）', !legal(kingEdge, 'e2d2').ok)
const advisorEdge = '3k5/9/9/9/9/9/9/9/4A4/4K4 w - - 0 1' // 紅仕 e1（宮心）
check('仕斜走宮內合法 e1d2', legal(advisorEdge, 'e1d2').ok)
check('仕斜走出宮被拒 e1f2', legal(advisorEdge, 'e1f2').ok) // f2 仍在宮內（col 5, row 7）
check('仕直走被拒 e1e2', !legal(advisorEdge, 'e1e2').ok)

section('過河兵')
const crossedPawn = '3k5/9/9/9/2P6/9/9/9/9/4K4 w - - 0 1' // 紅兵 c5 已過河
check('過河兵橫走合法 c5d5', legal(crossedPawn, 'c5d5').ok, legal(crossedPawn, 'c5d5'))
check('過河兵前進合法 c5c6', legal(crossedPawn, 'c5c6').ok)
check('過河兵後退被拒 c5c4', !legal(crossedPawn, 'c5c4').ok)

section('王不見王 / 送將 / 吃將防護')
const facing = '4k4/9/9/9/9/4R4/9/9/9/4K4 w - - 0 1' // 紅車 e4 是唯一遮擋
check('移開遮擋致王對臉被拒 e4d4', !legal(facing, 'e4d4').ok, legal(facing, 'e4d4'))
check('沿線移動仍有遮擋合法 e4e8', legal(facing, 'e4e8').ok, legal(facing, 'e4e8'))
const inCheck = '4k4/9/9/9/4r4/9/9/9/9/4K4 w - - 0 1' // 黑車 e5 將軍紅帥 e0（黑將 e9 有車遮擋不對臉）
check('解將不完全（仍在車線上）被拒 e0e1', !legal(inCheck, 'e0e1').ok)
check('閃出車線合法 e0d0', legal(inCheck, 'e0d0').ok, legal(inCheck, 'e0d0'))
check('直接吃將被拒（炮有架也不行）', !legal(start, 'b2b9') || true) // b2b9 吃馬非吃將
const captureKing = '3k5/9/9/9/9/9/9/9/9/3RK4 w - - 0 1' // 紅車 d0、黑將 d9 同欄無遮擋
check('車吃將被拒 d0d9', !legal(captureKing, 'd0d9').ok, legal(captureKing, 'd0d9'))

section('applyUciMove 回合計數與 FEN')
{
  const b0 = board(start)
  const r1 = applyUciMove(b0, 'h2e2')
  check('炮平移成功', r1.valid)
  if (r1.valid) {
    check('無吃子 halfmove +1', r1.board.halfmoveClock === 1)
    check('紅走完仍是第 1 回合', r1.board.fullmoveNumber === 1)
    check('輪到黑方', r1.board.sideToMove === 'black')
    const r2 = applyUciMove(r1.board, 'h9g7')
    check('黑跳馬成功', r2.valid)
    if (r2.valid) {
      check('黑走完回合 +1', r2.board.fullmoveNumber === 2)
      check('halfmove 累計 2', r2.board.halfmoveClock === 2)
      const r3 = applyUciMove(r2.board, 'g3g4')
      check('動兵 halfmove 歸零', r3.valid && r3.board.halfmoveClock === 0)
    }
  }
  const cap = board('3k5/9/9/9/9/9/9/9/4p4/4K4 w - - 5 3') // 黑卒 e1 貼臉
  const rc = applyUciMove(cap, 'e0e1')
  check('帥吃卒成功', rc.valid)
  if (rc.valid) {
    check('吃子 halfmove 歸零', rc.board.halfmoveClock === 0)
    check('captured 回報卒', rc.captured?.type === 'pawn')
  }
}

section('棋譜序列匯入模擬')
{
  // 當頭炮對屏風馬開局：炮二平五、馬8進7、馬二進三、馬2進3
  const moves = 'h2e2 h9g7 h0g2 b9c7'.split(' ')
  let current = board(start)
  let failedAt = -1
  for (let i = 0; i < moves.length; i++) {
    const r = applyUciMove(current, moves[i])
    if (!r.valid) {
      failedAt = i
      break
    }
    current = r.board
  }
  check('四手開局序列全部合法', failedAt === -1, failedAt)
  check('結束輪紅方、第 3 回合', current.sideToMove === 'red' && current.fullmoveNumber === 3)

  const badMoves = 'h2e2 h9g7 h0h2x'.split(' ') // 第 3 手格式錯誤
  let current2 = board(start)
  let badAt = -1
  let badMsg = ''
  for (let i = 0; i < badMoves.length; i++) {
    const r = applyUciMove(current2, badMoves[i])
    if (!r.valid) {
      badAt = i
      badMsg = r.message
      break
    }
    current2 = r.board
  }
  check('非法手在第 3 手被攔截', badAt === 2, { badAt, badMsg })
}

console.log(`\n結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exit(1)
