import { INITIAL_MOVE_EXPLANATION_SECTION_IDS, type HarnessAnswerMode } from '@shared/types/Harness'

/** Shape and reference IDs only. The formal validator still checks prose and board facts. */
export function buildInitialMoveResponseSchema(mode: HarnessAnswerMode, evidenceIds: string[]): {
  name: string; schema: Record<string, unknown>
} {
  if (evidenceIds.length === 0) throw new Error('Initial explanation schema requires engine evidence.')
  const string = { type: 'string' }
  const strings = { type: 'array', items: string }
  const object = (properties: Record<string, unknown>): Record<string, unknown> => ({
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false
  })
  const references = { type: 'array', minItems: 1, items: { type: 'string', enum: [...new Set(evidenceIds)] } }
  const causal = object({ cause: string, mechanism: string, affected: string,
    opponentUse: string, consequence: string })
  const claim = object({
    id: string, text: string, evidenceIds: references,
    findingIds: { type: 'array', items: { type: 'string', enum: ['K1', 'K2'] } },
    causal: { anyOf: [causal, { type: 'null' }] }
  })
  const section = object({
    id: { type: 'string', enum: INITIAL_MOVE_EXPLANATION_SECTION_IDS }, heading: string,
    claims: { type: 'array', minItems: 1, maxItems: 2, items: claim }
  })
  return { name: 'initial_move_explanation', schema: object({
    answer: object({
      mode: { type: 'string', enum: [mode] }, title: string, directAnswer: string,
      directAnswerEvidenceIds: references,
      sections: { type: 'array', minItems: 5, maxItems: 5, items: section },
      generalNotes: strings, warnings: strings
    }),
    audit: object({
      bestMovePurpose: string, userMoveProblem: string,
      consequences: { type: 'array', minItems: 2, maxItems: 2, items: object({
        id: { type: 'string', enum: ['K1', 'K2'] }, category: string,
        claimId: { type: 'string', enum: ['C4a', 'C4b'] }, verified: { type: 'boolean' }
      }) },
      contradictions: strings, enoughEvidence: { type: 'boolean' }
    })
  }) }
}
