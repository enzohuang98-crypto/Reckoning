/**
 * 事實表文字的各語言字串表（zh-TW／zh-CN／en）。只有字串與組字規則，不含事實計算。
 * 改動任何字串都會改變送給模型的事實表（tests/fixtures/explain-v2/prompt-snapshots.json）。
 */

import type { ExplanationLanguage } from '../../../types/AIExplanationTypes'
import type { PieceColor, PieceType } from '../../../types/BoardState'
import type { IdeaKind, PlyDescriptor } from './types'

export interface FactLabels {
  side: Record<PieceColor, string>
  /** 「黑卒」「Black pawn」：哪一方的哪個子。 */
  named: (side: string, piece: string) => string
  /** 「黑5路卒（中卒；…）」：哪一方、哪一路的哪個子；第 5 路的兵卒加上「中兵／中卒」，note 放在同一個括號裡。 */
  located: (side: string, file: string, piece: string, central: boolean, note?: string) => string
  piece: Record<PieceColor, Record<PieceType, string>>
  descriptor: Record<PlyDescriptor, (piece: string) => string>
  noCapture: string
  noCheck: string
  check: string
  onlyLegalMove: string
  capture: (piece: string) => string
  threats: string
  protectedLabel: string
  /** 「吃下後對方能用7路馬吃回」 */
  protectedBy: (piece: string) => string
  unprotectedLabel: string
  toMove: string
  bestMove: string
  userMove: string
  gap: string
  pawns: string
  userIsBest: string
  bestLine: string
  userLine: string
  differences: string
  candidates: string
  evaluation: string
  /** 評估的視角與單位說明（一行）。 */
  perspective: (side: string) => string
  inventory: (pieces: string) => string
  inventorySide: (side: string, pieces: string) => string
  inventoryEmpty: string
  checkmate: (side: string) => string
  stalemate: (side: string) => string
  noCaptures: (plies: number) => string
  firstCapture: (line: string, ply: number, side: string, piece: string, captured: string, other: string) => string
  otherCapture: (at: number | null) => string
  firstCheck: (line: string, ply: number, side: string, other: string) => string
  otherCheck: (at: number | null) => string
  material: (best: string, user: string) => string
  capturesNone: string
  capturesOf: (side: string, pieces: string) => string
  /** 列出的手數內，雙方吃子的合計與子數比較（只算子數，不做子力價值換算）。 */
  lineCaptures: (captures: string, note: string) => string
  /** 列出的手數之後還有吃子：吃子合計不是最後結果。 */
  capturesContinue: string
  capturesEven: (count: number) => string
  capturesMore: (side: string, count: number) => string
  bestLineName: string
  userLineName: string
  truncatedNote: string
  /** 關鍵著法檢查的總標題。 */
  ideasHeading: string
  /** 各種「如果…」的標題：side＝輪走方、other＝對手、reply＝照樣應著的那一手。 */
  ideaTitle: Record<IdeaKind, (side: string, other: string, reply: string) => string>
  /** 標在關鍵那一手後面。 */
  keyMove: string
}

const PIECES_TW: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帥', advisor: '仕', elephant: '相', horse: '馬', rook: '車', cannon: '炮', pawn: '兵' },
  black: { king: '將', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '炮', pawn: '卒' }
}
const PIECES_CN: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒' }
}
const PIECES_EN: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: 'king', advisor: 'advisor', elephant: 'elephant', horse: 'horse', rook: 'rook', cannon: 'cannon', pawn: 'pawn' },
  black: { king: 'king', advisor: 'advisor', elephant: 'elephant', horse: 'horse', rook: 'rook', cannon: 'cannon', pawn: 'pawn' }
}

export const LABELS: Record<ExplanationLanguage, FactLabels> = {
  'zh-TW': {
    side: { red: '紅', black: '黑' },
    named: (side, piece) => `${side}${piece}`,
    located: (side, file, piece, central, note) => {
      const inner = [central ? `中${piece}` : '', note ?? ''].filter(Boolean).join('；')
      return `${side}${file}路${piece}${inner ? `（${inner}）` : ''}`
    },
    piece: PIECES_TW,
    descriptor: {
      enters_center: (piece) => `${piece}進入中路`,
      rook_develops: () => '出車',
      horse_develops: () => '跳馬出動',
      pawn_crosses_river: (piece) => `${piece}過河`,
      king_moves: (piece) => `${piece}移動`
    },
    noCapture: '未吃子',
    noCheck: '未將軍',
    check: '將軍',
    onlyLegalMove: '唯一合法著法',
    capture: (piece) => `吃${piece}`,
    threats: '走完這步，下一手可吃',
    protectedLabel: '吃下後對方能吃回',
    protectedBy: (piece) => `吃下後對方能用${piece}吃回`,
    unprotectedLabel: '吃下後對方吃不回',
    toMove: '輪到',
    bestMove: '引擎首選',
    userMove: '棋手著法',
    gap: '差距',
    pawns: '兵',
    userIsBest: '棋手的著法就是引擎首選。',
    bestLine: '首選主線',
    userLine: '棋手著法之後的主線',
    differences: '兩線差異',
    candidates: '其他候選',
    evaluation: '評估',
    perspective: (side) => `評估都以${side}方來看，單位是兵；正數對${side}方有利，負數對${side}方不利。`,
    inventory: (pieces) => `盤面上全部的棋子：${pieces}。`,
    inventorySide: (side, pieces) => `${side}方 ${pieces}`,
    inventoryEmpty: '無',
    checkmate: (side) => `主線結束時${side}方無合法著法且被將軍：將死。`,
    stalemate: (side) => `主線結束時${side}方無子可動：困斃（象棋規則判${side}方負）。`,
    noCaptures: (plies) => `兩線前 ${plies} 手都沒有吃子。`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `${line}第 ${ply} 手${side}${piece}吃${captured}${other}。`,
    otherCapture: (at) => (at === null ? '，另一條線沒有吃子' : `，另一條線第 ${at} 手才有吃子`),
    firstCheck: (line, ply, side, other) => `${line}第 ${ply} 手${side}方先將軍${other}。`,
    otherCheck: (at) => (at === null ? '，另一條線沒有將軍' : `，另一條線第 ${at} 手才將軍`),
    material: (best, user) => `吃子結果：首選線${best}；實戰線${user}。`,
    capturesNone: '雙方都沒有吃子',
    capturesOf: (side, pieces) => `${side}方吃掉${pieces}`,
    lineCaptures: (captures, note) => `列出手數內吃子合計：${captures}（${note}）`,
    capturesContinue: '列出的手數之後下一手還有吃子，交換尚未結束：吃子合計不是最後結果，最後優劣以評估為準。',
    capturesEven: (count) => `雙方各吃 ${count} 子，子數相同`,
    capturesMore: (side, count) => `${side}方多吃 ${count} 子`,
    bestLineName: '首選線',
    userLineName: '實戰線',
    truncatedNote: '（主線只列出部分手數）',
    ideasHeading: '關鍵著法檢查（程式另外問引擎的「如果…」，不是引擎主線；標「關鍵」的那一手最該講）',
    ideaTitle: {
      opponentThreat: (side, other) => `對手的威脅（假如${side}方這手先不走、讓${other}方先走）`,
      sameReply: (_side, other, reply) => `照樣應著（首選之後${other}方仍照實戰線走${reply}）`,
      bestThreat: (side, other) => `首選的威脅（首選之後假如${other}方不理會、${side}方再走一步）`
    },
    keyMove: '← 關鍵'
  },
  'zh-CN': {
    side: { red: '红', black: '黑' },
    named: (side, piece) => `${side}${piece}`,
    located: (side, file, piece, central, note) => {
      const inner = [central ? `中${piece}` : '', note ?? ''].filter(Boolean).join('；')
      return `${side}${file}路${piece}${inner ? `（${inner}）` : ''}`
    },
    piece: PIECES_CN,
    descriptor: {
      enters_center: (piece) => `${piece}进入中路`,
      rook_develops: () => '出车',
      horse_develops: () => '跳马出动',
      pawn_crosses_river: (piece) => `${piece}过河`,
      king_moves: (piece) => `${piece}移动`
    },
    noCapture: '未吃子',
    noCheck: '未将军',
    check: '将军',
    onlyLegalMove: '唯一合法着法',
    capture: (piece) => `吃${piece}`,
    threats: '走完这步，下一手可吃',
    protectedLabel: '吃下后对方能吃回',
    protectedBy: (piece) => `吃下后对方能用${piece}吃回`,
    unprotectedLabel: '吃下后对方吃不回',
    toMove: '轮到',
    bestMove: '引擎首选',
    userMove: '棋手着法',
    gap: '差距',
    pawns: '兵',
    userIsBest: '棋手的着法就是引擎首选。',
    bestLine: '首选主线',
    userLine: '棋手着法之后的主线',
    differences: '两线差异',
    candidates: '其他候选',
    evaluation: '评估',
    perspective: (side) => `评估都以${side}方来看，单位是兵；正数对${side}方有利，负数对${side}方不利。`,
    inventory: (pieces) => `盘面上全部的棋子：${pieces}。`,
    inventorySide: (side, pieces) => `${side}方 ${pieces}`,
    inventoryEmpty: '无',
    checkmate: (side) => `主线结束时${side}方无合法着法且被将军：将死。`,
    stalemate: (side) => `主线结束时${side}方无子可动：困毙（象棋规则判${side}方负）。`,
    noCaptures: (plies) => `两线前 ${plies} 手都没有吃子。`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `${line}第 ${ply} 手${side}${piece}吃${captured}${other}。`,
    otherCapture: (at) => (at === null ? '，另一条线没有吃子' : `，另一条线第 ${at} 手才有吃子`),
    firstCheck: (line, ply, side, other) => `${line}第 ${ply} 手${side}方先将军${other}。`,
    otherCheck: (at) => (at === null ? '，另一条线没有将军' : `，另一条线第 ${at} 手才将军`),
    material: (best, user) => `吃子结果：首选线${best}；实战线${user}。`,
    capturesNone: '双方都没有吃子',
    capturesOf: (side, pieces) => `${side}方吃掉${pieces}`,
    lineCaptures: (captures, note) => `列出手数内吃子合计：${captures}（${note}）`,
    capturesContinue: '列出的手数之后下一手还有吃子，交换尚未结束：吃子合计不是最后结果，最后优劣以评估为准。',
    capturesEven: (count) => `双方各吃 ${count} 子，子数相同`,
    capturesMore: (side, count) => `${side}方多吃 ${count} 子`,
    bestLineName: '首选线',
    userLineName: '实战线',
    truncatedNote: '（主线只列出部分手数）',
    ideasHeading: '关键着法检查（程序另外问引擎的“如果…”，不是引擎主线；标“关键”的那一手最该讲）',
    ideaTitle: {
      opponentThreat: (side, other) => `对手的威胁（假如${side}方这手先不走、让${other}方先走）`,
      sameReply: (_side, other, reply) => `照样应着（首选之后${other}方仍照实战线走${reply}）`,
      bestThreat: (side, other) => `首选的威胁（首选之后假如${other}方不理会、${side}方再走一步）`
    },
    keyMove: '← 关键'
  },
  en: {
    side: { red: 'Red', black: 'Black' },
    named: (side, piece) => `${side} ${piece}`,
    located: (side, file, piece, central, note) => {
      const inner = [central ? 'central pawn' : '', note ?? ''].filter(Boolean).join('; ')
      return `${side} ${piece} on file ${file}${inner ? ` (${inner})` : ''}`
    },
    piece: PIECES_EN,
    descriptor: {
      enters_center: (piece) => `${piece} moves to the central file`,
      rook_develops: () => 'rook develops',
      horse_develops: () => 'horse develops',
      pawn_crosses_river: (piece) => `${piece} crosses the river`,
      king_moves: (piece) => `${piece} moves`
    },
    noCapture: 'no capture',
    noCheck: 'no check',
    check: 'check',
    onlyLegalMove: 'the only legal move',
    capture: (piece) => `captures ${piece}`,
    threats: 'after this move it can capture next',
    protectedLabel: 'can be recaptured',
    protectedBy: (piece) => `can be recaptured by the ${piece}`,
    unprotectedLabel: 'cannot be recaptured',
    toMove: 'To move',
    bestMove: 'Engine best move',
    userMove: "Player's move",
    gap: 'Gap',
    pawns: 'pawns',
    userIsBest: "The player's move is the engine's best move.",
    bestLine: 'Best line',
    userLine: "Line after the player's move",
    differences: 'Differences',
    candidates: 'Other candidates',
    evaluation: 'eval',
    perspective: (side) => `All evals are from ${side}'s point of view, in pawns; positive favours ${side}, negative favours the opponent.`,
    inventory: (pieces) => `All pieces on the board: ${pieces}.`,
    inventorySide: (side, pieces) => `${side} ${pieces}`,
    inventoryEmpty: 'none',
    checkmate: (side) => `At the end of the line ${side} has no legal move and is in check: checkmate.`,
    stalemate: (side) => `At the end of the line ${side} has no legal move: stalemate (a loss for ${side}).`,
    noCaptures: (plies) => `Neither line captures anything in the first ${plies} plies.`,
    firstCapture: (line, ply, side, piece, captured, other) =>
      `In the ${line}, ply ${ply}: ${side} ${piece} captures ${captured}${other}.`,
    otherCapture: (at) => (at === null ? '; the other line has no capture' : `; the other line first captures at ply ${at}`),
    firstCheck: (line, ply, side, other) => `In the ${line}, ${side} gives check first at ply ${ply}${other}.`,
    otherCheck: (at) => (at === null ? '; the other line has no check' : `; the other line first checks at ply ${at}`),
    material: (best, user) => `Captures: best line ${best}; player's line ${user}.`,
    capturesNone: 'no captures by either side',
    capturesOf: (side, pieces) => `${side} captured ${pieces}`,
    lineCaptures: (captures, note) => `Captures within the listed plies: ${captures} (${note})`,
    capturesContinue: 'The line continues with another capture after the listed plies, so the exchange is not over: the capture total is not the final result; the eval decides.',
    capturesEven: (count) => `each side captured ${count}, equal piece count`,
    capturesMore: (side, count) => `${side} captured ${count} more`,
    bestLineName: 'best line',
    userLineName: "player's line",
    truncatedNote: '(only part of the line is listed)',
    ideasHeading: 'Key move checks (extra "what if" questions the program asked the engine; not the main line; the move marked KEY matters most)',
    ideaTitle: {
      opponentThreat: (side, other) => `Opponent's threat (if ${side} passed this move and ${other} moved instead)`,
      sameReply: (_side, other, reply) => `Same reply (after the best move, ${other} still plays ${reply} as in the player's line)`,
      bestThreat: (side, other) => `Threat of the best move (after the best move, if ${other} ignores it and ${side} moves again)`
    },
    keyMove: '<- KEY'
  }
}
