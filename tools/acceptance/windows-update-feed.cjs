// Actual installer transport for an ephemeral Windows client. No provider keys,
// synthetic executable, official update feed, Electron injection or public release.
const { createServer } = require('node:http')
const { createHash } = require('node:crypto')
const { readFileSync, createReadStream, writeFileSync } = require('node:fs')
const { resolve, join, basename } = require('node:path')
const assert = require('node:assert/strict')

function createFeed(directory, evidencePath) {
  const root = resolve(directory)
  const manifest = JSON.parse(readFileSync(join(root, 'isolated-package-manifest.json'), 'utf8').replace(/^\uFEFF/, ''))
  assert.equal(manifest.productionRelease, false)
  assert.equal(manifest.signature, 'NotSigned')
  assert.equal(manifest.role, 'test-candidate')
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/i)
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  const assets = new Map()
  for (const artifact of manifest.artifacts) {
    assert.equal(basename(artifact.name), artifact.name)
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/i)
    const body = readFileSync(join(root, artifact.name))
    assert.equal(body.length, artifact.size)
    assert.equal(createHash('sha256').update(body).digest('hex').toUpperCase(), artifact.sha256.toUpperCase())
    assets.set('/' + artifact.name, { ...artifact, path: join(root, artifact.name) })
  }
  assert.equal(assets.size, 3)
  assert(assets.has('/latest.yml'))
  const setup = assets.get(`/xiangqi-analyzer-${manifest.version}-setup.exe`)
  assert(setup)
  assert(assets.has(`/xiangqi-analyzer-${manifest.version}-setup.exe.blockmap`))
  const metadata = readFileSync(assets.get('/latest.yml').path, 'utf8').replace(/^\uFEFF/, '')
  assert.match(metadata, new RegExp(`^version: ${manifest.version.replaceAll('.', '\\.')}$`, 'm'))
  const body = readFileSync(setup.path)
  assert(metadata.includes(createHash('sha512').update(body).digest('base64')))
  let phase = 'withheld'
  let mode = 'withhold'
  let failuresLeft = 0
  let evidenceClosed = false
  const report = { sourceCommit: manifest.sourceCommit, version: manifest.version, installerSha256: setup.sha256, installerSize: setup.size, differences: manifest.differences, requests: [], phases: {} }
  function persist() { if (!evidenceClosed) writeFileSync(evidencePath, JSON.stringify(report, null, 2)) }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:18765')
    if (url.pathname === '/__probe/status' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ phase, mode, ...report }))
      return
    }
    if (url.pathname === '/__probe/control' && request.method === 'POST') {
      let input = ''
      for await (const chunk of request) { input += chunk; if (input.length > 2048) { response.writeHead(413).end(); return } }
      try {
        const value = JSON.parse(input)
        assert.match(value.phase, /^[a-z0-9-]{1,48}$/)
        assert(['healthy', 'withhold', 'fail-once', 'fail-payload', 'throttled'].includes(value.mode))
        phase = value.phase; mode = value.mode; failuresLeft = mode === 'fail-once' ? 1 : 0
        persist()
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ phase, mode }))
      } catch { response.writeHead(400).end('invalid probe control') }
      return
    }
    const artifact = assets.get(url.pathname)
    if (!artifact || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end(); return }
    const kind = url.pathname === '/latest.yml' ? 'metadata' : url.pathname.endsWith('.blockmap') ? 'blockmap' : 'installer'
    const entry = { phase, kind, path: artifact.name, method: request.method, range: request.headers.range ?? null, status: 200, bodyBytes: 0, expectedBodyBytes: 0, active: false, completed: false, at: new Date().toISOString() }
    report.requests.push(entry)
    const totals = report.phases[phase] ??= { metadataBytes: 0, blockmapBytes: 0, installerBytes: 0, installerRequests: 0 }
    if (kind === 'installer') totals.installerRequests++
    if (mode === 'withhold' || (kind === 'installer' && (mode === 'fail-payload' || failuresLeft-- > 0))) {
      entry.status = 503; entry.completed = true; persist()
      response.writeHead(503, { 'retry-after': '1' }).end()
      return
    }
    let start = 0, end = artifact.size - 1
    if (request.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range)
      if (!range) { entry.status = 416; persist(); response.writeHead(416).end(); return }
      start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end
      if (start > end || start >= artifact.size) { entry.status = 416; persist(); response.writeHead(416).end(); return }
      entry.status = 206
    }
    const headers = { 'content-type': kind === 'metadata' ? 'text/yaml' : 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes' }
    entry.expectedBodyBytes = end - start + 1
    if (entry.status === 206) headers['content-range'] = `bytes ${start}-${end}/${artifact.size}`
    response.writeHead(entry.status, headers)
    if (request.method === 'HEAD') { entry.completed = true; persist(); response.end(); return }
    entry.active = true
    persist()
    const stream = createReadStream(artifact.path, { start, end, highWaterMark: 256 * 1024 })
    response.on('close', () => { entry.active = false; stream.destroy(); persist() })
    try {
      for await (const chunk of stream) {
        if (response.destroyed) break
        entry.bodyBytes += chunk.length
        totals[kind + 'Bytes'] += chunk.length
        persist()
        if (!response.write(chunk)) await new Promise((resolve) => {
          const done = () => { response.removeListener('drain', done); response.removeListener('close', done); resolve() }
          response.once('drain', done); response.once('close', done)
        })
        if (kind === 'installer' && mode === 'throttled') await new Promise((resolve) => setTimeout(resolve, 40))
      }
      if (!response.destroyed) { entry.completed = true; entry.active = false; response.end() }
    } catch (error) { entry.error = error.code ?? 'stream_error'; response.destroy() }
    persist()
  })
  server.on('close', () => { persist(); evidenceClosed = true })
  return { server, report }
}

if (require.main === module) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  const { server } = createFeed(process.argv[2], process.argv[3])
  server.listen(18765, '127.0.0.1')
}
module.exports = { createFeed }
