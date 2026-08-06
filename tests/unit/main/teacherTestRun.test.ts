import { strict as assert } from 'node:assert'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TeacherTestRunService,
  type TeacherTestRuntimeSnapshot
} from '../../../src/main/teacherTest/TeacherTestRunService'

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'reckoning-teacher-test-'))
  const installerPath = join(directory, 'xiangqi-analyzer-0.3.8-setup.exe')
  await writeFile(installerPath, Buffer.from('teacher candidate bytes'))

  let now = new Date('2026-08-06T12:00:00.000Z')
  const runtime: TeacherTestRuntimeSnapshot = {
    appVersion: '0.3.8',
    platform: 'win32',
    systemVersion: '10.0.22631',
    osBuild: 'Windows 11 10.0.22631',
    arch: 'x64'
  }
  const service = new TeacherTestRunService({
    getRuntime: () => runtime,
    now: () => now
  })

  try {
    const manifest = await service.start({
      releaseTag: 'v0.3.8',
      productSourceCommit: 'A'.repeat(40),
      installerPath
    })
    assert.equal(manifest.artifactClaim.appVersion, '0.3.8')
    assert.equal(manifest.artifactClaim.releaseTag, 'v0.3.8')
    assert.equal(manifest.artifactClaim.productSourceCommit, 'a'.repeat(40))
    assert.equal(manifest.artifactClaim.installerFileName, 'xiangqi-analyzer-0.3.8-setup.exe')
    assert.match(manifest.artifactClaim.installerSha256, /^[0-9a-f]{64}$/)
    assert.equal(JSON.stringify(manifest).includes(directory), false)

    const firstLink = service.createEvaluationLink({
      positionFen: '4k4/9/9/9/9/9/9/9/9/4K4 w',
      question: '為什麼\r\n這一步重要？',
      attachedMove: 'a0a1',
      mode: 'research'
    })
    const secondLink = service.createEvaluationLink({
      positionFen: '4k4/9/9/9/9/9/9/9/9/4K4 w',
      question: '為什麼\n這一步重要？',
      attachedMove: 'a0a1',
      mode: 'research'
    })
    assert(firstLink)
    assert(secondLink)
    assert.equal(firstLink.testRunId, manifest.testRunId)
    assert.equal(firstLink.testCaseId, secondLink.testCaseId)
    assert.notEqual(firstLink.externalReviewId, secondLink.externalReviewId)
    assert.equal(firstLink.canonicalizationVersion, 1)

    now = new Date('2026-08-06T12:10:00.000Z')
    const ended = service.end()
    assert.equal(ended.endedAt, now.toISOString())
    assert.equal(service.getStatus().active, false)
    assert.equal(service.createEvaluationLink({ positionFen: 'x', mode: 'focused' }), undefined)

    now = new Date('2026-08-06T12:20:00.000Z')
    const secondManifest = await service.start({
      releaseTag: 'v0.3.8',
      productSourceCommit: 'b'.repeat(40),
      installerPath
    })
    assert.notEqual(secondManifest.testRunId, manifest.testRunId)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }

  console.log('Teacher test run checks passed.')
}

void main()
