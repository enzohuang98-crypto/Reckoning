// Immutable candidate acquisition and offline provenance validation. This never
// builds/publishes a candidate or changes a feed. gh is used only by acquire.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { execFileSync } = require('node:child_process')
const REPOSITORY = 'enzohuang98-crypto/Reckoning'
const HASH = /^[a-f0-9]{64}$/i
const COMMIT = /^[a-f0-9]{40}$/i
const ID = /^[1-9][0-9]{0,19}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const sha256 = body => createHash('sha256').update(body).digest('hex')
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
function older(a, b) {
  assert.match(a, VERSION); assert.match(b, VERSION)
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt)
  const i = left.findIndex((n, index) => n !== right[index])
  return i >= 0 && left[i] < right[i]
}
function validateInputs(input) {
  assert.match(input.tag, /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/)
  assert.match(input.runId, ID); assert.match(input.faultRunId, ID); assert.match(input.sha256, HASH)
  assert.notEqual(input.runId, input.faultRunId)
  assert(older(input.predecessorVersion, input.tag.slice(1)), 'Predecessor must be older than exact candidate')
  return { ...input, version: input.tag.slice(1), sha256: input.sha256.toLowerCase() }
}
function validateRun(run, workflow, commit) {
  assert.equal(run.path, `.github/workflows/${workflow}.yml`)
  assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.status, 'completed')
  assert.equal(run.conclusion, 'success'); assert.equal(run.head_sha, commit)
}
function validateReleaseBinding(input, commit, run, jobs, release, artifact) {
  validateInputs(input); assert.match(commit, COMMIT)
  validateRun(run, 'release', commit); assert.equal(String(run.id), input.runId)
  for (const name of ['Build unsigned-release Windows x64 artifact once', 'Publish unsigned-release candidate']) {
    const found = jobs.filter(job => job.name === name)
    assert.equal(found.length, 1); assert.equal(found[0].conclusion, 'success')
  }
  for (const name of ['Public installer check (Windows Server 2022 compatibility proxy)', 'Public installer check (Windows Server 2025 compatibility proxy)']) {
    const found = jobs.filter(job => job.name === name)
    assert.equal(found.length, 1); assert.equal(found[0].conclusion, 'success')
  }
  assert.equal(release.tag_name, input.tag); assert.equal(release.prerelease, true); assert.equal(release.draft, false)
  assert(String(release.body).includes('未簽章') && String(release.body).includes('SmartScreen'))
  assert.match(String(release.id), ID)
  assert.equal(artifact.name, `windows-x64-release-${input.runId}`); assert.equal(artifact.expired, false)
  assert.match(String(artifact.id), ID); assert.equal(String(artifact.workflow_run.id), input.runId)
  assert.equal(artifact.workflow_run.head_sha, commit)
}
const faultGates = ['downloadFailureRecovery', 'backgroundUsable', 'noAutoQuit', 'cacheCorruptionRecovery', 'validCacheReopen', 'draftBlocksRestart', 'draftAddedDuringSave', 'earlyPrepareRecovery', 'savedDataFilePreserved', 'savedPositionUiRestored', 'normalInstallationRestart', 'installFailureRetry']
function validateFaultReport(report, input, commit, now = Date.now()) {
  assert.equal(report.mode, 'test-pair'); assert.equal(report.result, 'passed')
  assert.equal(report.sourceCommit, commit); assert.equal(String(report.runId), input.faultRunId)
  assert.equal(report.predecessorVersion, input.tag.slice(1))
  const parts = report.predecessorVersion.split('.'); parts[2] = String(BigInt(parts[2]) + 1n)
  assert.equal(report.candidateVersion, parts.join('.'))
  assert.match(report.candidateInstallerSha256, HASH); assert.match(report.predecessorInstallerSha256, HASH)
  assert.notEqual(report.candidateInstallerSha256.toLowerCase(), input.sha256.toLowerCase())
  for (const gate of faultGates) assert.equal(report[gate], 'passed', `Fault run missing ${gate}`)
  assert.equal(report.installFailureEvidence?.actualOsExit?.source, 'Win32_ProcessStopTrace')
  assert.equal(report.installFailureEvidence.actualOsExit.exitStatus, 73)
  assert(Number.isInteger(report.installFailureEvidence.actualOsExit.processId) && report.installFailureEvidence.actualOsExit.processId > 0)
  assert.equal(report.installPayloadBytes, 0); assert.equal(report.installPayloadRequests, 0)
  const at = Date.parse(report.capturedAtUtc)
  assert(Number.isFinite(at) && at >= now - 72 * 3600000 && at <= now + 300000, 'Fault report must be within 72 hours')
}
function names(version) {
  const setup = `xiangqi-analyzer-${version}-setup.exe`
  return [setup, `${setup}.blockmap`, 'latest.yml', 'SHA256SUMS.txt']
}
function verifyMetadata(directory, version, expectedHash) {
  const [setup] = names(version), body = readFileSync(join(directory, setup))
  assert(body.length > 0); assert.equal(sha256(body), expectedHash.toLowerCase())
  const lines = readFileSync(join(directory, 'latest.yml'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
  const sha512 = createHash('sha512').update(body).digest('base64')
  for (const line of [`version: ${version}`, `path: ${setup}`, `  - url: ${setup}`, `    size: ${body.length}`, `    sha512: ${sha512}`, `sha512: ${sha512}`]) {
    assert.equal(lines.filter(value => value === line).length, 1, `Invalid exact candidate metadata: ${line.split(':')[0]}`)
  }
  assert.equal(lines.filter(line => /^\s*-\s*url:/.test(line)).length, 1)
  assert.equal(lines.filter(line => /^path:/.test(line)).length, 1)
  const sums = readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8').trim()
  assert.match(sums, new RegExp(`^[a-fA-F0-9]{64}  ${setup.replaceAll('.', '\\.')}$`))
  assert.equal(sums.slice(0, 64).toLowerCase(), expectedHash.toLowerCase())
  assert(readFileSync(join(directory, `${setup}.blockmap`)).length > 0)
}
function compareBundles(publicDirectory, artifactDirectory, input, releaseAssets) {
  verifyMetadata(publicDirectory, input.version, input.sha256)
  return names(input.version).map(name => {
    const body = readFileSync(join(publicDirectory, name)), original = readFileSync(join(artifactDirectory, name))
    assert(body.equals(original), `Public asset differs from immutable artifact: ${name}`)
    const matches = releaseAssets.filter(asset => asset.name === name)
    assert.equal(matches.length, 1); const asset = matches[0]
    assert.match(String(asset.id), ID); assert.equal(asset.state, 'uploaded'); assert.equal(asset.size, body.length)
    if (asset.digest != null) assert.equal(asset.digest.toLowerCase(), `sha256:${sha256(body)}`)
    return { name, size: body.length, sha256: sha256(body), releaseAssetId: String(asset.id) }
  })
}
function validateManifest(directory, input) {
  const m = json(join(directory, 'isolated-package-manifest.json'))
  assert.equal(m.schemaVersion, 1); assert.equal(m.role, 'release-candidate')
  assert.equal(m.sourceKind, 'github-release-asset'); assert.equal(m.productionRelease, true)
  assert.equal(m.signature, 'NotSigned'); assert.equal(m.repository, REPOSITORY)
  assert.match(m.sourceCommit, COMMIT); assert.match(m.version, VERSION)
  assert.equal(m.releaseTag, `v${m.version}`); assert.match(m.candidateReleaseRunId, ID)
  assert.match(m.releaseId, ID); assert.match(m.sourceArtifactId, ID)
  assert.equal(m.sourceArtifactName, `windows-x64-release-${m.candidateReleaseRunId}`)
  assert.equal(m.probeRunId, undefined, 'Canonical candidate must not claim compiled probe identity')
  assert.equal(m.sourceFiles.length, 4); assert.equal(m.artifacts.length, 3)
  const expectedNames = names(m.version)
  for (const name of expectedNames) {
    const records = m.sourceFiles.filter(file => file.name === name)
    assert.equal(records.length, 1); const file = records[0]
    assert.match(file.sha256, HASH); assert.match(file.releaseAssetId, ID)
    const body = readFileSync(join(directory, name))
    assert.equal(body.length, file.size); assert.equal(sha256(body), file.sha256.toLowerCase())
    if (name !== 'SHA256SUMS.txt') assert.deepEqual(m.artifacts.filter(file => file.name === name), [file])
  }
  const setup = m.sourceFiles[0]
  assert.equal(setup.name, expectedNames[0]); verifyMetadata(directory, m.version, setup.sha256)
  const effective = input ? validateInputs(input) : { tag: m.releaseTag, runId: m.candidateReleaseRunId, faultRunId: m.faultRun.runId, sha256: setup.sha256, predecessorVersion: m.predecessorVersion }
  validateInputs(effective)
  assert.equal(m.releaseTag, effective.tag); assert.equal(m.candidateReleaseRunId, effective.runId)
  assert.equal(setup.sha256.toLowerCase(), effective.sha256.toLowerCase()); assert.equal(m.predecessorVersion, effective.predecessorVersion)
  assert.equal(m.faultRun.runId, effective.faultRunId); assert.match(m.faultRun.reportSha256, HASH)
  const faultBytes = readFileSync(join(directory, 'fault-pair-evidence.json'))
  assert.equal(sha256(faultBytes), m.faultRun.reportSha256)
  validateFaultReport(JSON.parse(faultBytes.toString('utf8').replace(/^\uFEFF/, '')), effective, m.sourceCommit)
  return m
}
function command(executable, args) {
  return execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim()
}
function acquire(input, directory, run = command) {
  input = validateInputs(input)
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY)
  const api = path => JSON.parse(run('gh', ['api', `repos/${REPOSITORY}/${path}`]))
  const pages = path => JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${REPOSITORY}/${path}`]))
  assert.equal(run('git', ['cat-file', '-t', `refs/tags/${input.tag}`]), 'tag')
  const commit = run('git', ['rev-parse', `refs/tags/${input.tag}^{commit}`]); assert.match(commit, COMMIT)
  run('git', ['fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main'])
  run('git', ['merge-base', '--is-ancestor', commit, 'origin/main'])
  assert.equal(JSON.parse(run('git', ['show', `${commit}:package.json`])).version, input.version)
  const release = api(`releases/tags/${input.tag}`), candidateRun = api(`actions/runs/${input.runId}`)
  const jobs = pages(`actions/runs/${input.runId}/jobs?per_page=100`).flatMap(page => page.jobs)
  const artifacts = pages(`actions/runs/${input.runId}/artifacts?per_page=100`).flatMap(page => page.artifacts).filter(a => a.name === `windows-x64-release-${input.runId}`)
  assert.equal(artifacts.length, 1)
  validateReleaseBinding(input, commit, candidateRun, jobs, release, artifacts[0])
  const faultRun = api(`actions/runs/${input.faultRunId}`)
  assert.equal(String(faultRun.id), input.faultRunId)
  validateRun(faultRun, 'windows-packaged-acceptance', commit)
  const faultJobs = pages(`actions/runs/${input.faultRunId}/jobs?per_page=100`).flatMap(page => page.jobs)
  for (const name of ['build', 'client']) {
    const found = faultJobs.filter(job => job.name === name)
    assert.equal(found.length, 1); assert.equal(found[0].conclusion, 'success')
  }
  const faultArtifacts = pages(`actions/runs/${input.faultRunId}/artifacts?per_page=100`).flatMap(page => page.artifacts).filter(a => a.name === 'isolated-windows-client-evidence')
  assert.equal(faultArtifacts.length, 1); assert.equal(faultArtifacts[0].expired, false)
  assert.equal(String(faultArtifacts[0].workflow_run.id), input.faultRunId)
  assert.equal(faultArtifacts[0].workflow_run.head_sha, commit)
  const root = resolve(directory)
  assert(!existsSync(root), 'Exact candidate destination already exists; refusing overwrite')
  mkdirSync(root, { recursive: true })
  const archiveDirectory = join(root, 'source-artifact'), publicDirectory = join(root, 'public-assets'), faultDirectory = join(root, 'fault-run')
  for (const path of [archiveDirectory, publicDirectory, faultDirectory]) mkdirSync(path)
  run('gh', ['run', 'download', input.runId, '--repo', REPOSITORY, '--name', artifacts[0].name, '--dir', archiveDirectory])
  run('gh', ['release', 'download', input.tag, '--repo', REPOSITORY, '--dir', publicDirectory, ...names(input.version).flatMap(name => ['--pattern', name])])
  run('gh', ['run', 'download', input.faultRunId, '--repo', REPOSITORY, '--name', 'isolated-windows-client-evidence', '--dir', faultDirectory])
  const sourceFiles = compareBundles(publicDirectory, archiveDirectory, input, release.assets)
  const signature = JSON.parse(run('pwsh', ['-NoProfile', '-File', join(__dirname, 'windows-exact-candidate-signature.ps1'), '-InstallerPath', join(publicDirectory, names(input.version)[0])]))
  assert.equal(signature.status, 'NotSigned'); assert.equal(signature.productVersion, input.version)
  const faultBytes = readFileSync(join(faultDirectory, 'isolated-packaged-updater.json'))
  validateFaultReport(JSON.parse(faultBytes.toString('utf8').replace(/^\uFEFF/, '')), input, commit)
  for (const file of sourceFiles) copyFileSync(join(publicDirectory, file.name), join(root, file.name))
  writeFileSync(join(root, 'fault-pair-evidence.json'), faultBytes)
  const manifest = { schemaVersion: 1, sourceKind: 'github-release-asset', role: 'release-candidate', productionRelease: true,
    signature: 'NotSigned', repository: REPOSITORY, sourceCommit: commit, version: input.version, releaseTag: input.tag,
    candidateReleaseRunId: input.runId, releaseId: String(release.id), sourceArtifactId: String(artifacts[0].id), sourceArtifactName: artifacts[0].name,
    predecessorVersion: input.predecessorVersion, sourceFiles, artifacts: sourceFiles.filter(f => f.name !== 'SHA256SUMS.txt'),
    faultRun: { runId: input.faultRunId, reportSha256: sha256(faultBytes), artifactId: String(faultArtifacts[0].id) },
    differences: ['Original unsigned prerelease assets; no candidate rebuild or test hooks', 'Transported unchanged through predecessor loopback feed in ephemeral Windows VM'] }
  writeFileSync(join(root, 'isolated-package-manifest.json'), JSON.stringify(manifest, null, 2))
  return validateManifest(root, input)
}
function environmentInputs(env = process.env) {
  return { tag: env.CANDIDATE_TAG, runId: env.CANDIDATE_RUN_ID, faultRunId: env.FAULT_RUN_ID, sha256: env.EXPECTED_SETUP_SHA256, predecessorVersion: env.PREDECESSOR_VERSION }
}
function validateMode(env = process.env) {
  const mode = env.ACCEPTANCE_MODE || 'test-pair'
  assert(['test-pair', 'exact-candidate'].includes(mode), 'Unknown acceptance mode')
  if (mode === 'exact-candidate') {
    assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Exact candidate requires explicit dispatch')
    validateInputs(environmentInputs(env))
  } else assert(Object.values(environmentInputs(env)).every(value => !value), 'Candidate inputs require exact-candidate mode')
  return mode
}
if (require.main === module) {
  try {
    const [mode, directory] = process.argv.slice(2)
    if (mode === 'inputs') { assert.equal(process.argv.length, 3); console.log(validateMode()); process.exit(0) }
    assert(['acquire', 'verify'].includes(mode)); assert(directory && process.argv.length === 4)
    const manifest = mode === 'acquire' ? acquire(environmentInputs(), directory) : validateManifest(directory, validateInputs(environmentInputs()))
    if (mode === 'acquire' && process.env.GITHUB_OUTPUT) require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `candidate_commit=${manifest.sourceCommit}\ncandidate_version=${manifest.version}\n`)
    console.log(JSON.stringify(manifest))
  } catch (error) { console.error(`Exact candidate rejected: ${error.message}`); process.exitCode = 1 }
}
module.exports = { REPOSITORY, sha256, older, validateInputs, validateRun, validateReleaseBinding, validateFaultReport, verifyMetadata, compareBundles, validateManifest, acquire, environmentInputs, validateMode, names, faultGates }
