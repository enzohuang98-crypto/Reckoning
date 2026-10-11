const path = require('node:path')
const { app } = require('electron')
const root = path.resolve(__dirname, '..', '..')
process.chdir(root)
process.env.TSX_TSCONFIG_PATH = path.join(root, 'tsconfig.node.json')
app.setName('xiangqi-analyzer')
app.setPath('userData', path.join(app.getPath('appData'), 'xiangqi-analyzer'))
require('tsx/cjs')
app.whenReady().then(async () => {
  const { SecretStore } = require('../../src/main/storage/SecretStore.ts')
  const { fetchAiResponseBounded, readJsonResponseBounded } = require('../../src/main/ai/http.ts')
  const snapshot = await new SecretStore().captureActiveCredential()
  if (snapshot?.credential.provider !== 'openrouter' || !snapshot.apiKey) throw new Error('Unavailable')
  const response = await fetchAiResponseBounded('https://openrouter.ai/api/v1/key', {
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${snapshot.apiKey}` }
  })
  const body = response.ok ? await readJsonResponseBounded(response) : null
  const quota = body?.data?.free_model_daily_requests
  const safeNumber = value => Number.isSafeInteger(value) && value >= 0 ? value : null
  process.stdout.write(JSON.stringify({
    stage: 'key_metadata', status: response.status, model: snapshot.credential.model,
    freeRequestsUsed: safeNumber(quota?.used),
    freeRequestsLimit: safeNumber(quota?.limit),
    freeRequestsRemaining: safeNumber(quota?.remaining)
  }) + '\n')
  app.quit()
}).catch(() => { process.stderr.write('Safe quota metadata unavailable.\n'); app.exit(2) })
