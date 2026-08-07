import { createHash } from 'node:crypto'
import rawCatalog from '../../../docs/operations/teacher-test-cases-v1.json'
import { canonicalizeTeacherTestCase } from '@shared/logic/teacherTestEvaluation'
import {
  TEACHER_TEST_CANONICALIZATION_VERSION,
  TEACHER_TEST_SCHEMA_VERSION,
  type HarnessAnswerMode
} from '@shared/types/Harness'

export const TEACHER_CASE_SET_ID = 'teacher-test-cases-v1' as const
export const TEACHER_CASE_SET_STATUS =
  'fixture-only; teacher-confirmation-pending' as const

export interface FrozenTeacherTestCaseV1 {
  readonly caseKey: string
  readonly positionFen: string
  readonly sideToMove: 'w' | 'b'
  readonly attachedMove: string
  readonly question: string
  readonly mode: HarnessAnswerMode
}

export interface TeacherTestCatalogV1 {
  readonly schemaVersion: 1
  readonly canonicalizationVersion: 1
  readonly caseSetStatus: typeof TEACHER_CASE_SET_STATUS
  readonly cases: readonly FrozenTeacherTestCaseV1[]
}

export class TeacherTestCatalogError extends Error {
  constructor(message = '老師凍結題目目錄無效，正式案例已停止。') {
    super(message)
    this.name = 'TeacherTestCatalogError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) freezeDeep(nested)
  return Object.freeze(value)
}

function parseCase(value: unknown): FrozenTeacherTestCaseV1 {
  if (!isRecord(value)) throw new TeacherTestCatalogError()
  const { caseKey, positionFen, sideToMove, attachedMove, question, mode } = value
  if (
    typeof caseKey !== 'string' ||
    !caseKey ||
    typeof positionFen !== 'string' ||
    !/^[^\r\n]+ [wb] /.test(positionFen) ||
    (sideToMove !== 'w' && sideToMove !== 'b') ||
    positionFen.split(' ')[1] !== sideToMove ||
    typeof attachedMove !== 'string' ||
    !/^[a-i][0-9][a-i][0-9]$/.test(attachedMove) ||
    typeof question !== 'string' ||
    !question ||
    (mode !== 'focused' && mode !== 'research')
  ) {
    throw new TeacherTestCatalogError()
  }
  return freezeDeep({ caseKey, positionFen, sideToMove, attachedMove, question, mode })
}

function parseCatalog(value: unknown): TeacherTestCatalogV1 {
  if (!isRecord(value) || !Array.isArray(value.cases)) throw new TeacherTestCatalogError()
  if (
    value.schemaVersion !== TEACHER_TEST_SCHEMA_VERSION ||
    value.canonicalizationVersion !== TEACHER_TEST_CANONICALIZATION_VERSION ||
    value.caseSetStatus !== TEACHER_CASE_SET_STATUS ||
    value.teacherConfirmedCaseCount !== 0 ||
    value.teacherConfirmedCaseSlotsRequired !== 3 ||
    value.cases.length !== 6
  ) {
    throw new TeacherTestCatalogError()
  }
  const cases = value.cases.map(parseCase)
  const caseKeys = new Set(cases.map((item) => item.caseKey))
  const caseIds = new Set(
    cases.map((item) =>
      createHash('sha256')
        .update(canonicalizeTeacherTestCase(item), 'utf8')
        .digest('hex')
    )
  )
  if (caseKeys.size !== 6 || caseIds.size !== 6) throw new TeacherTestCatalogError()
  return freezeDeep({
    schemaVersion: TEACHER_TEST_SCHEMA_VERSION,
    canonicalizationVersion: TEACHER_TEST_CANONICALIZATION_VERSION,
    caseSetStatus: TEACHER_CASE_SET_STATUS,
    cases
  })
}

let cachedCatalog: TeacherTestCatalogV1 | TeacherTestCatalogError | null = null

export function getTeacherTestCatalog(): TeacherTestCatalogV1 {
  if (cachedCatalog instanceof TeacherTestCatalogError) throw cachedCatalog
  if (cachedCatalog) return cachedCatalog
  try {
    cachedCatalog = parseCatalog(rawCatalog as unknown)
    return cachedCatalog
  } catch (error) {
    cachedCatalog =
      error instanceof TeacherTestCatalogError ? error : new TeacherTestCatalogError()
    throw cachedCatalog
  }
}

export function findFrozenTeacherTestCase(input: {
  positionFen: string
  question: string
  attachedMove: string
  mode: HarnessAnswerMode
}): FrozenTeacherTestCaseV1 | null {
  return (
    getTeacherTestCatalog().cases.find(
      (item) =>
        item.positionFen === input.positionFen &&
        item.question === input.question &&
        item.attachedMove === input.attachedMove &&
        item.mode === input.mode
    ) ?? null
  )
}
