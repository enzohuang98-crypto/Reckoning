import { INITIAL_MOVE_EXPLANATION_SECTION_IDS, type HarnessAnswerMode } from '@shared/types/Harness'

/** Shape and reference IDs only. The formal validator still checks prose and board facts. */
export function buildInitialMoveResponseSchema(
  mode: HarnessAnswerMode,
  evidenceIds: string[],
  premiseIdsByEvidence?: Record<string, readonly string[]>
): {
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
  const [bestId, userId = bestId] = evidenceIds
  const claim = (ids: string[], allowedEvidenceIds: string[], description: string): Record<string, unknown> => {
    const premiseIds = [...new Set(allowedEvidenceIds.flatMap(id => premiseIdsByEvidence?.[id] ?? []))]
    return object({
      id: { type: 'string', enum: ids },
      ...(premiseIdsByEvidence ? {
        premiseIds: { type: 'array', minItems: 0,
          // The formal validator allows a bounded insufficiency statement to
          // omit premises. Schema cannot decide that from arbitrary prose;
          // substantive core claims still require premises in that validator.
          // Keep reference uniqueness in the formal validator: provider schema
          // subsets differ, and a declared structured-output capability is not
          // a guarantee that every JSON Schema keyword is accepted.
          maxItems: premiseIds.length > 0 ? 4 : 0,
          items: premiseIds.length > 0 ? { type: 'string', enum: premiseIds } : string,
          description: '需要前提的實質敘述先選本段實際解釋的1–4項盤面前提；text必須引用對應中文著法。明確局部證據不足可填[]，是否符合豁免由正式內容驗證判定。前提只提供觀察，不證明策略推論。' },
        interpretation: { type: 'string', enum: ['observation', 'inference'] }
      } : {}),
      text: { type: 'string', description },
      evidenceIds: { ...references, items: { type: 'string', enum: allowedEvidenceIds } },
      findingIds: { type: 'array', items: { type: 'string', enum: ['K1', 'K2'] } },
      causal: { anyOf: [causal, { type: 'null' }] }
    })
  }
  // Carry each section's actual role into the decoder contract as well as the
  // prompt. IDs/shapes are constraints; descriptions remain instructions, not
  // independent proof of prose length, distinctness or strategic correctness.
  const descriptions = [
    '約90–120繁體漢字的完整結論。依本局兩線盤面說明比較狀態與限制；分差不能證明失誤，不能只重複directAnswer。',
    '約150–190繁體漢字。回答棋手原想法是否成立，依正確方別和主線次序比較具體棋子、空出的路線及後續部署；無機制證據時不硬判劣勢。',
    '約120–150繁體漢字。僅解釋首選線，逐字引用初著以外的後續著法及對手合理應手，指出走前走後位置或線路如何改變；不得以靈活、協調等空泛評語代替原因。',
    '每項約90–120繁體漢字。C4a、C4b各引用至少兩步實戰線著法，說明互不重複的具體棋盤影響及合理應手；因果在可見text中完整交代，不能藏在causal或把另一條線搬來。',
    '約70–100繁體漢字。一條由本局兩線推得的可操作原則，說明先檢查哪枚棋子或線路、判斷方法與適用限制，不重複空話。'
  ]
  const section = { anyOf: INITIAL_MOVE_EXPLANATION_SECTION_IDS.map((id, index) => object({
    id: { type: 'string', enum: [id] }, heading: string,
    claims: { type: 'array', minItems: index === 3 ? 2 : 1, maxItems: index === 3 ? 2 : 1,
      items: claim(index === 3 ? ['C4a', 'C4b'] : [`C${index === 4 ? 5 : index + 1}`],
        index === 2 ? [bestId!] : index === 3 ? [userId!] : [...new Set(evidenceIds)], descriptions[index]!) }
  })) }
  return { name: 'initial_move_explanation', schema: object({
    answer: object({
      mode: { type: 'string', enum: [mode] }, title: string, directAnswer: string,
      directAnswerEvidenceIds: references,
      sections: { type: 'array', minItems: 5, maxItems: 5, items: section,
        description: '依序輸出固定五段；五段claims.text合计至少400繁體漢字、目標500–900。正文完整回答本局原因，不能靠重複、audit、causal或heading湊數。' },
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
