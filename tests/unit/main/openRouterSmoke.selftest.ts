import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve, sep } from 'node:path'
import {
  classifySmokeError,
  resolveLocalReviewPath,
  runSmoke
} from '../../../tools/acceptance/openrouter-smoke'

const FAKE_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'

async function main(): Promise<void> {
  const seenBodies: Array<Record<string, unknown>> = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += String(chunk)
    })
    request.on('end', () => {
      assert.equal(request.headers.authorization, `Bearer ${FAKE_KEY}`)
      if (request.url === '/api/v1/key') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: { limit: null, usage: 0, is_free_tier: true, label: 'secret-label' } }))
        return
      }
      if (request.url?.startsWith('/api/v1/models')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          data: [
            {
              id: 'vendor/good:free',
              context_length: 32000,
              top_provider: { max_completion_tokens: 4096 },
              supported_parameters: ['reasoning', 'max_tokens']
            },
            { id: 'vendor/paid', supported_parameters: [] }
          ]
        }))
        return
      }
      const body = JSON.parse(raw) as Record<string, unknown>
      seenBodies.push(body)
      if (body.model === 'vendor/limited:free') {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day. secret detail' } }))
        return
      }
      if (body.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(': OPENROUTER PROCESSING\n\n')
        response.write(`data: ${JSON.stringify({ model: 'vendor/good', choices: [{ delta: { content: '炮二平五' } }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ model: 'vendor/good', choices: [{ delta: { content: '先佔中路。' }, finish_reason: 'stop' }], usage: { completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 } } })}\n\n`)
        response.end('data: [DONE]\n\n')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        model: 'vendor/good:free',
        choices: [{ message: { content: '炮二平五先佔中路，比馬八進七更快。' }, finish_reason: 'stop' }],
        usage: { completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 5 } }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const logs: string[] = []
  try {
    const { port } = server.address() as AddressInfo
    const report = await runSmoke({
      apiKey: FAKE_KEY,
      models: ['vendor/good:free', 'vendor/limited:free'],
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      intervalMs: 0,
      log: (line) => logs.push(line)
    })

    assert.equal(report.keyPrefix, 'sk-or-v1…')
    assert.deepEqual(report.keyInfo, { limit: null, usage: 0, is_free_tier: true })
    assert.deepEqual(report.freeModels.map((model) => model.id), ['vendor/good:free'])
    assert.equal(report.freeModels[0].maxCompletionTokens, 4096)
    assert.equal(report.attempts.length, 6)

    const [plain, off, stream] = report.attempts
    assert.equal(plain.httpStatus, 200)
    assert.equal(plain.modelMatches, true)
    assert.equal(plain.reasoningTokens, 5)
    assert.equal(seenBodies[0].reasoning, undefined, 'plain variant must not send reasoning')
    assert.deepEqual(seenBodies[1].reasoning, { effort: 'none', exclude: true })
    assert.equal(off.finishReason, 'stop')
    assert.equal(stream.firstTokenMs !== null, true)
    assert.equal(stream.contentPreview, '炮二平五先佔中路。')
    assert.equal(stream.modelMatches, false, 'stream reported vendor/good without :free')
    assert.equal(stream.completionTokens, 12)

    const limited = report.attempts.filter((attempt) => attempt.model === 'vendor/limited:free')
    assert.equal(limited.length, 3)
    assert.ok(limited.every((attempt) => attempt.errorCategory === 'rate_limited_daily'))

    const serialized = JSON.stringify(report) + logs.join('\n')
    assert.equal(serialized.includes(FAKE_KEY), false, 'report must not contain the key')
    assert.equal(serialized.includes('secret detail'), false, 'report must not keep provider error text')
    assert.equal(serialized.includes('secret-label'), false, 'report must not keep key labels')

    await assert.rejects(
      runSmoke({ apiKey: FAKE_KEY, models: ['vendor/paid'], baseUrl: `http://127.0.0.1:${port}/api/v1`, intervalMs: 0, log: () => {} }),
      /只允許 :free/
    )
  } finally {
    server.close()
  }

  assert.equal(classifySmokeError(429, 'free-models-per-min'), 'rate_limited_minute')
  assert.equal(classifySmokeError(null, ''), 'network_or_timeout')
  assert.equal(classifySmokeError(503, ''), 'provider_unavailable')
  const repo = resolve('repo-root-for-test')
  const reviewDir = join(repo, '.local-review')
  assert.equal(resolveLocalReviewPath('run.json', repo), join(reviewDir, 'run.json'))
  const escaped = resolveLocalReviewPath('../../etc/passwd', repo)
  assert.ok(escaped.startsWith(reviewDir + sep), escaped)

  console.log('openRouterSmoke self-test passed')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
