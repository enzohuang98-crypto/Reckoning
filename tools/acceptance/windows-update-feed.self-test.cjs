// Transport accounting unit test only. These bytes are not installer acceptance.
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash } = require('node:crypto')
const { createFeed } = require('./windows-update-feed.cjs')

async function run() {
  const temporaryRoot = resolve(tmpdir())
  const directory = mkdtempSync(join(temporaryRoot, 'reckoning-feed-unit-'))
  const version = '0.4.15'
  const setupName = `xiangqi-analyzer-${version}-setup.exe`
  const payload = Buffer.alloc(2 * 1024 * 1024, 'This is only a transport fixture, not a Windows installer. ')
  const metadata = Buffer.from(`version: ${version}\nfiles:\n  - url: ${setupName}\n    sha512: ${createHash('sha512').update(payload).digest('base64')}\n    size: ${payload.length}\n`)
  const assets = new Map([[setupName, payload], [setupName + '.blockmap', Buffer.from('unit blockmap')], ['latest.yml', metadata]])
  const manifest = {
    version, sourceCommit: 'a'.repeat(40), productionRelease: false, signature: 'NotSigned', role: 'test-candidate',
    artifacts: [...assets].map(([name, body]) => ({ name, size: body.length, sha256: createHash('sha256').update(body).digest('hex') }))
  }
  for (const [name, body] of assets) writeFileSync(join(directory, name), body)
  writeFileSync(join(directory, 'isolated-package-manifest.json'), JSON.stringify(manifest))
  const { server } = createFeed(directory, join(directory, 'network.json'))
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const control = (phase, mode) => fetch(base + '/__probe/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phase, mode }) })
    assert.equal((await fetch(base + '/latest.yml')).status, 503)
    assert.equal((await control('controlled-failure', 'fail-payload')).status, 200)
    assert.equal((await fetch(base + '/latest.yml')).status, 200)
    assert.equal((await fetch(base + '/' + setupName)).status, 503)
    await control('download', 'healthy')
    const full = await fetch(base + '/' + setupName)
    assert.equal(full.status, 200)
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), payload)
    const range = await fetch(base + '/' + setupName, { headers: { range: 'bytes=3-8' } })
    assert.equal(range.status, 206)
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), payload.subarray(3, 9))
    assert.equal((await fetch(base + '/' + setupName, { headers: { range: `bytes=${payload.length + 5}-` } })).status, 416)
    await control('aborted-download', 'throttled')
    const controller = new AbortController()
    const interrupted = await fetch(base + '/' + setupName, { signal: controller.signal })
    await interrupted.body.getReader().read()
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 120))
    await control('install', 'healthy')
    await (await fetch(base + '/latest.yml')).arrayBuffer()
    const evidence = await (await fetch(base + '/__probe/status')).json()
    assert.equal(evidence.phases.download.installerBytes, payload.length + 6)
    assert.equal(evidence.phases.download.installerRequests, 3)
    assert.equal(evidence.phases['controlled-failure'].installerBytes, 0)
    assert.equal(evidence.phases['controlled-failure'].installerRequests, 1)
    assert.equal(evidence.phases.install.installerBytes, 0)
    assert.equal(evidence.phases.install.installerRequests, 0)
    assert.equal(evidence.phases.install.metadataBytes, metadata.length)
    const aborted = evidence.requests.find((request) => request.phase === 'aborted-download')
    assert.equal(aborted.completed, false)
    assert(aborted.bodyBytes > 0 && aborted.bodyBytes < payload.length)
    assert.equal((await control('../../unsafe', 'healthy')).status, 400)
    assert.equal((await fetch(base + '/unknown.exe')).status, 404)
    console.log('Isolated updater transport accounting: passed; synthetic server fixture only.')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    if (!resolve(directory).startsWith(temporaryRoot + sep) || !directory.includes('reckoning-feed-unit-')) throw new Error('Unsafe temporary cleanup path')
    rmSync(directory, { recursive: true, force: true })
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
