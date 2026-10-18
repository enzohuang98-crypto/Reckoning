/**
 * 把事實表排成給模型看的文字（formatFactsForPrompt），以及「引擎重點摘要」用的單線摘要（summarizeLine）。
 * 只負責排版；所有字串來自 labels.ts。
 */

import type { ExplanationLanguage } from '../../../types/AIExplanationTypes'
import type { PieceColor, PieceType } from '../../../types/BoardState'
import { MISTAKE_LEVEL_LABELS } from '../../../types/MoveComparisonResult'
import { fileNumeral } from '../../board/ChineseNotation'
import { INVENTORY_ORDER, opponent } from './common'
import { LABELS, type FactLabels } from './labels'
import {
  MAX_FACT_LINE_PLIES,
  MAX_FACTS_PROMPT_CHARS,
  type ExplanationFacts,
  type FactDifference,
  type IdeaFact,
  type LineFacts,
  type MoveFact,
  type PlyFact,
  type ThreatFact
} from './types'

function capturesText(
  captures: Record<PieceColor, PieceType[]>,
  labels: FactLabels
): string {
  const parts = (['red', 'black'] as const)
    .filter((side) => captures[side].length > 0)
    .map((side) =>
      labels.capturesOf(
        labels.side[side],
        captures[side]
          .map((piece) => labels.named(labels.side[opponent(side)], labels.piece[opponent(side)][piece]))
          .join('、')
      )
    )
  return parts.length > 0 ? parts.join('；') : labels.capturesNone
}

function protectionText(threat: ThreatFact, labels: FactLabels, language: ExplanationLanguage): string {
  if (!threat.protected) return labels.unprotectedLabel
  if (!threat.recapturer) return labels.protectedLabel
  const defender = threat.side
  const { piece, file } = threat.recapturer
  const name =
    language === 'en'
      ? `${labels.piece[defender][piece]} on file ${file}`
      : `${fileNumeral(defender, defender === 'red' ? 9 - file : file - 1)}路${labels.piece[defender][piece]}`
  return labels.protectedBy(name)
}

/** 帶「路」的子名：紅方用中文數字、黑方用阿拉伯數字（英文一律用數字）。 */
function locatedName(
  side: PieceColor,
  piece: PieceType,
  file: number,
  labels: FactLabels,
  language: ExplanationLanguage,
  note?: string
): string {
  const numeral = language === 'en' ? String(file) : fileNumeral(side, side === 'red' ? 9 - file : file - 1)
  return labels.located(labels.side[side], numeral, labels.piece[side][piece], piece === 'pawn' && file === 5, note)
}

function formatPly(ply: PlyFact, labels: FactLabels, language: ExplanationLanguage): string {
  const pieceName = labels.piece[ply.side][ply.piece]
  const parts: string[] = ply.onlyLegalMove ? [labels.onlyLegalMove] : []
  parts.push(...ply.descriptors.map((descriptor) => labels.descriptor[descriptor](pieceName)))
  const enemy = opponent(ply.side)
  parts.push(
    ply.captured
      ? labels.capture(
          ply.capturedFile !== null
            ? locatedName(enemy, ply.captured, ply.capturedFile, labels, language)
            : labels.named(labels.side[enemy], labels.piece[enemy][ply.captured])
        )
      : labels.noCapture
  )
  parts.push(ply.givesCheck ? labels.check : labels.noCheck)
  if (ply.threats.length > 0) {
    parts.push(
      `${labels.threats}：${ply.threats
        .map(
          (threat) =>
            locatedName(
              threat.side,
              threat.piece,
              threat.file,
              labels,
              language,
              protectionText(threat, labels, language)
            )
        )
        .join('、')}`
    )
  }
  return ` ${ply.ply}. ${labels.side[ply.side]} ${ply.move}：${parts.join('；')}`
}

function formatLine(
  title: string,
  line: LineFacts,
  labels: FactLabels,
  maxPlies: number,
  language: ExplanationLanguage
): string[] {
  const lines = [`${title}：`]
  const shown = line.plies.slice(0, maxPlies)
  for (const ply of shown) lines.push(formatPly(ply, labels, language))
  // 只列子數：子力價值要看局面，沒有固定換算，交給引擎評估，不在事實表裡判斷誰划算。
  const taken: Record<PieceColor, PieceType[]> = { red: [], black: [] }
  for (const ply of shown) if (ply.captured) taken[ply.side].push(ply.captured)
  if (taken.red.length + taken.black.length > 0) {
    const diff = taken.red.length - taken.black.length
    const note =
      diff === 0
        ? labels.capturesEven(taken.red.length)
        : labels.capturesMore(labels.side[diff > 0 ? 'red' : 'black'], Math.abs(diff))
    lines.push(` ${labels.lineCaptures(capturesText(taken, labels), note)}`)
  }
  // 版面縮短時看「下一手（未列出）」是否吃子；沒縮短時看主線之後的那一手。
  const continues = shown.length < line.plies.length ? line.plies[shown.length].captured !== null : Boolean(line.capturesContinue)
  if (continues) lines.push(` ${labels.capturesContinue}`)
  if (line.plies.length > maxPlies) lines.push(` ${labels.truncatedNote}`)
  if (line.warning) lines.push(` ${line.warning}`)
  const last = line.plies.at(-1)
  if (last && line.plies.length <= maxPlies) {
    const loser = labels.side[opponent(last.side)]
    if (line.endsWith === 'checkmate') lines.push(` ${labels.checkmate(loser)}`)
    if (line.endsWith === 'stalemate') lines.push(` ${labels.stalemate(loser)}`)
  }
  return lines
}

/** 一條「如果…」：標題、逐手事實，關鍵那一手後面加上標記。 */
function formatIdea(
  idea: IdeaFact,
  sideToMove: PieceColor,
  labels: FactLabels,
  maxPlies: number,
  language: ExplanationLanguage
): string[] {
  const title = labels.ideaTitle[idea.kind](
    labels.side[sideToMove],
    labels.side[opponent(sideToMove)],
    idea.reply ?? ''
  )
  const lines = formatLine(title, idea.line, labels, maxPlies, language)
  // formatLine 的第 0 行是標題，第 N 行就是第 N 手（列出的手數內）。
  if (idea.keyPly <= Math.min(maxPlies, idea.line.plies.length)) {
    lines[idea.keyPly] = `${lines[idea.keyPly]}　${labels.keyMove}`
  }
  return lines
}

export function formatDifference(difference: FactDifference, labels: FactLabels): string {
  switch (difference.kind) {
    case 'no_captures':
      return labels.noCaptures(difference.plies)
    case 'first_capture': {
      const enemy = opponent(difference.side)
      return labels.firstCapture(
        difference.line === 'best' ? labels.bestLineName : labels.userLineName,
        difference.ply,
        labels.side[difference.side],
        labels.piece[difference.side][difference.piece],
        labels.named(labels.side[enemy], labels.piece[enemy][difference.captured]),
        labels.otherCapture(difference.otherLineCaptureFirstAt)
      )
    }
    case 'first_check':
      return labels.firstCheck(
        difference.line === 'best' ? labels.bestLineName : labels.userLineName,
        difference.ply,
        labels.side[difference.side],
        labels.otherCheck(difference.otherLineCheckAt)
      )
    case 'material':
      return labels.material(capturesText(difference.best, labels), capturesText(difference.user, labels))
  }
}

function render(facts: ExplanationFacts, labels: FactLabels, maxPlies: number, language: ExplanationLanguage): string {
  const out: string[] = []
  out.push(`${labels.toMove}：${labels.side[facts.sideToMove]}${language === 'en' ? '' : '方'}`)
  if (facts.inventory) {
    const inventory = facts.inventory
    const sides = (['red', 'black'] as const).map((side) => {
      // 同種子合併成「兵×3」。
      const names = INVENTORY_ORDER.flatMap((piece) => {
        const count = inventory[side].filter((item) => item === piece).length
        if (count === 0) return []
        return [`${labels.piece[side][piece]}${count > 1 ? `×${count}` : ''}`]
      })
      return labels.inventorySide(labels.side[side], names.length > 0 ? names.join('、') : labels.inventoryEmpty)
    })
    out.push(labels.inventory(sides.join('；')))
  }
  const scores = [facts.bestMove, facts.userMove, ...facts.candidates].map((move) => move?.score)
  if (scores.some((item) => item?.kind === 'pawns')) out.push(labels.perspective(labels.side[facts.sideToMove]))
  const score = (move: MoveFact): string => {
    if (!move.score) return ''
    const text =
      move.score.kind === 'mate'
        ? move.score.text
        : `${move.score.value > 0 ? '+' : ''}${move.score.value.toFixed(2)} ${labels.pawns}`
    return `（${labels.evaluation} ${text}）`
  }
  const headline = [`${labels.bestMove}：${facts.bestMove.move}${score(facts.bestMove)}`]
  if (facts.userMove) headline.push(`${labels.userMove}：${facts.userMove.move}${score(facts.userMove)}`)
  if (facts.mistakeLevel || facts.scoreGapPawns !== undefined) {
    const level = facts.mistakeLevel
      ? language === 'en'
        ? facts.mistakeLevel.replace(/_/g, ' ')
        : MISTAKE_LEVEL_LABELS[facts.mistakeLevel]
      : ''
    const gap = facts.scoreGapPawns !== undefined ? `${facts.scoreGapPawns} ${labels.pawns}` : ''
    headline.push(`${labels.gap}：${[level, gap ? `（${gap}）` : ''].join('')}`)
  }
  out.push(headline.join('；'))
  if (facts.userIsBest) out.push(labels.userIsBest)
  out.push(...formatLine(labels.bestLine, facts.bestLine, labels, maxPlies, language))
  if (facts.userLine) out.push(...formatLine(labels.userLine, facts.userLine, labels, maxPlies, language))
  if (facts.differences.length > 0) {
    out.push(`${labels.differences}：`)
    for (const difference of facts.differences) out.push(` - ${formatDifference(difference, labels)}`)
  }
  if (facts.ideas && facts.ideas.length > 0) {
    out.push(`${labels.ideasHeading}：`)
    for (const idea of facts.ideas) out.push(...formatIdea(idea, facts.sideToMove, labels, maxPlies, language))
  }
  const others = facts.candidates.filter(
    (candidate) => candidate.move !== facts.bestMove.move && candidate.move !== facts.userMove?.move
  )
  if (others.length > 0) {
    out.push(`${labels.candidates}：${others.map((candidate) => `${candidate.move}${score(candidate)}`).join('、')}`)
  }
  const text = out.join('\n')
  return language === 'en' ? toAsciiPunctuation(text) : text
}

/** 英文事實表改用半形標點，避免中英混排的全形冒號與括號。 */
function toAsciiPunctuation(text: string): string {
  return text
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/（/g, ' (')
    .replace(/）/g, ')')
    .replace(/、/g, ', ')
    .replace(/ +\n/g, '\n')
}

/** 給模型看的事實表文字；超過上限時逐步減少列出的手數。 */
export function formatFactsForPrompt(
  facts: ExplanationFacts,
  language: ExplanationLanguage = 'zh-TW'
): string {
  const labels = LABELS[language]
  let maxPlies = MAX_FACT_LINE_PLIES
  let text = render(facts, labels, maxPlies, language)
  while (text.length > MAX_FACTS_PROMPT_CHARS && maxPlies > 2) {
    maxPlies -= 2
    text = render(facts, labels, maxPlies, language)
  }
  return text.length > MAX_FACTS_PROMPT_CHARS ? text.slice(0, MAX_FACTS_PROMPT_CHARS) : text
}

/** 顯示用的單條主線（前 N 手）及其關鍵事件，供「引擎重點摘要」使用。 */
export function summarizeLine(
  line: LineFacts,
  language: ExplanationLanguage = 'zh-TW',
  maxPlies = 6
): { moves: string[]; events: string[] } {
  const labels = LABELS[language]
  const events: string[] = []
  for (const ply of line.plies.slice(0, maxPlies)) {
    const side = labels.side[ply.side]
    if (ply.captured) {
      const enemy = opponent(ply.side)
      events.push(
        language === 'en'
          ? `ply ${ply.ply}: ${side} ${labels.piece[ply.side][ply.piece]} captures ${labels.side[enemy]} ${labels.piece[enemy][ply.captured]}`
          : `第 ${ply.ply} 手${side}${labels.piece[ply.side][ply.piece]}吃${labels.side[enemy]}${labels.piece[enemy][ply.captured]}`
      )
    }
    if (ply.givesCheck) {
      events.push(language === 'en' ? `ply ${ply.ply}: ${side} gives check` : `第 ${ply.ply} 手${side}方${labels.check}`)
    }
  }
  if (line.endsWith && line.plies.length <= maxPlies) {
    const last = line.plies.at(-1)
    if (last) {
      const loser = labels.side[opponent(last.side)]
      events.push(line.endsWith === 'checkmate' ? labels.checkmate(loser) : labels.stalemate(loser))
    }
  }
  return { moves: line.plies.slice(0, maxPlies).map((ply) => ply.move), events }
}
