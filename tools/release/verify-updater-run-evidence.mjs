// Promotion verifies original GitHub artifacts; offline tests inject a read-only
// command seam. No report boolean alone establishes exact-candidate acceptance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import policy from '../acceptance/windows-exact-candidate.cjs'

const ID = /^[1-9][0-9]{0,19}$/
const HASH = /^[a-f0-9]{64}$/i
const COMMIT = /^[a-f0-9]{40}$/i
const artifactName = 'isolated-windows-client-evidence'
const reportName = 'isolated-packaged-updater.json'
const exactGates = policy.faultGates.filter(gate => gate !== 'installFailureRetry')
export function validateRunBindings(updater, expected) {
  assert.equal(updater.evidenceScope, 'exact-candidate-with-separate-fault-variant')
  const { exact, fault } = updater.runs ?? {}
  for (const run of [exact, fault]) {
    assert.match(run?.runId, ID); assert.match(run.artifactId, ID)
    assert.match(run.harnessCommit, COMMIT); assert.match(run.reportSha256, HASH)
  }
  assert.notEqual(exact.runId, fault.runId)
  assert.notEqual(exact.runId, expected.candidateReleaseRunId)
  assert.notEqual(fault.runId, expected.candidateReleaseRunId)
  assert.equal(fault.harnessCommit, expected.commitSha)
  assert.equal(updater.predecessorCommitSha, expected.commitSha)
  assert.deepEqual(updater.gates.installRetryPassed, {
    result: 'passed', scope: 'same-source-fault-variant', runId: fault.runId
  })
  assert.equal(updater.canonicalInstallerFaultInjection, 'not_run')
  return { exact, fault }
}
function sameHash(actual, expected) {
  assert.match(actual, HASH); assert.match(expected, HASH)
  assert.equal(actual.toLowerCase(), expected.toLowerCase())
}
export function validateObservedReports(evidence, report, faultReport, network, now = Date.now()) {
  const u = evidence.updater, runs = validateRunBindings(u, evidence)
  const input = { tag: evidence.releaseTag, runId: evidence.candidateReleaseRunId,
    sha256: evidence.installerSha256, predecessorVersion: u.predecessorVersion, faultRunId: runs.fault.runId }
  policy.validateFaultReport(faultReport, input, evidence.commitSha, now)
  assert.equal(report.mode, 'exact-candidate'); assert.equal(report.result, 'passed')
  assert.equal(report.runId, runs.exact.runId); assert.equal(report.harnessCommit, runs.exact.harnessCommit)
  assert.equal(report.sourceCommit, evidence.commitSha); assert.equal(report.predecessorCommit, evidence.commitSha)
  assert.equal(report.predecessorVersion, u.predecessorVersion); assert.equal(report.candidateVersion, evidence.version)
  assert.equal(report.exactCandidateUpdaterAcceptance, 'passed')
  assert.equal(report.installFailureRetry, 'not_run')
  assert.equal(report.installFailureRetryScope, 'not-run-on-canonical-installer; separate-same-source-fault-variant')
  assert.equal(report.installFailureEvidence, undefined, 'Canonical installer must not claim the fault variant exit')
  for (const gate of exactGates) assert.equal(report[gate], 'passed', `Exact candidate missing ${gate}`)
  for (const field of ['candidateInstallerSha256', 'preparedInstallerSha256']) sameHash(report[field], evidence.installerSha256)
  sameHash(report.predecessorInstallerSha256, u.predecessorInstallerSha256)
  assert.equal(report.predecessorUiVersion, u.predecessorVersion); assert.equal(report.candidateUiVersion, evidence.version)
  assert([evidence.version, `${evidence.version}.0`].includes(report.finalInstalledVersion))
  sameHash(report.savedDataSha256Before, report.savedDataSha256After)
  assert.equal(report.savedPositionUiEvidence?.restored?.fen, report.savedPositionFen)
  assert.notEqual(report.savedPositionUiEvidence?.changed?.fen, report.savedPositionFen)
  const shortcut = report.desktopShortcutObservation
  assert.equal(shortcut?.exists, true); assert.equal(shortcut.targetExists, true)
  assert.equal(shortcut.target, report.installedPath); assert.equal(report.desktopShortcutTarget, report.installedPath)
  assert.equal(report.osProductType, 1); assert(Number(report.osBuild) >= 22000)
  const architecture = report.nativeArchitecture?.toLowerCase()
  assert.equal(architecture === 'amd64' ? 'x64' : architecture, u.os.architecture)
  assert.equal(u.os.family, 'Windows 11'); assert.equal(u.os.build, report.osBuild)
  assert.equal(report.signature, 'NotSigned')
  const at = Date.parse(report.capturedAtUtc)
  assert(Number.isFinite(at) && at >= now - 72 * 3600000 && at <= now + 300000)
  assert.equal(u.testedAt, report.capturedAtUtc)
  for (const field of ['installPayloadBytes', 'installPayloadRequests', 'cacheReusePayloadBytes', 'cacheReusePayloadRequests']) assert.equal(report[field], 0)
  sameHash(network.installerSha256, evidence.installerSha256)
  assert.equal(network.version, evidence.version); assert.equal(network.sourceCommit, evidence.commitSha)
  for (const phase of ['valid-cache-reopen', 'install']) {
    // A phase with no requests is valid for installation, but metadata must
    // prove that reopening revalidated the prepared cache.
    const totals = network.phases?.[phase]
    if (phase === 'valid-cache-reopen') assert(totals?.metadataBytes > 0)
    assert.equal(totals?.installerBytes ?? 0, 0); assert.equal(totals?.installerRequests ?? 0, 0)
    assert.equal(network.requests.filter(r => r.phase === phase && r.kind === 'installer').length, 0)
  }
  const m = report.candidateManifest
  assert.equal(m?.sourceCommit, evidence.commitSha); assert.equal(m.releaseTag, evidence.releaseTag)
  assert.equal(m.candidateReleaseRunId, evidence.candidateReleaseRunId)
  assert.equal(m.faultRun.runId, runs.fault.runId); assert.equal(m.faultRun.artifactId, runs.fault.artifactId)
  sameHash(m.faultRun.reportSha256, runs.fault.reportSha256)
  return input
}
function command(executable, args) {
  try { return execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 120000 }).trim() }
  catch { throw new Error(`GitHub provenance command failed (${executable} ${args[0]}); no fallback is allowed`) }
}
export function verifyGithubArtifacts(evidence, run = command) {
  const bindings = validateRunBindings(evidence.updater, evidence)
  const api = path => JSON.parse(run('gh', ['api', `repos/${policy.REPOSITORY}/${path}`]))
  const pages = path => JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${policy.REPOSITORY}/${path}`]))
  const root = mkdtempSync(join(tmpdir(), 'reckoning-updater-provenance-'))
  try {
    const downloaded = {}
    for (const [mode, binding] of Object.entries(bindings)) {
      const actualRun = api(`actions/runs/${binding.runId}`)
      assert.equal(String(actualRun.id), binding.runId)
      policy.validateRun(actualRun, 'windows-packaged-acceptance', binding.harnessCommit)
      const jobs = pages(`actions/runs/${binding.runId}/jobs?per_page=100`).flatMap(page => page.jobs)
      for (const name of ['build', 'client']) {
        const found = jobs.filter(job => job.name === name)
        assert.equal(found.length, 1); assert.equal(found[0].conclusion, 'success')
      }
      const artifacts = pages(`actions/runs/${binding.runId}/artifacts?per_page=100`).flatMap(page => page.artifacts).filter(a => a.name === artifactName)
      assert.equal(artifacts.length, 1)
      const a = artifacts[0]
      assert.equal(a.expired, false); assert.equal(String(a.id), binding.artifactId)
      assert.equal(String(a.workflow_run.id), binding.runId); assert.equal(a.workflow_run.head_sha, binding.harnessCommit)
      const directory = join(root, mode); mkdirSync(directory)
      run('gh', ['run', 'download', binding.runId, '--repo', policy.REPOSITORY, '--name', artifactName, '--dir', directory])
      const bytes = readFileSync(join(directory, reportName))
      assert(bytes.length <= 16 * 1024 * 1024)
      sameHash(policy.sha256(bytes), binding.reportSha256)
      downloaded[mode] = { directory, bytes, report: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) }
    }
    const network = JSON.parse(readFileSync(join(downloaded.exact.directory, 'isolated-packaged-updater-network.json'), 'utf8'))
    const input = validateObservedReports(evidence, downloaded.exact.report, downloaded.fault.report, network)
    const candidateRun = api(`actions/runs/${input.runId}`)
    const jobs = pages(`actions/runs/${input.runId}/jobs?per_page=100`).flatMap(page => page.jobs)
    const release = api(`releases/tags/${input.tag}`)
    const artifacts = pages(`actions/runs/${input.runId}/artifacts?per_page=100`).flatMap(page => page.artifacts).filter(a => a.name === `windows-x64-release-${input.runId}`)
    assert.equal(artifacts.length, 1)
    policy.validateReleaseBinding(input, evidence.commitSha, candidateRun, jobs, release, artifacts[0])
    const original = join(root, 'original'), published = join(root, 'published')
    mkdirSync(original); mkdirSync(published)
    run('gh', ['run', 'download', input.runId, '--repo', policy.REPOSITORY, '--name', artifacts[0].name, '--dir', original])
    run('gh', ['release', 'download', input.tag, '--repo', policy.REPOSITORY, '--dir', published, ...policy.names(evidence.version).flatMap(name => ['--pattern', name])])
    const sourceFiles = policy.compareBundles(published, original, policy.validateInputs(input), release.assets)
    const m = downloaded.exact.report.candidateManifest
    assert.deepEqual(m.sourceFiles, sourceFiles)
    assert.equal(m.sourceArtifactId, String(artifacts[0].id)); assert.equal(m.releaseId, String(release.id))
    writeFileSync(join(published, 'isolated-package-manifest.json'), JSON.stringify(m))
    writeFileSync(join(published, 'fault-pair-evidence.json'), downloaded.fault.bytes)
    policy.validateManifest(published, input)
    return { exactRunId: bindings.exact.runId, faultRunId: bindings.fault.runId }
  } finally {
    // Only this exact mkdtemp-created directory is removed, with one filesystem API.
    rmSync(root, { recursive: true, force: true })
  }
}
