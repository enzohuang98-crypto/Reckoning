const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { app } = require('electron')

const root = path.resolve(__dirname, '..', '..')
process.chdir(root)
process.env.TSX_TSCONFIG_PATH = path.join(root, 'tsconfig.node.json')
app.setName('xiangqi-analyzer')
app.setPath('userData', path.join(app.getPath('appData'), 'xiangqi-analyzer'))
require('tsx/cjs')

app.whenReady().then(async () => {
  const { SecretStore } = require('../../src/main/storage/SecretStore.ts')
  const { OpenRouterSavedModelService } = require('../../src/main/ai/switchOpenRouterModel.ts')
  const { readJsonResponseBounded } = require('../../src/main/ai/http.ts')
  const store = new SecretStore()
  const source = (await store.getStatus()).activeCredential
  const target = process.argv[2]
  if (source?.provider !== 'openrouter' || !target) throw new Error('Missing active OpenRouter model or target')
  const routing = []
  if (process.env.RECKONING_SAFE_PERMISSION_DIAGNOSTIC === '1') {
    if (!['thinkingmachines/inkling:free', 'thinkingmachines/inkling-small:free'].includes(target)) throw new Error('Permission diagnostic only permits the named free targets.')
    const formalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async (input, init) => {
      const response = await formalFetch(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://openrouter.ai/api/v1/chat/completions') {
        try {
          const body = await readJsonResponseBounded(response.clone())
          if (body.error) {
            const raw = body.error.metadata?.raw
            const message = [body.error.message, raw, raw?.message, raw?.error?.message].filter(value => typeof value === 'string').join(' ')
            const category = /data policy|privacy|data retention|training on/i.test(message) ? 'account_data_policy'
              : /agentic|harness|coding agent|code agent/i.test(message) ? 'agentic_harness_restriction'
              : /preview|early access|waitlist|invite|allowlist/i.test(message) ? 'preview_access_required'
              : /key.{0,50}(?:model|restrict|allow)|model.{0,50}(?:key|restrict|allow)/i.test(message) ? 'key_model_restriction'
              : 'unclassified_permission_denial'
            routing.push({ httpStatus: typeof body.error.code === 'number' ? body.error.code : response.status, category })
          }
        } catch { routing.push({ httpStatus: response.status, category: 'permission_reason_unreadable' }) }
      }
      return response
    }
  }
  const result = await new OpenRouterSavedModelService(store).switchModel(source, target, randomUUID())
  const after = await store.getStatus()
  process.stdout.write(JSON.stringify({
    ok: result.ok,
    code: result.ok ? null : result.code,
    diagnostic: result.ok ? null : result.diagnostic ? {
      stage: result.diagnostic.stage,
      category: result.diagnostic.category,
      retryable: result.diagnostic.retryable,
      retryAfterMs: result.diagnostic.retryAfterMs ?? null
    } : null,
    beforeModel: source.model,
    targetModel: target,
    afterModel: after.activeCredential?.model ?? null,
    ...(process.env.RECKONING_SAFE_PERMISSION_DIAGNOSTIC === '1' ? { safePermissionClassification: routing } : {})
  }) + '\n')
  app.quit()
}).catch(() => {
  process.stderr.write('Formal saved-model switch failed.\n')
  app.exit(2)
})
