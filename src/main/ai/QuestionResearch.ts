import { parseFen } from '@shared/logic/board/fen'
import { applyUciMove, legalMoveCheck } from '@shared/logic/board/moves'
import { formatChineseMove } from '@shared/logic/board/ChineseNotation'
import type { EngineAnalysis } from '@shared/types/EngineAnalysis'
import type { HarnessEvidence, HarnessResearchTrace, HarnessResearchUpdate } from '@shared/types/Harness'
import { HARNESS_RESEARCH_MAX_TOTAL_PREFIX_PLIES } from '@shared/types/Harness'
import type { EngineLiveAnalysisProgress } from '../engine/PikafishAdapter'

export const QUESTION_RESEARCH_MAX_QUERIES = 3
export const QUESTION_RESEARCH_MAX_PREFIX = 8
export const QUESTION_RESEARCH_MAX_UPDATES = 96
const RECORDED_PV_PLIES = 32

/** Routing only; this does not decide whether a chess assertion is true. */
export function isStrategicResearchQuestion(question: string | undefined): boolean {
  return /為什麼|为什么|為何|为何|怎[樣样麼么]|原因|計[畫划]|计划|想法|不如|[優优劣]|失[誤误]|反[擊击]|[應应]對|[应應]手|首[選选]|最佳|why|plan|counter|better|worse|mistake|respond/i.test(question ?? '')
}

export interface ResolvedResearchAction {
  kind: 'root' | 'evaluate_move' | 'continue_line'
  purpose: string
  positionFen: string
  userMove?: string
  prefix: string[]
  sourceEvidenceId?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Replay through the application's existing rules, without altering a session. */
export function replayResearchLine(fen: string, moves: readonly string[]) {
  const parsed = parseFen(fen)
  if (!parsed.valid) return null
  let board = parsed.board
  const display: string[] = []
  for (const move of moves) {
    if (typeof move !== 'string' || !legalMoveCheck(board.grid, board.sideToMove, move).ok) return null
    const notation = formatChineseMove(board, move)
    const applied = applyUciMove(board, move)
    if (!notation || !applied.valid) return null
    display.push(notation)
    board = applied.board
  }
  return { board, display }
}

export function researchEvidenceLine(item: HarnessEvidence): string[] {
  return item.move !== undefined && item.move === item.analysis.userMove
    ? item.analysis.userMovePrincipalVariation ?? [] : item.analysis.principalVariation
}

export function resolveResearchAction(
  raw: unknown, rootFen: string, evidence: readonly HarnessEvidence[]
): ResolvedResearchAction | null {
  if (!record(raw) || typeof raw.purpose !== 'string' || !raw.purpose.trim()) return null
  const allowed = raw.kind === 'root' ? ['kind', 'purpose'] : raw.kind === 'evaluate_move'
    ? ['kind', 'purpose', 'move'] : ['kind', 'purpose', 'evidenceId', 'prefixPlies', 'move']
  if (Object.keys(raw).some(key => !allowed.includes(key))) return null
  const purpose = raw.purpose.trim().slice(0, 160)
  if (raw.kind === 'root') return parseFen(rootFen).valid
    ? { kind: 'root', purpose, positionFen: rootFen, prefix: [] } : null
  if (raw.kind === 'evaluate_move') {
    if (typeof raw.move !== 'string' || !replayResearchLine(rootFen, [raw.move])) return null
    return { kind: 'evaluate_move', purpose, positionFen: rootFen, userMove: raw.move, prefix: [] }
  }
  if (raw.kind !== 'continue_line' || typeof raw.evidenceId !== 'string' ||
    !Number.isInteger(raw.prefixPlies) || (raw.prefixPlies as number) < 1 ||
    (raw.prefixPlies as number) > QUESTION_RESEARCH_MAX_PREFIX ||
    (raw.move !== undefined && raw.move !== null && typeof raw.move !== 'string')) return null
  const source = evidence.find(item => item.id === raw.evidenceId && item.positionFen === rootFen && !item.analysis.incomplete)
  if (!source) return null
  const line = researchEvidenceLine(source)
  const inheritedPrefix = source.researchOrigin?.prefix ?? []
  if (!inheritedPrefix.every((move, index) => line[index] === move) ||
    (source.researchOrigin && replayResearchLine(rootFen, inheritedPrefix)?.board.fen !== source.researchOrigin.searchPositionFen)) return null
  const end = inheritedPrefix.length + (raw.prefixPlies as number)
  if (end > line.length || end > HARNESS_RESEARCH_MAX_TOTAL_PREFIX_PLIES) return null
  const prefix = line.slice(0, end)
  const replay = replayResearchLine(rootFen, prefix)
  if (!replay || (typeof raw.move === 'string' && !replayResearchLine(replay.board.fen, [raw.move]))) return null
  return { kind: 'continue_line', purpose, positionFen: replay.board.fen, prefix,
    sourceEvidenceId: source.id, ...(typeof raw.move === 'string' ? { userMove: raw.move } : {}) }
}

export function parseResearchDecision(raw: unknown, rootFen: string, evidence: readonly HarnessEvidence[]): {
  decision: 'research' | 'answer'; actions: ResolvedResearchAction[]; valid: boolean
} {
  if (!record(raw) || !['research', 'answer'].includes(String(raw.decision)) ||
    typeof raw.reason !== 'string' || !Array.isArray(raw.tasks) || raw.tasks.length > 2 ||
    Object.keys(raw).some(key => !['decision', 'reason', 'tasks'].includes(key))) {
    return { decision: 'research', actions: [], valid: false }
  }
  const actions = raw.tasks.map(task => resolveResearchAction(task, rootFen, evidence))
  const valid = actions.every(action => action !== null) && (raw.decision === 'answer' ? actions.length === 0 : actions.length > 0)
  return { decision: raw.decision as 'research' | 'answer', actions: valid ? actions as ResolvedResearchAction[] : [], valid }
}

export function buildResearchDecisionSchema() {
  const string = { type: 'string' }
  const object = (properties: Record<string, unknown>) => ({ type: 'object', properties,
    required: Object.keys(properties), additionalProperties: false })
  return { name: 'question_research_decision', schema: object({
    decision: { type: 'string', enum: ['research', 'answer'] }, reason: string,
    tasks: { type: 'array', maxItems: 2, items: { anyOf: [
      object({ kind: { type: 'string', enum: ['root'] }, purpose: string }),
      object({ kind: { type: 'string', enum: ['evaluate_move'] }, purpose: string, move: string }),
      object({ kind: { type: 'string', enum: ['continue_line'] }, purpose: string,
        evidenceId: string, prefixPlies: { type: 'integer', minimum: 1, maximum: QUESTION_RESEARCH_MAX_PREFIX },
        move: { anyOf: [string, { type: 'null' }] } })
    ] } }
  }) }
}

/** Only a completed, fully legal engine line becomes claim evidence. */
export function completedResearchEvidence(input: {
  rootFen: string; action: ResolvedResearchAction; analysis: EngineAnalysis;
  evidence: readonly HarnessEvidence[]; operationId: string; nextId: number
}): HarnessEvidence[] {
  const { rootFen, action, analysis } = input
  const parsed = parseFen(action.positionFen)
  if (!parsed.valid || analysis.positionFen !== parsed.board.fen || analysis.sideToMove !== parsed.board.sideToMove || analysis.incomplete) return []
  if (analysis.bestMove !== analysis.principalVariation[0]) return []
  const lines = action.kind === 'continue_line'
    ? [{ line: action.userMove ? analysis.userMovePrincipalVariation ?? [] : analysis.principalVariation, move: action.userMove }]
    : [{ line: analysis.principalVariation, move: undefined },
      ...(action.userMove ? [{ line: analysis.userMovePrincipalVariation ?? [], move: action.userMove }] : [])]
  const source = input.evidence.find(item => item.id === action.sourceEvidenceId)
  // Recheck the actual source at completion. A resolved action is not a trust
  // token for an invented prefix or a changed evidence snapshot.
  if (action.kind === 'continue_line' && (!source || source.positionFen !== rootFen || source.analysis.incomplete ||
    action.prefix.length <= (source.researchOrigin?.prefix.length ?? 0) ||
    action.prefix.length > (source.researchOrigin?.prefix.length ?? 0) + QUESTION_RESEARCH_MAX_PREFIX ||
    action.prefix.length > HARNESS_RESEARCH_MAX_TOTAL_PREFIX_PLIES ||
    (source.researchOrigin && replayResearchLine(rootFen, source.researchOrigin.prefix)?.board.fen !== source.researchOrigin.searchPositionFen) ||
    !action.prefix.every((move, index) => researchEvidenceLine(source)[index] === move) ||
    replayResearchLine(rootFen, action.prefix)?.board.fen !== action.positionFen)) return []
  if (action.kind !== 'continue_line' && (action.positionFen !== rootFen || action.prefix.length > 0)) return []
  const results: HarnessEvidence[] = []
  for (const { line, move } of lines) {
    if (!line.length || (move && (analysis.userMove !== move || line[0] !== move))) continue
    const searched = replayResearchLine(action.positionFen, line)
    const combined = [...action.prefix, ...line]
    const rooted = replayResearchLine(rootFen, combined)
    if (!searched || !rooted) continue
    const conditional = action.kind === 'continue_line'
    const root = parseFen(rootFen)
    if (!root.valid) continue
    const userMove = conditional ? source?.move : move
    const resultAnalysis: EngineAnalysis = conditional ? {
      positionFen: rootFen, sideToMove: root.board.sideToMove,
      bestMove: combined[0]!, displayBestMove: rooted.display[0],
      ...(userMove ? { userMove, displayUserMove: rooted.display[0],
        userMovePrincipalVariation: combined, displayUserMovePrincipalVariation: rooted.display } : {}),
      scoreAfterBestMove: null, scoreAfterUserMove: null,
      evaluationAfterBestMove: null, evaluationAfterUserMove: null, userMoveEvaluationSource: 'unavailable',
      depth: null, principalVariation: combined, displayPrincipalVariation: rooted.display,
      candidateMoves: [], incomplete: false, warnings: ['此線條件式延續已驗證前綴；搜尋深度屬於後續局面，原局面相對評估未知。'],
      engineId: analysis.engineId, engineName: analysis.engineName
    } : { ...analysis, rawAnalysis: undefined,
      displayBestMove: replayResearchLine(rootFen, analysis.principalVariation)?.display[0],
      displayPrincipalVariation: replayResearchLine(rootFen, analysis.principalVariation)?.display ?? [],
      displayUserMove: analysis.userMove ? replayResearchLine(rootFen, [analysis.userMove])?.display[0] : undefined,
      // The other variation must pass the same replay check before it can be
      // used by downstream adequacy checks or supplied as a continuation.
      userMovePrincipalVariation: analysis.userMove && analysis.userMovePrincipalVariation?.[0] === analysis.userMove &&
        replayResearchLine(rootFen, analysis.userMovePrincipalVariation)
        ? analysis.userMovePrincipalVariation : undefined,
      displayUserMovePrincipalVariation: analysis.userMovePrincipalVariation?.[0] === analysis.userMove
        ? replayResearchLine(rootFen, analysis.userMovePrincipalVariation ?? [])?.display : undefined }
    results.push({ id: `E${input.nextId + results.length}`, engineId: analysis.engineId ?? 'unknown-engine',
      engineName: analysis.engineName, purpose: action.purpose, positionFen: rootFen,
      ...(userMove ? { move: userMove } : {}), displayMove: rooted.display[0],
      depth: conditional ? null : analysis.depth,
      score: conditional ? null : move ? analysis.scoreAfterUserMove : analysis.scoreAfterBestMove,
      displayPrincipalVariation: rooted.display, analysis: resultAnalysis,
      researchOrigin: { operationId: input.operationId, sourceEvidenceId: action.sourceEvidenceId,
        searchPositionFen: action.positionFen, searchSideToMove: parsed.board.sideToMove,
        prefix: [...action.prefix], searchDepth: analysis.depth, searchPrincipalVariation: line.slice(0, RECORDED_PV_PLIES),
        omittedSearchPlies: Math.max(0, line.length - RECORDED_PV_PLIES),
        ...(action.userMove ? { searchUserMove: action.userMove } : {}),
        lineRole: conditional ? action.userMove || source?.researchOrigin?.lineRole === 'hypothesis'
          ? 'hypothesis' : 'continuation' : 'root',
        rootRelativeEvaluation: conditional ? 'unknown' : 'searched_at_root' }
    })
  }
  return results
}

/** Consume all valid public UCI updates locally; never claim access to search nodes. */
export function recordResearchUpdate(trace: HarnessResearchTrace, input: {
  requestId: string; operationId: string; action: ResolvedResearchAction; live: EngineLiveAnalysisProgress
}): HarnessResearchUpdate | null {
  const { live, action } = input
  const phaseFen = live.phase === 'user_move_analysis' && action.userMove
    ? replayResearchLine(action.positionFen, [action.userMove])?.board.fen : action.positionFen
  if (!phaseFen || !['root_analysis', 'user_move_analysis'].includes(live.phase) ||
    (live.phase === 'user_move_analysis' && !action.userMove) ||
    (live.depth !== null && (!Number.isSafeInteger(live.depth) || live.depth < 0)) ||
    !Number.isSafeInteger(live.candidateRank) || live.candidateRank < 1 || live.candidateRank > 3 ||
    !Array.isArray(live.principalVariation) || live.principalVariation.length === 0) {
    trace.invalidUpdates += 1; return null
  }
  const replay = replayResearchLine(phaseFen, live.principalVariation)
  const board = parseFen(phaseFen)
  if (!replay || !board.valid) { trace.invalidUpdates += 1; return null }
  const update: HarnessResearchUpdate = {
    requestId: input.requestId, operationId: input.operationId, phase: live.phase,
    positionFen: phaseFen, sideToMove: board.board.sideToMove, depth: live.depth,
    candidateRank: live.candidateRank, principalVariation: live.principalVariation.slice(0, RECORDED_PV_PLIES),
    displayPrincipalVariation: replay.display.slice(0, RECORDED_PV_PLIES),
    omittedPlies: Math.max(0, live.principalVariation.length - RECORDED_PV_PLIES), provisional: true
  }
  trace.updatesSeen += 1
  if (trace.updates.length >= QUESTION_RESEARCH_MAX_UPDATES) { trace.updates.shift(); trace.omittedUpdates += 1 }
  trace.updates.push(update)
  return update
}

export function latestResearchUpdates(trace: HarnessResearchTrace): HarnessResearchUpdate[] {
  const latest = new Map<string, HarnessResearchUpdate>()
  for (const update of trace.updates) latest.set(`${update.operationId}:${update.phase}:${update.candidateRank}`, update)
  return [...latest.values()]
}
