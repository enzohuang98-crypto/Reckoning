const path = require('node:path')
const { app } = require('electron')

const root = path.resolve(__dirname, '..', '..')
process.chdir(root)
process.env.TSX_TSCONFIG_PATH = path.join(root, 'tsconfig.node.json')
app.setName('xiangqi-analyzer')
app.setPath('userData', path.join(app.getPath('appData'), 'xiangqi-analyzer'))
require('tsx/cjs')

app.whenReady().then(async () => {
  const { fetchAiResponseBounded } = require('../../src/main/ai/http.ts')
  const publicResponse = await fetchAiResponseBounded(
    'https://openrouter.ai/api/v1/models?output_modalities=text',
    { signal: AbortSignal.timeout(10000) }
  )
  const { SecretStore } = require('../../src/main/storage/SecretStore.ts')
  const store = new SecretStore()
  const status = await store.getStatus()
  const activeSnapshot = await store.captureActiveCredential()
  const nexSnapshot = await store.captureCredential('openrouter', 'nex-agi/nex-n2.5-pro:free')
  const { OpenRouterSavedModelService } = require('../../src/main/ai/switchOpenRouterModel.ts')
  const catalog = status.activeCredential?.provider === 'openrouter'
    ? await new OpenRouterSavedModelService(store).listModels(status.activeCredential)
    : null
  process.stdout.write(JSON.stringify({
    encryptionAvailable: store.isEncryptionAvailable(),
    nodeVersion: process.versions.node,
    systemCaApi: typeof require('node:tls').getCACertificates,
    setDefaultCaApi: typeof require('node:tls').setDefaultCACertificates,
    publicFetchStatus: publicResponse.status,
    configured: status.configured,
    activeCredential: status.activeCredential,
    nexProUsesActiveKey: Boolean(activeSnapshot?.apiKey && nexSnapshot.apiKey &&
      activeSnapshot.apiKey === nexSnapshot.apiKey),
    freeModels: catalog?.ok ? catalog.models.map(({ id }) => id) : [],
    catalogError: catalog && !catalog.ok ? catalog.code : null,
    credentials: status.credentials.map(({ provider, model, configured, needsReentry }) => ({
      provider, model, configured, needsReentry
    }))
  }) + '\n')
  app.quit()
}).catch(() => {
  process.stderr.write('Credential status read failed.\n')
  app.exit(2)
})
