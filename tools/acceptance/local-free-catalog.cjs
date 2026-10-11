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
  const { OpenRouterSavedModelService } = require('../../src/main/ai/switchOpenRouterModel.ts')
  const store = new SecretStore()
  const source = (await store.getStatus()).activeCredential
  if (source?.provider !== 'openrouter') throw new Error('No active OpenRouter source')
  const result = await new OpenRouterSavedModelService(store).listModels(source)
  process.stdout.write(JSON.stringify({
    activeModel: source.model,
    ok: result.ok,
    freeModels: result.ok ? result.models.map(({ id }) => id) : [],
    errorCode: result.ok ? null : result.code
  }) + '\n')
  app.quit()
}).catch(() => {
  process.stderr.write('Safe free catalog lookup failed.\n')
  app.exit(2)
})
