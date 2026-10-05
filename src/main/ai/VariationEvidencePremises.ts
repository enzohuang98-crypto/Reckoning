import { chineseMoveIsMentioned } from '@shared/logic/board/ChineseNotation'
import type { PieceColor, PieceType } from '@shared/types/BoardState'
import type { HarnessEvidence } from '@shared/types/Harness'
import {
  buildVariationMechanismFacts,
  type MechanismCaptureTarget,
  type OwnerRelativeWing,
  type VariationMechanismFacts
} from './VariationMechanismFacts'

export const MAX_CLAIM_PREMISE_REFERENCES = 4

export interface VariationEvidencePremise {
  id: string
  evidenceId: string
  kind: 'move_observation' | 'capture_opportunity_added' | 'capture_opportunity_removed' | 'future_move_legality_change'
  ply: number
  relatedPlies: number[]
  moves: string[]
  /** Deterministic prompt input, never a generated explanation or fallback body. */
  text: string
}

export interface VariationPremiseOmission {
  ply: number
  futureOwnPlies?: number
  legalityChanges?: number
  addedCaptureTargets?: number
  removedCaptureTargets?: number
}

export interface VariationEvidencePremises {
  evidenceId: string
  scope: VariationMechanismFacts['scope'] & {
    omittedSourcePlies: number
    /** Only nonzero omissions are included; no duplicate raw step structures. */
    omittedByPly: VariationPremiseOmission[]
  }
  items: VariationEvidencePremise[]
  warning: string | null
  truncated: boolean
}

export interface PremiseReferenceClaim {
  text: string
  evidenceIds: readonly string[]
  /** Requiring a nonempty list is the caller's answer-contract decision. */
  premiseIds?: readonly string[]
}

const PIECE_NAMES: Record<PieceColor, Record<PieceType, string>> = {
  red: { king: '帥', advisor: '仕', elephant: '相', horse: '馬', rook: '車', cannon: '炮', pawn: '兵' },
  black: { king: '將', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '炮', pawn: '卒' }
}
const WING_NAMES: Record<OwnerRelativeWing, string> = { left: '左翼', center: '中路', right: '右翼' }
const sideName = (side: PieceColor): string => side === 'red' ? '紅方' : '黑方'

/** File/wing is relative to the target's owner, not the capturing piece. */
function targetText(target: MechanismCaptureTarget): string {
  const column = target.square.charCodeAt(0) - 97
  const file = target.side === 'red' ? 9 - column : column + 1
  const wing = file < 5 ? '右翼' : file === 5 ? '中路' : '左翼'
  return `${sideName(target.side)}${file}路${wing}${PIECE_NAMES[target.side][target.piece]}（${target.square}）`
}

/** Present the existing bounded computations; do not add chess rules or strategic conclusions. */
export function buildVariationEvidencePremises(evidence: HarnessEvidence): VariationEvidencePremises {
  const facts = buildVariationMechanismFacts(evidence)
  const items: VariationEvidencePremise[] = []
  const omittedByPly: VariationPremiseOmission[] = []
  for (const step of facts.steps) {
    const prefix = `${evidence.id}:P${step.ply}`
    const ownPiece = `${sideName(step.side)}${PIECE_NAMES[step.side][step.piece]}`
    const add = (suffix: string, kind: VariationEvidencePremise['kind'], text: string,
      relatedPlies = [step.ply], moves = [step.move]): void => {
      items.push({ id: `${prefix}:${suffix}`, evidenceId: evidence.id, kind, ply: step.ply, relatedPlies, moves, text })
    }
    add('move', 'move_observation',
      `${sideName(step.side)}${step.move}：${PIECE_NAMES[step.side][step.piece]}從己方${step.fromFile}路${WING_NAMES[step.fromWing]}（${step.fromSquare}）到${step.toFile}路${WING_NAMES[step.toWing]}（${step.toSquare}）；` +
      (step.actualCapture ? `本手吃掉${targetText(step.actualCapture)}。` : '本手未吃子。'))
    for (const target of step.captureOpportunities.added) {
      add(`add:${target.square}`, 'capture_opportunity_added',
        `${step.move}前後固定盤面相比，${ownPiece}新增可合法吃${targetText(target)}的機會。`)
    }
    for (const target of step.captureOpportunities.removed) {
      add(`remove:${target.square}`, 'capture_opportunity_removed',
        `${step.move}前後固定盤面相比，${ownPiece}減少可合法吃${targetText(target)}的機會。`)
    }
    for (const change of step.futureMoveLegalityChanges) {
      add(`future${change.futurePly}`, 'future_move_legality_change',
        `${step.move}前後固定盤面，尚未移動的${sideName(change.side)}${PIECE_NAMES[change.side][change.piece]}以本線第${change.futurePly}手${change.move}（${change.fromSquare}→${change.toSquare}），由${change.beforeLegal ? '合法' : '不合法'}變${change.afterLegal ? '合法' : '不合法'}；假設再輪${sideName(change.side)}。` +
        (change.beforeConstraint ? `走前棋規檢查：${change.beforeConstraint}` : '') +
        (change.afterConstraint ? `走後棋規檢查：${change.afterConstraint}` : ''),
        [step.ply, change.futurePly], [step.move, change.move])
    }
    const omission: VariationPremiseOmission = { ply: step.ply }
    if (step.coverage.omittedFutureOwnPlies) omission.futureOwnPlies = step.coverage.omittedFutureOwnPlies
    if (step.coverage.omittedLegalityChanges) omission.legalityChanges = step.coverage.omittedLegalityChanges
    if (step.captureOpportunities.omittedAdded) omission.addedCaptureTargets = step.captureOpportunities.omittedAdded
    if (step.captureOpportunities.omittedRemoved) omission.removedCaptureTargets = step.captureOpportunities.omittedRemoved
    if (Object.keys(omission).length > 1) omittedByPly.push(omission)
  }
  return {
    evidenceId: evidence.id,
    scope: {
      ...facts.scope,
      coverageNotice: `${facts.scope.coverageNotice}前提文字只供模型引用；引用關聯正確不代表棋理推論已證實。`,
      omittedSourcePlies: facts.scope.sourcePlies - facts.scope.replayedPlies,
      omittedByPly
    },
    items, warning: facts.warning, truncated: facts.truncated
  }
}

/**
 * Reference-link checks only. A valid ID plus matching notation does not prove
 * the claim's relation, chronology, strategy, strength, or natural-language truth.
 * Existing board/content validators and independent review remain necessary.
 */
export function validatePremiseReferences(
  claim: PremiseReferenceClaim,
  premisePools: readonly Pick<VariationEvidencePremises, 'evidenceId' | 'items'>[]
): string[] {
  const ids = claim.premiseIds ?? []
  if (ids.length === 0) return []
  const errors: string[] = []
  if (ids.length > MAX_CLAIM_PREMISE_REFERENCES) {
    errors.push(`每項敘述至多引用 ${MAX_CLAIM_PREMISE_REFERENCES} 個機制前提。`)
  }
  const byId = new Map<string, Array<{ poolEvidenceId: string; item: VariationEvidencePremise }>>()
  for (const pool of premisePools) {
    for (const item of pool.items) {
      const matches = byId.get(item.id) ?? []
      matches.push({ poolEvidenceId: pool.evidenceId, item })
      byId.set(item.id, matches)
    }
  }
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      errors.push(`前提 ${id} 重複引用。`)
      continue
    }
    seen.add(id)
    const matches = byId.get(id)
    if (!matches) {
      errors.push(`前提 ${id} 不存在於本次證據。`)
      continue
    }
    if (matches.length !== 1) {
      errors.push(`前提 ${id} 在本次證據中不唯一。`)
      continue
    }
    const { poolEvidenceId, item } = matches[0]
    if (poolEvidenceId !== item.evidenceId || !claim.evidenceIds.includes(item.evidenceId)) {
      errors.push(`前提 ${id} 不屬於本項引用的變例。`)
      continue
    }
    const matched = (move: string): boolean => chineseMoveIsMentioned(claim.text, move)
    const relevant = item.kind === 'future_move_legality_change'
      ? item.moves.every(matched) : item.moves.some(matched)
    if (!relevant) {
      errors.push(item.kind === 'future_move_legality_change'
        ? `前提 ${id} 要求可見正文同時提到來源與後續著法：${item.moves.join('、')}。`
        : `前提 ${id} 缺少可見正文中的相關著法：${item.moves.join('、')}。`)
    }
  }
  return errors
}
