import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OpenRouterProvider } from '../../../src/main/ai/providers/OpenRouterProvider'
import { AIResponseValidationError } from '../../../src/main/ai/http'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'
import Ajv from 'ajv'
import { buildInitialMoveResponseSchema } from '../../../src/main/ai/InitialMoveResponseSchema'
import { INITIAL_MOVE_EXPLANATION_SECTION_IDS } from '../../../src/shared/types/Harness'

interface RecordedRequest {
  url: string
  authorization?: string
  routerMetadata?: string
  body?: unknown
}

async function withServer(
  handler: (request: RecordedRequest) => unknown,
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const requests: RecordedRequest[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += String(chunk)
    })
    request.on('end', () => {
      const recorded: RecordedRequest = {
        url: request.url ?? '',
        authorization: request.headers.authorization,
        routerMetadata: request.headers['x-openrouter-metadata'] as string | undefined,
        body: raw ? JSON.parse(raw) : undefined
      }
      requests.push(recorded)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(handler(recorded)))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}/api/v1`, requests)
  } finally {
    server.close()
  }
}

async function main(): Promise<void> {
const responseSchema = buildInitialMoveResponseSchema('research', ['E1', 'E2'])
// Ajv is already locked with the build tooling; this validates the actual schema,
// not a second hand-written list of required properties. These are offline shapes.
const validateShape = new Ajv({ strict: true }).compile(responseSchema.schema)
const shapeFixture = {
  answer: { mode: 'research', title: 'SYNTHETIC schema fixture', directAnswer: 'SYNTHETIC',
    directAnswerEvidenceIds: ['E1'], sections: INITIAL_MOVE_EXPLANATION_SECTION_IDS.map(id => ({
      id, heading: 'SYNTHETIC', claims: [{ id: 'C1', text: 'SYNTHETIC', evidenceIds: ['E1'], findingIds: [], causal: null }]
    })), generalNotes: [], warnings: [] },
  audit: { bestMovePurpose: 'SYNTHETIC', userMoveProblem: 'SYNTHETIC',
    consequences: [{ id: 'K1', category: 'central_control', claimId: 'C4a', verified: false },
      { id: 'K2', category: 'piece_development', claimId: 'C4b', verified: false }],
    contradictions: [], enoughEvidence: false }
}
assert(validateShape(shapeFixture), JSON.stringify(validateShape.errors))
for (const mutation of ['missing', 'empty', 'foreign'] as const) {
  const invalid = structuredClone(shapeFixture)
  const principle = invalid.answer.sections[4].claims[0]
  if (mutation === 'missing') Reflect.deleteProperty(principle, 'evidenceIds')
  else principle.evidenceIds = mutation === 'empty' ? [] : ['E999']
  assert.equal(validateShape(invalid), false, `Principle ${mutation} evidence must fail actual schema`)
}
const invalidSection = structuredClone(shapeFixture)
invalidSection.answer.sections[0].id = 'follow_up' as typeof invalidSection.answer.sections[0]['id']
assert.equal(validateShape(invalidSection), false)
for (const model of ['nvidia/nemotron-3-super-120b-a12b:free', 'vendor/other:free', 'nvidia/nemotron-3-ultra-550b-a55b:free']) {
  await withServer(() => ({ model, choices: [{ message: { content: JSON.stringify(shapeFixture) }, finish_reason: 'stop' }] }),
    async (baseUrl, requests) => {
      const request: AIExplanationRequest = { provider: 'openrouter', model, apiKey: 'synthetic-test-key',
        prompt: 'SYNTHETIC offline contract', responseFormat: 'json', responseSchema, maxOutputTokens: 4_000,
        metadata: { requestId: 'schema-test', analysisId: 'schema-test', userLevel: 'intermediate', explanationStyle: 'long_analytical' } }
      await new OpenRouterProvider({ baseUrl }).generateExplanation(request)
      const body = requests[0].body as Record<string, unknown>
      if (model.includes('-super-')) {
        assert.deepEqual(body.response_format, { type: 'json_object' }, 'Super must use the bounded JSON-object contract confirmed by the live comparison')
        assert.equal(body.provider, undefined, 'Schema routing must not force the regressed constrained decoder')
        assert.deepEqual(body.reasoning, { effort: 'none', exclude: true })
      } else {
        assert.deepEqual(body.response_format, model.includes('-ultra-') ? undefined : { type: 'json_object' })
        assert.equal(body.provider, undefined, 'Unsupported model must not inherit schema routing')
      }
      assert.equal(body.max_tokens, 4_000)
    })
}
await withServer(
  ({ url }) => {
    if (url === '/api/v1/key') return { data: { label: 'test-key' } }
    return {
      data: [
        {
          id: 'meta-llama/llama-free:free',
          name: 'Llama Free',
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0', completion: '0', request: '0' }
        },
        {
          id: 'openrouter/free',
          name: 'Random Free Router',
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0', completion: '0', request: '0' }
        },
        {
          id: 'vendor/paid-model',
          name: 'Paid',
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0.000001', completion: '0', request: '0' }
        },
        {
          id: 'vendor/image-free:free',
          name: 'Image Only',
          architecture: { output_modalities: ['image'] },
          pricing: { prompt: '0', completion: '0', request: '0' }
        }
      ]
    }
  },
  async (baseUrl, requests) => {
    const models = await new OpenRouterProvider({ baseUrl }).listFreeModels('sk-or-v1-test')
    assert.deepEqual(models, [
      { id: 'meta-llama/llama-free:free', label: 'Llama Free' }
    ])
    assert.deepEqual(requests.map((request) => request.url), [
      '/api/v1/key',
      '/api/v1/models?output_modalities=text'
    ])
    assert(requests.every((request) => request.authorization === 'Bearer sk-or-v1-test'))
    assert(requests.every((request) => request.routerMetadata === 'enabled'))
  }
)

await withServer(
  () => ({
    model: 'meta-llama/llama-free:free',
    choices: [{ message: { content: '精确模型回应' } }],
    usage: { prompt_tokens: 12, completion_tokens: 7 }
  }),
  async (baseUrl, requests) => {
    const model = 'meta-llama/llama-free:free'
    const request: AIExplanationRequest = {
      provider: 'openrouter',
      model,
      apiKey: 'sk-or-v1-test',
      prompt: 'test prompt',
      metadata: {
        requestId: 'openrouter-test',
        analysisId: 'openrouter-test',
        userLevel: 'basic',
        explanationStyle: 'long_analytical'
      }
    }
    const response = await new OpenRouterProvider({ baseUrl }).generateExplanation(request)
    const body = requests[0]?.body as Record<string, unknown>
    assert.equal(requests[0]?.url, '/api/v1/chat/completions')
    assert.equal(body.model, model, 'UI 选中的完整模型 ID 必须原样送到 OpenRouter')
    assert.equal('models' in body, false, '不得附带后备模型清单让 OpenRouter 改选其他模型')
    assert.equal(response.model, model)
    assert.equal(response.text, '精确模型回应')
  }
)

await withServer(
  () => ({
    model: 'vendor/model-b:free',
    choices: [{ message: { content: 'wrong model' } }]
  }),
  async (baseUrl) => {
    const request: AIExplanationRequest = {
      provider: 'openrouter',
      model: 'vendor/model-a:free',
      apiKey: 'sk-or-v1-test',
      prompt: 'test prompt',
      metadata: {
        requestId: 'openrouter-mismatch',
        analysisId: 'openrouter-mismatch',
        userLevel: 'basic',
        explanationStyle: 'long_analytical'
      }
    }
    await assert.rejects(
      new OpenRouterProvider({ baseUrl }).generateExplanation(request),
      /模型路由不一致/
    )
  }
)

for (const format of ['json', 'text', undefined] as const) {
  await withServer(() => ({ model: 'test/model:free', choices: [{message: {content: '{"ok":true}'}}] }), async (baseUrl, requests) => {
    const request: AIExplanationRequest = {
      provider: 'openrouter', model: 'test/model:free', apiKey: 'synthetic-test-key',
      prompt: 'Return JSON', responseFormat: format,
      metadata: {requestId:'response-format',analysisId:'response-format',userLevel:'intermediate',explanationStyle:'long_analytical'}
    }
    await new OpenRouterProvider({baseUrl}).generateExplanation(request)
    const body=requests[0].body as Record<string,unknown>
    assert.deepEqual(body.response_format, format === 'json' ? {type:'json_object'} : undefined)
    assert.equal(body.reasoning, undefined)
    assert.equal(body.model, request.model)
  })
}

for (const model of ['qwen/qwen3.8-27b:free', 'qwen/qwen3.8-27b', 'qwen/qwen3.8-27b-preview:free']) {
  for (const responseFormat of ['json', 'text'] as const) {
    await withServer(() => ({ model, choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 2500, completion_tokens_details: { reasoning_tokens: 1000 } }
    }), async (baseUrl, requests) => {
      const result = await new OpenRouterProvider({ baseUrl }).generateExplanation({
        provider: 'openrouter', model, apiKey: 'synthetic-test-key', prompt: 'Offline exact endpoint contract',
        responseFormat, maxOutputTokens: 6000,
        metadata: { requestId: 'qwen-exact-policy', analysisId: 'qwen-exact-policy', userLevel: 'intermediate', explanationStyle: 'long_analytical' }
      })
      const body = requests[0].body as Record<string, unknown>
      const exactFree = model === 'qwen/qwen3.8-27b:free'
      assert.deepEqual(body.reasoning, exactFree ? { effort: 'low', exclude: true } : undefined,
        'Only the confirmed Qwen free route uses its supported lower effort to preserve visible-output room after measured reasoning exhaustion')
      assert.deepEqual(body.response_format, !exactFree && responseFormat === 'json' ? { type: 'json_object' } : undefined,
        'The exact Qwen free endpoint does not advertise response_format; prompted JSON still goes through the Harness validator')
      assert.equal(body.max_tokens, 6000, 'Selecting the strongest candidate must not silently increase its total output cap')
      assert.equal(body.provider, undefined, 'The request must not introduce provider or model fallback routing')
      assert.equal(result.model, model)
      assert.equal(result.usage?.reasoningTokens, 1000, 'Excluded reasoning still counts toward the reported output usage')
    })
  }
}
for (const content of ['', '{"partial":true}']) {
  await withServer(() => ({ model: 'qwen/qwen3.8-27b:free',
    choices: [{ message: { content }, finish_reason: 'length' }],
    usage: { completion_tokens: 6000, completion_tokens_details: { reasoning_tokens: content ? 3000 : 6000 } }
  }), async baseUrl => {
    await assert.rejects(new OpenRouterProvider({ baseUrl }).generateExplanation({
      provider: 'openrouter', model: 'qwen/qwen3.8-27b:free', apiKey: 'synthetic-test-key',
      prompt: 'Offline incomplete response', responseFormat: 'json', maxOutputTokens: 6000,
      metadata: { requestId: 'qwen-length', analysisId: 'qwen-length', userLevel: 'intermediate', explanationStyle: 'long_analytical' }
    }), error => error instanceof AIResponseValidationError && error.category === 'generation_incomplete' &&
      error.details.finishReason === 'length' && error.details.outputTokens === 6000 &&
      error.details.reasoningTokens === (content ? 3000 : 6000))
  })
}

for (const model of ['dots-studio/dots-3-note-preview:free', 'dots-studio/dots-3-note-preview', 'test/other:free']) {
  for (const responseFormat of ['json', 'text'] as const) {
    await withServer(() => ({ model, choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), async (baseUrl, requests) => {
      await new OpenRouterProvider({ baseUrl }).generateExplanation({
        provider: 'openrouter', model, apiKey: 'synthetic-test-key', prompt: 'Offline protocol contract',
        responseFormat, maxOutputTokens: 6000,
        metadata: { requestId: 'dots-exact-policy', analysisId: 'dots-exact-policy', userLevel: 'intermediate', explanationStyle: 'long_analytical' }
      })
      const body = requests[0].body as Record<string, unknown>
      assert.deepEqual(body.reasoning,
        model === 'dots-studio/dots-3-note-preview:free' && responseFormat === 'json'
          ? { enabled: false, exclude: true } : undefined,
        'Only the confirmed exact free Dots JSON endpoint gets its own optional-reasoning control')
      assert.equal(body.max_tokens, 6000, 'The policy must preserve the requested output cap')
    })
  }
}

await withServer(() => ({ model: 'dots-studio/dots-3-note-preview:free',
  choices: [{ message: { content: '{"partial":true}' }, finish_reason: 'length' }],
  usage: { completion_tokens: 6000, completion_tokens_details: { reasoning_tokens: 0 } }
}), async baseUrl => {
  await assert.rejects(new OpenRouterProvider({ baseUrl }).generateExplanation({
    provider: 'openrouter', model: 'dots-studio/dots-3-note-preview:free', apiKey: 'synthetic-test-key',
    prompt: 'Offline truncated response', responseFormat: 'json', maxOutputTokens: 6000,
    metadata: { requestId: 'dots-length', analysisId: 'dots-length', userLevel: 'intermediate', explanationStyle: 'long_analytical' }
  }), error => error instanceof AIResponseValidationError && error.category === 'generation_incomplete' &&
    error.details.finishReason === 'length' && error.details.outputTokens === 6000)
})

await withServer(
  () => ({
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }]
  }),
  async (baseUrl, requests) => {
    const request: AIExplanationRequest = {
      provider: 'openrouter',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      apiKey: 'synthetic-test-key',
      prompt: 'Return structured coaching JSON',
      responseFormat: 'json',
      maxOutputTokens: 4_000,
      metadata: {
        requestId: 'nemotron-reasoning-budget',
        analysisId: 'nemotron-reasoning-budget',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical'
      }
    }
    await new OpenRouterProvider({ baseUrl }).generateExplanation(request)
    const body = requests[0].body as Record<string, unknown>
    assert.deepEqual(body.reasoning, { max_tokens: 1_000, exclude: true })
    assert.equal(body.response_format, undefined,
      'The exact free Ultra endpoint does not advertise response_format support')
    assert.equal(body.max_tokens, 4_000)
  }
)

await withServer(
  () => ({
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 900,
      completion_tokens_details: { reasoning_tokens: 600 }
    }
  }),
  async (baseUrl, requests) => {
    const request: AIExplanationRequest = {
      provider: 'openrouter',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      apiKey: 'synthetic-test-key',
      prompt: 'Return structured coaching JSON',
      responseFormat: 'json',
      maxOutputTokens: 4_000,
      metadata: {
        requestId: 'nemotron-super-reasoning-budget',
        analysisId: 'nemotron-super-reasoning-budget',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical'
      }
    }
    const response = await new OpenRouterProvider({ baseUrl }).generateExplanation(request)
    const body = requests[0].body as Record<string, unknown>
    assert.deepEqual(body.reasoning, { effort: 'none', exclude: true })
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(body.max_tokens, 4_000)
    assert.deepEqual(response.usage, {
      inputTokens: 20,
      outputTokens: 900,
      reasoningTokens: 600,
      finishReason: 'stop'
    })
  }
)

await withServer(
  () => ({
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    choices: [{ message: { content: 'plain text' }, finish_reason: 'stop' }]
  }),
  async (baseUrl, requests) => {
    await new OpenRouterProvider({ baseUrl }).generateExplanation({
      provider: 'openrouter',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      apiKey: 'synthetic-test-key',
      prompt: 'Return plain text',
      responseFormat: 'text',
      responseSchema,
      metadata: {
        requestId: 'nemotron-super-text',
        analysisId: 'nemotron-super-text',
        userLevel: 'intermediate',
        explanationStyle: 'long_analytical'
      }
    })
    const body = requests[0].body as Record<string, unknown>
    assert.deepEqual(body.reasoning, { effort: 'none', exclude: true }, '已確認的 Super 文字 recovery 也必須保留正文預算')
    assert.equal(body.response_format, undefined, '短文字路徑不得誤套用完整講解 schema')
    assert.equal(body.provider, undefined)
  }
)

await withServer(
  () => ({
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    choices: [{ message: { content: '{"partial":true}' }, finish_reason: 'length' }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 4_000,
      completion_tokens_details: { reasoning_tokens: 1_000 }
    }
  }),
  async (baseUrl) => {
    await assert.rejects(
      new OpenRouterProvider({ baseUrl }).generateExplanation({
        provider: 'openrouter',
        model: 'nvidia/nemotron-3-super-120b-a12b:free',
        apiKey: 'synthetic-test-key',
        prompt: 'Return structured coaching JSON',
        responseFormat: 'json',
        responseSchema,
        maxOutputTokens: 4_000,
        metadata: {
          requestId: 'nemotron-super-length',
          analysisId: 'nemotron-super-length',
          userLevel: 'intermediate',
          explanationStyle: 'long_analytical'
        }
      }),
      (error: unknown) =>
        error instanceof AIResponseValidationError &&
        error.category === 'generation_incomplete' &&
        error.details.finishReason === 'length' &&
        error.details.outputTokens === 4_000 &&
        error.details.reasoningTokens === 1_000
    )
  }
)
for (const reportedUsage of [{ prompt_tokens: 20 }, { completion_tokens: 0 }, { prompt_tokens: -1, completion_tokens: -1 }]) {
  await withServer(
    () => ({ model: 'nvidia/nemotron-3-super-120b-a12b:free',
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: reportedUsage }),
    async baseUrl => {
      const response = await new OpenRouterProvider({ baseUrl }).generateExplanation({
        provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free',
        apiKey: 'synthetic-test-key', prompt: 'Synthetic partial usage', maxOutputTokens: 6000,
        metadata: { requestId: 'partial-usage', analysisId: 'partial-usage', userLevel: 'basic', explanationStyle: 'long_analytical' }
      })
      assert.equal(response.usage?.inputTokens, reportedUsage.prompt_tokens !== undefined && reportedUsage.prompt_tokens >= 0 ? reportedUsage.prompt_tokens : undefined)
      assert.equal(response.usage?.outputTokens, reportedUsage.completion_tokens !== undefined && reportedUsage.completion_tokens >= 0 ? reportedUsage.completion_tokens : undefined)
      assert.equal(response.usage?.finishReason, 'stop')
    }
  )
}
console.log('OpenRouter free-model binding, response-format, and reasoning-budget tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
