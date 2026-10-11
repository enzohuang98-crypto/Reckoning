import assert from 'node:assert/strict'
import { isolatedUpdaterProbeId } from './isolated-build-policy'

const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ID: '123456789' }
for (const mode of ['production', 'development', 'test', '']) {
  assert.equal(isolatedUpdaterProbeId(mode, hosted), null,
    'Ordinary builds must exclude instrumentation even with hosted environment variables.')
}
assert.equal(isolatedUpdaterProbeId('isolated-updater-acceptance', hosted), '123456789')
for (const environment of [
  {}, { ...hosted, GITHUB_ACTIONS: 'false' }, { ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' },
  { ...hosted, GITHUB_RUN_ID: '' }, { ...hosted, GITHUB_RUN_ID: '../profile' },
  { ...hosted, GITHUB_RUN_ID: '0' }, { ...hosted, GITHUB_RUN_ID: '1'.repeat(21) }
]) {
  assert.throws(() => isolatedUpdaterProbeId('isolated-updater-acceptance', environment),
    /explicit hosted VM build/)
}
console.log('Isolated updater build boundary: 12 assertions passed; no application or credentials used.')
