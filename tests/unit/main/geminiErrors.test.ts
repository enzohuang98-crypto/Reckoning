/**
 * Gemini 免費金鑰最常遇到 429：錯誤要是帶狀態碼與額度種類的 AIHttpError（不含服務原文），
 * v2 才能決定稍等重試、改交摘要或顯示「今天額度用完」；MAX_TOKENS 要回報成 length 讓 AnswerCheck 判截斷。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GeminiProvider } from '../../../src/main/ai/providers/GeminiProvider'
import { AIHttpError, describeAIExecutionError } from '../../../src/main/ai/http'
import type { AIExplanationRequest } from '../../../src/shared/types/AIExplanationTypes'

const request: AIExplanationRequest = {
  provider: 'gemini',
  model: 'gemini-3.5-flash',
  apiKey: 'AIza-synthetic',
  prompt: 'p',
  maxOutputTokens: 600,
  metadata: { requestId: 'r', analysisId: 'a', userLevel: 'basic', explanationStyle: 'long_analytical' }
}

async function withServer(
  respond: () => { status: number; body: unknown; headers?: Record<string, string> },
  run: (provider: GeminiProvider) => Promise<void>
): Promise<void> {
  const server = createServer((_req, res) => {
    const { status, body, headers } = respond()
    res.writeHead(status, { 'content-type': 'application/json', ...(headers ?? {}) })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    await run(new GeminiProvider({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }))
  } finally {
    server.close()
  }
}

async function failure(provider: GeminiProvider): Promise<unknown> {
  try {
    await provider.generateExplanation(request)
  } catch (error) {
    return error
  }
  throw new Error('expected failure')
}

async function main(): Promise<void> {
  // 每日額度用完：daily，v2 會顯示錯誤卡而不是一直重試。
  await withServer(
    () => ({
      status: 429,
      body: {
        error: {
          code: 429,
          message: 'Quota exceeded secret-detail',
          details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }]
        }
      }
    }),
    async (provider) => {
      const error = await failure(provider)
      assert.ok(error instanceof AIHttpError)
      assert.equal(error.status, 429)
      assert.equal(error.quota, 'daily')
      assert.equal(error.message.includes('secret-detail'), false, '不含服務原文')
      const diagnostic = describeAIExecutionError(error)
      assert.equal(diagnostic.category, 'rate_limited')
      assert.equal(diagnostic.quota, 'daily')
    }
  )

  // 每分鐘限流：minute，並讀出 RetryInfo 的等待秒數。
  await withServer(
    () => ({
      status: 429,
      body: {
        error: {
          code: 429,
          details: [
            { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }
          ]
        }
      }
    }),
    async (provider) => {
      const error = await failure(provider)
      assert.ok(error instanceof AIHttpError)
      assert.equal(error.quota, 'minute')
      assert.equal(error.retryAfterMs, 3000)
    }
  )

  // 503：一般 HTTP 錯誤也帶狀態碼，v2 會改交摘要。
  await withServer(
    () => ({ status: 503, body: { error: { code: 503, message: 'overloaded raw text' } } }),
    async (provider) => {
      const error = await failure(provider)
      assert.ok(error instanceof AIHttpError)
      assert.equal(describeAIExecutionError(error).category, 'provider_unavailable')
      assert.equal(error.message.includes('raw text'), false)
    }
  )

  // MAX_TOKENS → finishReason length，串流的 done 也帶上。
  await withServer(
    () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '寫到一半' }] }, finishReason: 'MAX_TOKENS' }] } }),
    async (provider) => {
      const chunks = []
      for await (const chunk of provider.generateExplanationStream(request, new AbortController().signal)) chunks.push(chunk)
      assert.deepEqual(chunks.at(-1), { type: 'done', usage: undefined, finishReason: 'length' })
    }
  )
  await withServer(
    () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '完整回答' }] }, finishReason: 'STOP' }] } }),
    async (provider) => {
      assert.equal((await provider.generateExplanation(request)).finishReason, 'stop')
    }
  )

  console.log('Gemini error handling tests passed')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
