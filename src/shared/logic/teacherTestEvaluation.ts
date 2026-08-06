import type {
  TeacherTestCaseIdentityV1,
  HarnessAnswerMode
} from '@shared/types/Harness'
import { TEACHER_TEST_CANONICALIZATION_VERSION } from '@shared/types/Harness'

/**
 * Canonicalization is deliberately conservative: only Unicode NFC and line
 * ending normalization are allowed for the free-form question. FEN, attached
 * move, mode, punctuation, and whitespace remain otherwise untouched.
 */
export function normalizeTeacherTestQuestion(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n')
}

export function canonicalizeTeacherTestCase(
  input: TeacherTestCaseIdentityV1
): string {
  return JSON.stringify({
    canonicalizationVersion: TEACHER_TEST_CANONICALIZATION_VERSION,
    positionFen: input.positionFen,
    question: normalizeTeacherTestQuestion(input.question ?? ''),
    attachedMove: input.attachedMove ?? '',
    mode: input.mode as HarnessAnswerMode
  })
}
