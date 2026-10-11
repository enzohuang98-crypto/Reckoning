// Synthetic offline provenance fixtures. No GitHub, Windows installer, COM,
// user profile, native input or provider is accessed by this test.
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash } = require('node:crypto')
const policy = require('./windows-exact-candidate.cjs')
const root = mkdtempSync(join(tmpdir(), 'reckoning-exact-candidate-unit-'))
const input = { tag: 'v0.4.15', runId: '12345', faultRunId: '67890', sha256: '', predecessorVersion: '0.4.14' }
const commit = 'a'.repeat(40), now = new Date().toISOString(), setup = policy.names('0.4.15')[0]
const payload = Buffer.from('SYNTHETIC provenance fixture; never an installer')
input.sha256 = policy.sha256(payload)
const sha512 = createHash('sha512').update(payload).digest('base64')
const files = new Map([[setup, payload], [`${setup}.blockmap`, Buffer.from('SYNTHETIC blockmap')], ['latest.yml', Buffer.from(`version: 0.4.15\nfiles:\n  - url: ${setup}\n    sha512: ${sha512}\n    size: ${payload.length}\npath: ${setup}\nsha512: ${sha512}\nreleaseDate: '${now}'\n`)], ['SHA256SUMS.txt', Buffer.from(`${input.sha256.toUpperCase()}  ${setup}\n`)]])
const candidateRun = { id: 12345, path: '.github/workflows/release.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: commit }
const faultRun = { id: 67890, path: '.github/workflows/windows-packaged-acceptance.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: commit }
const jobs = ['Build unsigned-release Windows x64 artifact once', 'Publish unsigned-release candidate', 'Public installer check (Windows Server 2022 compatibility proxy)', 'Public installer check (Windows Server 2025 compatibility proxy)'].map(name => ({ name, conclusion: 'success' }))
const release = { id: 1, tag_name: input.tag, prerelease: true, draft: false, body: '未簽章; SmartScreen may warn', assets: [...files].map(([name, body], i) => ({ name, id: i + 10, size: body.length, state: 'uploaded', digest: `sha256:${policy.sha256(body)}` })) }
const artifact = { id: 99, name: 'windows-x64-release-12345', expired: false, workflow_run: { id: 12345, head_sha: commit } }
const fault = { mode: 'test-pair', result: 'passed', sourceCommit: commit, runId: '67890', capturedAtUtc: now, predecessorVersion: '0.4.15', candidateVersion: '0.4.16', candidateInstallerSha256: 'c'.repeat(64), predecessorInstallerSha256: 'd'.repeat(64), installPayloadBytes: 0, installPayloadRequests: 0, installFailureEvidence: { actualOsExit: { source: 'Win32_ProcessStopTrace', exitStatus: 73, processId: 4321 } }, ...Object.fromEntries(policy.faultGates.map(gate => [gate, 'passed'])) }
const clone = value => JSON.parse(JSON.stringify(value))
let count = 0
function test(name, action) { action(); count++; console.log(`PASS ${name}`) }
const saved = Object.fromEntries(['GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'GITHUB_REPOSITORY'].map(key => [key, process.env[key]]))
async function main() {
  try {
    test('valid explicit older predecessor and immutable candidate inputs', () => policy.validateInputs(input))
    test('PR/default mode remains unpublished test-pair', () => assert.equal(policy.validateMode({}), 'test-pair'))
    test('exact mode requires dispatch and all explicit bindings', () => {
      const env = { ACCEPTANCE_MODE: 'exact-candidate', GITHUB_EVENT_NAME: 'workflow_dispatch', CANDIDATE_TAG: input.tag,
        CANDIDATE_RUN_ID: input.runId, FAULT_RUN_ID: input.faultRunId, EXPECTED_SETUP_SHA256: input.sha256, PREDECESSOR_VERSION: input.predecessorVersion }
      assert.equal(policy.validateMode(env), 'exact-candidate')
      for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { PREDECESSOR_VERSION: '' }, { ACCEPTANCE_MODE: 'test-pair' }, { ACCEPTANCE_MODE: 'unknown' }]) assert.throws(() => policy.validateMode({ ...env, ...change }))
    })
    for (const change of [{ tag: '../tag' }, { tag: 'v00.4.15' }, { runId: '1;echo' }, { faultRunId: '0' }, { faultRunId: input.runId }, { sha256: 'wrong' }, { predecessorVersion: '0.4.15' }, { predecessorVersion: '0.4.16' }]) test(`reject unsafe/incorrect input ${JSON.stringify(change)}`, () => assert.throws(() => policy.validateInputs({ ...input, ...change })))
    test('release run and both public proxy jobs bind exact annotated source', () => policy.validateReleaseBinding(input, commit, candidateRun, jobs, release, artifact))
    for (const kind of ['wrong-run', 'wrong-source', 'failed-proxy', 'teacher-build', 'already-latest', 'draft', 'missing-disclosure', 'expired-artifact', 'wrong-artifact-source']) {
      test(`reject ${kind}`, () => {
        const r = clone(candidateRun), j = clone(jobs), rel = clone(release), a = clone(artifact)
        if (kind === 'wrong-run') r.id = 888
        if (kind === 'wrong-source') r.head_sha = 'b'.repeat(40)
        if (kind === 'failed-proxy') j[2].conclusion = 'failure'
        if (kind === 'teacher-build') j[0].name = 'Build teacher-candidate Windows x64 artifact once'
        if (kind === 'already-latest') rel.prerelease = false
        if (kind === 'draft') rel.draft = true
        if (kind === 'missing-disclosure') rel.body = ''
        if (kind === 'expired-artifact') a.expired = true
        if (kind === 'wrong-artifact-source') a.workflow_run.head_sha = 'b'.repeat(40)
        assert.throws(() => policy.validateReleaseBinding(input, commit, r, j, rel, a))
      })
    }
    test('fault evidence keeps real test-pair 0.4.15 to 0.4.16 identity', () => policy.validateFaultReport(fault, input, commit))
    for (const mutation of [r => { r.sourceCommit = 'b'.repeat(40) }, r => { r.installFailureRetry = 'not_run' }, r => { r.candidateVersion = '0.4.15' }, r => { r.candidateInstallerSha256 = input.sha256 }, r => { r.installFailureEvidence.actualOsExit.exitStatus = 0 }, r => { r.capturedAtUtc = new Date(Date.now() - 73 * 3600000).toISOString() }]) test('reject false/misattributed/stale fault evidence', () => { const r = clone(fault); mutation(r); assert.throws(() => policy.validateFaultReport(r, input, commit)) })
    process.env.GITHUB_ACTIONS = 'true'; process.env.RUNNER_ENVIRONMENT = 'github-hosted'; process.env.GITHUB_REPOSITORY = policy.REPOSITORY
    const calls = []
    function fakeCommand(exe, args) {
      calls.push([exe, ...args])
      if (exe === 'git') {
        if (args[0] === 'cat-file') return 'tag'
        if (args[0] === 'rev-parse') return commit
        if (args[0] === 'show') return JSON.stringify({ version: '0.4.15' })
        assert(['fetch', 'merge-base'].includes(args[0])); return ''
      }
      if (exe === 'pwsh') return JSON.stringify({ status: 'NotSigned', productVersion: '0.4.15' })
      assert.equal(exe, 'gh')
      if (args[0] === 'api') {
        const path = args.at(-1)
        if (path.endsWith('releases/tags/v0.4.15')) return JSON.stringify(release)
        if (path.endsWith('/runs/12345')) return JSON.stringify(candidateRun)
        if (path.endsWith('/runs/67890')) return JSON.stringify(faultRun)
        if (path.includes('/12345/jobs?')) return JSON.stringify([{ jobs }])
        if (path.includes('/67890/jobs?')) return JSON.stringify([{ jobs: ['build', 'client'].map(name => ({ name, conclusion: 'success' })) }])
        if (path.includes('/12345/artifacts?')) return JSON.stringify([{ artifacts: [artifact] }])
        if (path.includes('/67890/artifacts?')) return JSON.stringify([{ artifacts: [{ id: 88, name: 'isolated-windows-client-evidence', expired: false, workflow_run: { id: 67890, head_sha: commit } }] }])
        throw new Error(`Unexpected API fixture ${path}`)
      }
      assert(['run', 'release'].includes(args[0]) && args[1] === 'download', 'Only read-only downloads allowed')
      const directory = args[args.indexOf('--dir') + 1]
      if (args[0] === 'run' && args[2] === input.faultRunId) writeFileSync(join(directory, 'isolated-packaged-updater.json'), JSON.stringify(fault))
      else for (const [name, body] of files) writeFileSync(join(directory, name), body)
      return ''
    }
    const directory = join(root, 'candidate')
    const manifest = policy.acquire(input, directory, fakeCommand)
    test('acquisition binds immutable artifact, exact public files, unsigned identity and fault report', () => {
      assert.equal(manifest.role, 'release-candidate'); assert.equal(manifest.sourceCommit, commit)
      assert.equal(manifest.probeRunId, undefined); assert.equal(manifest.faultRun.runId, input.faultRunId)
      assert.deepEqual(readFileSync(join(directory, 'latest.yml')), files.get('latest.yml'))
      assert(!calls.some(call => /(?:build|publish|clobber|edit|upload)/.test(call[1])))
    })
    test('refuse to overwrite candidate destination', () => assert.throws(() => policy.acquire(input, directory, fakeCommand)))
    for (const name of policy.names('0.4.15')) {
      test(`reject changed ${name}`, () => {
        writeFileSync(join(directory, name), Buffer.from('changed'))
        assert.throws(() => policy.validateManifest(directory, input))
        writeFileSync(join(directory, name), files.get(name))
      })
    }
    for (const line of ['version: 0.4.15', `path: ${setup}`, `  - url: ${setup}`, `    size: ${payload.length}`, `    sha512: ${sha512}`]) test(`reject metadata substitution ${line.split(':')[0]}`, () => {
      writeFileSync(join(directory, 'latest.yml'), files.get('latest.yml').toString().replace(line, `${line}malformed`))
      assert.throws(() => policy.verifyMetadata(directory, '0.4.15', input.sha256))
      writeFileSync(join(directory, 'latest.yml'), files.get('latest.yml'))
    })
    test('reject public blockmap differing from immutable artifact', () => {
      writeFileSync(join(directory, 'public-assets', `${setup}.blockmap`), 'different')
      assert.throws(() => policy.compareBundles(join(directory, 'public-assets'), join(directory, 'source-artifact'), policy.validateInputs(input), release.assets))
    })
    for (const mutation of [m => { m.role = 'unknown' }, m => { m.productionRelease = false }, m => { m.sourceKind = 'rebuilt' }, m => { m.probeRunId = '12345' }, m => { m.sourceCommit = 'wrong' }, m => { m.sourceArtifactName = 'arbitrary' }, m => { m.sourceFiles[0].releaseAssetId = '0' }]) test('reject forged canonical manifest identity', () => {
      const changed = clone(manifest); mutation(changed)
      writeFileSync(join(directory, 'isolated-package-manifest.json'), JSON.stringify(changed))
      assert.throws(() => policy.validateManifest(directory, input))
    })
    writeFileSync(join(directory, 'isolated-package-manifest.json'), JSON.stringify(manifest))
    const verifier = await import('../release/verify-updater-run-evidence.mjs')
    const exactRunId = '67891', harnessCommit = 'e'.repeat(40), dataHash = 'f'.repeat(64)
    const exactReport = {
      mode: 'exact-candidate', result: 'passed', runId: exactRunId, harnessCommit, sourceCommit: commit, predecessorCommit: commit,
      predecessorVersion: '0.4.14', candidateVersion: '0.4.15', exactCandidateUpdaterAcceptance: 'passed',
      ...Object.fromEntries(policy.faultGates.filter(gate => gate !== 'installFailureRetry').map(gate => [gate, 'passed'])),
      installFailureRetry: 'not_run', installFailureRetryScope: 'not-run-on-canonical-installer; separate-same-source-fault-variant',
      candidateInstallerSha256: input.sha256, preparedInstallerSha256: input.sha256, predecessorInstallerSha256: 'd'.repeat(64),
      predecessorUiVersion: '0.4.14', candidateUiVersion: '0.4.15', finalInstalledVersion: '0.4.15',
      savedDataSha256Before: dataHash, savedDataSha256After: dataHash, savedPositionFen: 'SYNTHETIC-restored-FEN',
      savedPositionUiEvidence: { restored: { fen: 'SYNTHETIC-restored-FEN' }, changed: { fen: 'SYNTHETIC-changed-FEN' } },
      installedPath: 'SYNTHETIC-installed-app', desktopShortcutTarget: 'SYNTHETIC-installed-app',
      desktopShortcutObservation: { exists: true, targetExists: true, target: 'SYNTHETIC-installed-app' },
      osProductType: 1, osBuild: '26100', nativeArchitecture: 'ARM64', signature: 'NotSigned', capturedAtUtc: now,
      installPayloadBytes: 0, installPayloadRequests: 0, cacheReusePayloadBytes: 0, cacheReusePayloadRequests: 0,
      candidateManifest: manifest
    }
    const exactBytes = Buffer.from(JSON.stringify(exactReport)), faultBytes = Buffer.from(JSON.stringify(fault))
    const evidence = {
      releaseTag: input.tag, candidateReleaseRunId: input.runId, installerSha256: input.sha256, commitSha: commit, version: '0.4.15',
      updater: { evidenceScope: 'exact-candidate-with-separate-fault-variant', canonicalInstallerFaultInjection: 'not_run',
        predecessorVersion: '0.4.14', predecessorInstallerSha256: 'd'.repeat(64), predecessorCommitSha: commit,
        os: { architecture: 'arm64', family: 'Windows 11', build: '26100' }, testedAt: now,
        gates: { installRetryPassed: { result: 'passed', scope: 'same-source-fault-variant', runId: input.faultRunId } },
        runs: {
          exact: { runId: exactRunId, harnessCommit, artifactId: '89', reportSha256: policy.sha256(exactBytes) },
          fault: { runId: input.faultRunId, harnessCommit: commit, artifactId: '88', reportSha256: policy.sha256(faultBytes) }
        }
      }
    }
    const network = { installerSha256: input.sha256, version: '0.4.15', sourceCommit: commit,
      phases: { 'valid-cache-reopen': { metadataBytes: 150, installerBytes: 0, installerRequests: 0 } }, requests: [] }
    test('scoped evidence attributes canonical install and separate actual NSIS fault', () => verifier.validateObservedReports(evidence, exactReport, fault, network))
    for (const mutate of [r => { r.candidateInstallerSha256 = fault.candidateInstallerSha256 }, r => { r.installFailureRetry = 'passed' },
      r => { r.installFailureEvidence = fault.installFailureEvidence }, r => { r.sourceCommit = harnessCommit },
      r => { r.savedDataSha256After = '0'.repeat(64) }, r => { r.savedPositionUiEvidence.changed.fen = r.savedPositionFen },
      r => { r.desktopShortcutObservation.target = 'wrong' }, r => { r.preparedInstallerSha256 = '0'.repeat(64) },
      r => { r.cacheReusePayloadRequests = 1 }, r => { r.capturedAtUtc = new Date(Date.now() - 73 * 3600000).toISOString() }]) {
      test('reject misattributed or incomplete actual report', () => { const r = clone(exactReport); mutate(r); assert.throws(() => verifier.validateObservedReports(evidence, r, fault, network)) })
    }
    test('reject real transport request even when hand-entered totals claim zero', () => {
      const n = clone(network); n.requests.push({ phase: 'install', kind: 'installer' })
      assert.throws(() => verifier.validateObservedReports(evidence, exactReport, fault, n))
    })
    let remoteMutation = ''
    function fakeRemote(exe, args) {
      if (args[0] === 'api' && args.at(-1).includes(`/runs/${exactRunId}`)) {
        const path = args.at(-1)
        if (path.includes('/jobs?')) return JSON.stringify([{ jobs: ['build', 'client'].map(name => ({ name, conclusion: remoteMutation === 'failed-client' && name === 'client' ? 'failure' : 'success' })) }])
        if (path.includes('/artifacts?')) return JSON.stringify([{ artifacts: [{ id: 89, name: 'isolated-windows-client-evidence', expired: remoteMutation === 'expired-exact', workflow_run: { id: Number(exactRunId), head_sha: harnessCommit } }] }])
        return JSON.stringify({ id: Number(exactRunId), path: '.github/workflows/windows-packaged-acceptance.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: remoteMutation === 'foreign-harness' ? commit : harnessCommit })
      }
      if (args[0] === 'run' && args[1] === 'download' && args[2] === exactRunId) {
        const target = args[args.indexOf('--dir') + 1]
        writeFileSync(join(target, 'isolated-packaged-updater.json'), remoteMutation === 'changed-report' ? '{}' : exactBytes)
        writeFileSync(join(target, 'isolated-packaged-updater-network.json'), JSON.stringify(network))
        return ''
      }
      const result = fakeCommand(exe, args)
      if (remoteMutation === 'changed-public-blockmap' && args[0] === 'release' && args[1] === 'download') writeFileSync(join(args[args.indexOf('--dir') + 1], `${setup}.blockmap`), 'changed')
      return result
    }
    test('promotion refetches read-only GitHub runs, original artifacts and public candidate bytes', () => {
      assert.deepEqual(verifier.verifyGithubArtifacts(evidence, fakeRemote), { exactRunId, faultRunId: input.faultRunId })
    })
    for (const mutation of ['failed-client', 'expired-exact', 'foreign-harness', 'changed-report', 'changed-public-blockmap']) {
      test(`remote verification rejects ${mutation}`, () => { remoteMutation = mutation; assert.throws(() => verifier.verifyGithubArtifacts(evidence, fakeRemote)) })
    }
    remoteMutation = ''
    const { createFeed } = require('./windows-update-feed.cjs')
    const { server } = createFeed(directory, join(directory, 'network.json'))
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${server.address().port}`
      await fetch(`${base}/__probe/control`, { method: 'POST', body: JSON.stringify({ phase: 'exact-install', mode: 'healthy' }) })
      for (const name of policy.names('0.4.15').slice(0, 3)) assert.deepEqual(Buffer.from(await (await fetch(`${base}/${name}`)).arrayBuffer()), files.get(name))
      assert.equal((await fetch(`${base}/SHA256SUMS.txt`)).status, 404)
      assert.equal((await fetch(`${base}/fault-pair-evidence.json`)).status, 404)
      test('controlled feed serves only exact original candidate update bytes', () => {})
    } finally { await new Promise(resolve => server.close(resolve)) }
    console.log(`${count} offline exact-candidate cases passed; no real candidate, provider or Windows VM acceptance.`)
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('reckoning-exact-candidate-unit-')) throw new Error('Unsafe temporary cleanup')
    rmSync(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
