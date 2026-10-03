import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'enzohuang98-crypto/Reckoning'
const MAX_BYTES = 128 * 1024
const HASH = /^[a-fA-F0-9]{64}$/
const COMMIT = /^[a-fA-F0-9]{40}$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const candidateGates = [
  'installed', 'settingsUiUsed', 'sameSavedKeyFreeModelSwitch', 'settingsReopenPreservesModel',
  'appRestartPreservesModel', 'failedSwitchPreservesModel', 'normalInstallerLaunched',
  'installPathsVerified', 'shortcutsVerified', 'pikafishUciReady', 'pikafishSearchCompleted',
  'userDataPreserved', 'draftProtected'
]
const updaterGates = [
  'isolated', 'packagedPredecessorInstalled', 'newUpdaterPresent', 'normalInstallCompleted',
  'backgroundDownloadUiUsable', 'noAutomaticQuit', 'cacheReopenVerified', 'cacheRestartVerified',
  'cacheCorruptionRejected', 'downloadFailureRecovered', 'earlyPrepareSafe', 'installRetryPassed',
  'userDataPreserved', 'draftProtected', 'exactCandidateInstalled', 'candidateLaunched'
]
function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}
function requireTrueFields(value, fields, label) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  for (const field of fields) requireValue(value[field] === true, `${label}.${field} must be explicitly true`)
}
function requireHash(value, label) { requireValue(typeof value === 'string' && HASH.test(value), `${label} must be SHA-256`) }
function requireFresh(value, now, label) {
  requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value), `${label} must include a timezone`)
  const at = Date.parse(value)
  requireValue(Number.isFinite(at) && at >= now - 72 * 3600000 && at <= now + 300000, `${label} is outside the 72 hour freshness window`)
}
function requireClient(os, native, label) {
  requireValue(os?.productType === 'client' && ['Windows 10', 'Windows 11'].includes(os.family), `${label} must be an actual Windows client`)
  requireValue(typeof os.build === 'string' && /^\d+(?:\.\d+)*$/.test(os.build), `${label} must record OS build`)
  const buildParts = os.build.split('.')
  const buildNumber = BigInt(buildParts.length >= 3 ? buildParts[2] : buildParts[0])
  requireValue(os.family === 'Windows 11' ? buildNumber >= 22000n : buildNumber >= 10240n && buildNumber < 22000n, `${label} OS family does not match Windows client build`)
  requireValue(os.appArchitecture === 'x64', `${label} must run the actual x64 candidate`)
  if (native) requireValue(os.architecture === 'x64' && os.executionMode === 'native', `${label} must be native x64`)
  else requireValue((os.architecture === 'x64' && os.executionMode === 'native') ||
    (os.family === 'Windows 11' && os.architecture === 'arm64' && os.executionMode === 'x64-emulation' && os.emulationDisclosed === true), `${label} architecture or emulation disclosure is invalid`)
}

export function validateEvidenceUrl(value) {
  const url = new URL(value)
  requireValue(url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com' && !url.port && !url.username && !url.password && !url.search && !url.hash,
    'Evidence URL must be HTTPS raw.githubusercontent.com without credentials, port, query, or fragment')
  requireValue(/^\/enzohuang98-crypto\/Reckoning\/[a-fA-F0-9]{40}\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/.test(url.pathname),
    'Evidence URL must name an immutable repository commit and JSON path')
  return url
}

export function validateEvidenceBytes(bytes, expected, now = Date.now()) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_BYTES, 'Evidence must contain at most 128 KiB')
  requireHash(expected.evidenceSha256, 'Expected evidence digest')
  requireValue(createHash('sha256').update(bytes).digest('hex') === expected.evidenceSha256.toLowerCase(), 'Evidence bytes do not match expected SHA-256')
  requireValue(expected.repository === REPOSITORY && COMMIT.test(expected.commitSha) && /^[1-9]\d*$/.test(expected.candidateReleaseRunId) && VERSION.test(expected.version) && expected.releaseTag === `v${expected.version}`, 'Invalid expected source binding')
  requireHash(expected.installerSha256, 'Expected installer hash')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const e = JSON.parse(text)
  requireValue(e.schemaVersion === 1 && e.result === 'pass' && e.releaseMode === 'unsigned-release', 'Evidence must be schema 1, pass, and unsigned-release')
  for (const field of ['repository', 'releaseTag', 'version', 'candidateReleaseRunId']) requireValue(e[field] === expected[field], `Evidence ${field} does not match candidate`)
  requireValue(typeof e.commitSha === 'string' && e.commitSha.toLowerCase() === expected.commitSha.toLowerCase(), 'Evidence commit does not match candidate')
  requireHash(e.installerSha256, 'Installer hash')
  requireValue(e.installerSha256.toLowerCase() === expected.installerSha256.toLowerCase(), 'Installer hash does not match candidate')
  requireValue(UUID.test(e.testRunId), 'Evidence must record a UUID testRunId')
  requireFresh(e.testedAt, now, 'testedAt')
  requireValue(e.authenticodeStatus === 'NotSigned' && e.limitations?.unsigned === true && e.limitations?.smartScreenMayWarnOrBlock === true, 'Unsigned and SmartScreen limitations must be recorded')
  requireValue(e.installerUrl === `https://github.com/${REPOSITORY}/releases/download/${expected.releaseTag}/xiangqi-analyzer-${expected.version}-setup.exe`, 'Installer URL must identify exact public candidate')
  const candidate = e.candidate
  requireValue(candidate?.evidenceClass === 'installed-windows-client-ui', 'Candidate evidence must come from installed Windows UI')
  requireClient(candidate.os, true, 'candidate.os')
  requireTrueFields(candidate.gates, candidateGates, 'candidate.gates')
  const a = candidate.analysis
  requireValue(a?.evidenceClass === 'installed-candidate-analysis' && a.provider === 'openrouter' && typeof a.model === 'string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+:free$/.test(a.model) && a.promptPrice === 0 && a.completionPrice === 0 && a.sameSavedCredential === true, 'Analysis must use the same saved OpenRouter key and exact free model')
  requireValue(typeof candidate.savedModelBefore === 'string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+$/.test(candidate.savedModelBefore) && candidate.savedModelBefore !== candidate.savedModelAfter && candidate.savedModelAfter === a.model, 'UI model switch must record distinct saved models and analyze the exact selected free model')
  requireValue(a.complete === true && a.truncated === false && typeof a.finishReason === 'string' && a.finishReason !== 'length' && a.finishReason.length > 0, 'Actual candidate analysis must be complete')
  requireValue(Array.isArray(a.bodySections) && a.bodySections.length === 5 && a.bodySections.every(s => typeof s === 'string' && s.trim().length > 0), 'Analysis must record five nonempty body sections')
  const body = a.bodySections.join('\n\n')
  requireValue((body.match(/\p{Script=Han}/gu) ?? []).length >= 400, 'Analysis body must contain at least 400 Han characters')
  requireHash(a.bodySha256, 'Analysis body hash')
  requireValue(createHash('sha256').update(body, 'utf8').digest('hex') === a.bodySha256.toLowerCase(), 'Analysis body hash mismatch')
  requireValue(a.validator?.result === 'pass' && a.validator.bodySha256 === a.bodySha256 && a.validator.grounded === true && a.validator.fiveBodySections === true, 'Validator must pass this exact grounded five-section body')
  requireValue(a.independentReview?.result === 'pass' && a.independentReview.bodySha256 === a.bodySha256 && a.independentReview.grounded === true && a.independentReview.independent === true && typeof a.independentReview.reviewer === 'string' && a.independentReview.reviewer.trim().length > 0, 'Independent review must pass this exact grounded body')
  const u = e.updater
  requireValue(u?.evidenceClass === 'isolated-packaged-predecessor-to-candidate', 'Updater evidence must use an actual isolated packaged predecessor')
  requireClient(u.os, false, 'updater.os')
  requireTrueFields(u.gates, updaterGates, 'updater.gates')
  requireValue(u.targetVersion === expected.version && u.targetInstallerSha256 === e.installerSha256, 'Updater target must be exact candidate')
  requireValue(typeof u.predecessorVersion === 'string' && VERSION.test(u.predecessorVersion), 'Updater must record a valid predecessor version')
  const previousParts = u.predecessorVersion.split('.').map(BigInt)
  const targetParts = expected.version.split('.').map(BigInt)
  const firstDifference = previousParts.findIndex((part, index) => part !== targetParts[index])
  requireValue(firstDifference >= 0 && previousParts[firstDifference] < targetParts[firstDifference], 'Updater predecessor version must be older than target candidate')
  requireHash(u.predecessorInstallerSha256, 'Predecessor installer hash')
  requireValue(typeof u.predecessorCommitSha === 'string' && COMMIT.test(u.predecessorCommitSha), 'Updater must record packaged predecessor commit')
  requireValue(u.predecessorInstallerSha256.toLowerCase() !== e.installerSha256.toLowerCase(), 'Predecessor bytes must differ from candidate')
  requireValue(u.installerPayloadBytesOnCacheReuse === 0, 'Cache reuse must transfer zero installer payload bytes')
  requireFresh(u.testedAt, now, 'updater.testedAt')
  return e
}

export function downloadEvidence(value) {
  const url = validateEvidenceUrl(value)
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers: { Accept: 'application/json' } }, res => {
      if (res.statusCode !== 200) { res.destroy(); reject(new Error('Evidence download requires HTTP 200; redirects are refused')); return }
      if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); reject(new Error('Evidence exceeds 128 KiB')); return }
      const chunks = []
      let count = 0
      res.on('data', chunk => {
        count += chunk.length
        if (count > MAX_BYTES) req.destroy(new Error('Evidence exceeds 128 KiB'))
        else chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    const timer = setTimeout(() => req.destroy(new Error('Evidence download exceeded 20 seconds')), 20000)
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
    req.end()
  })
}

async function main(args) {
  const allowed = new Set(['url', 'file', 'evidence-sha256', 'repository', 'tag', 'commit', 'run-id', 'setup-sha256', 'version'])
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '')
    requireValue(args[i]?.startsWith('--') && allowed.has(key) && options[key] === undefined && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown, duplicate, or missing CLI argument')
    options[key] = args[i + 1]
  }
  requireValue(Boolean(options.url) !== Boolean(options.file), 'Specify exactly one --url or --file')
  for (const key of ['evidence-sha256', 'repository', 'tag', 'commit', 'run-id', 'setup-sha256', 'version']) requireValue(options[key], `Missing --${key}`)
  // --file runs the same validator for offline schema tests; promotion always uses --url.
  const bytes = options.url ? await downloadEvidence(options.url) : await readFile(options.file)
  const evidence = validateEvidenceBytes(bytes, {
    evidenceSha256: options['evidence-sha256'], repository: options.repository,
    releaseTag: options.tag, commitSha: options.commit, candidateReleaseRunId: options['run-id'],
    installerSha256: options['setup-sha256'], version: options.version
  })
  console.log(`Unsigned candidate evidence validated: ${evidence.releaseTag}, ${evidence.commitSha}, run ${evidence.candidateReleaseRunId}; candidate ${evidence.candidate.os.architecture}/${evidence.candidate.os.executionMode}, updater ${evidence.updater.os.architecture}/${evidence.updater.os.executionMode}; NotSigned, SmartScreen may warn or block.`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`Unsigned candidate evidence rejected: ${error.message}`); process.exitCode = 1 })
}
