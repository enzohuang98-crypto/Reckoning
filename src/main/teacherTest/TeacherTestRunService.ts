import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as os from 'node:os'
import { basename } from 'node:path'
import {
  TEACHER_TEST_CANONICALIZATION_VERSION,
  TEACHER_TEST_SCHEMA_VERSION,
  type HarnessEvaluationLinkV1,
  type TeacherTestCaseIdentityV1,
  type TeacherTestRunManifestV1,
  type TeacherTestRunStatusV1
} from '@shared/types/Harness'
import { canonicalizeTeacherTestCase } from '@shared/logic/teacherTestEvaluation'

export interface TeacherTestRuntimeSnapshot {
  appVersion: string
  platform: NodeJS.Platform
  systemVersion: string
  osBuild: string
  arch: string
}

export interface TeacherTestRunServiceOptions {
  getRuntime: () => TeacherTestRuntimeSnapshot
  now?: () => Date
}

export interface TeacherTestRunStartInput {
  releaseTag: string
  productSourceCommit: string
  installerPath: string
}

export interface HashedInstallerMetadata {
  installerFileName: string
  installerSha256: string
  size: number
}

interface StoredRun {
  manifest: TeacherTestRunManifestV1
  active: boolean
}

function cloneManifest(
  manifest: TeacherTestRunManifestV1 | null
): TeacherTestRunManifestV1 | null {
  if (!manifest) return null
  return {
    ...manifest,
    artifactClaim: { ...manifest.artifactClaim },
    runtime: { ...manifest.runtime }
  }
}

function assertText(value: string, label: string, maxLength: number): void {
  if (!value || value.length > maxLength) {
    throw new Error(`${label} 格式無效。`)
  }
}

/**
 * Hash a selected installer without loading a large executable into the main
 * process heap. The file must have the same size and modified time before and
 * after the stream is consumed.
 */
export async function hashInstallerFile(filePath: string): Promise<HashedInstallerMetadata> {
  if (!filePath || !filePath.toLowerCase().endsWith('.exe')) {
    throw new Error('老師實測必須選擇 Windows .exe 安裝檔。')
  }

  const before = await stat(filePath)
  if (!before.isFile()) throw new Error('所選安裝檔不是一般檔案。')

  const hash = createHash('sha256')
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 })
  try {
    for await (const chunk of stream) hash.update(chunk as Buffer)
  } finally {
    stream.destroy()
  }

  const after = await stat(filePath)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error('安裝檔在計算 SHA-256 期間發生變更，請重新選取。')
  }

  return {
    installerFileName: basename(filePath),
    installerSha256: hash.digest('hex'),
    size: before.size
  }
}

export class TeacherTestRunService {
  private storedRun: StoredRun | null = null

  private readonly now: () => Date

  constructor(private readonly options: TeacherTestRunServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  getStatus(): TeacherTestRunStatusV1 {
    const runtime = this.options.getRuntime()
    return {
      currentAppVersion: runtime.appVersion,
      active: this.storedRun?.active ?? false,
      manifest: cloneManifest(this.storedRun?.manifest ?? null)
    }
  }

  getManifest(): TeacherTestRunManifestV1 | null {
    return cloneManifest(this.storedRun?.manifest ?? null)
  }

  getActiveManifest(): TeacherTestRunManifestV1 | null {
    return this.storedRun?.active ? cloneManifest(this.storedRun.manifest) : null
  }

  async start(input: TeacherTestRunStartInput): Promise<TeacherTestRunManifestV1> {
    if (this.storedRun?.active) {
      throw new Error('已有進行中的老師實測 run，請先結束或匯出目前 run。')
    }

    const runtime = this.options.getRuntime()
    if (runtime.platform !== 'win32') {
      throw new Error('teacher-test candidate 只允許在 Windows 上開始正式實測。')
    }
    assertText(runtime.appVersion, 'App version', 32)
    assertText(input.releaseTag, 'Release tag', 32)
    assertText(input.productSourceCommit, 'product source commit', 64)
    if (input.releaseTag !== `v${runtime.appVersion}`) {
      throw new Error('Release tag 必須與目前 App version 完全一致。')
    }
    if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(input.releaseTag)) {
      throw new Error('Release tag 必須是穩定的 vX.Y.Z 格式。')
    }
    if (!/^[0-9a-f]{40}$/i.test(input.productSourceCommit)) {
      throw new Error('product source commit 必須是完整 40 碼 SHA-1。')
    }

    const installer = await hashInstallerFile(input.installerPath)
    const manifest: TeacherTestRunManifestV1 = {
      schemaVersion: TEACHER_TEST_SCHEMA_VERSION,
      testRunId: randomUUID(),
      startedAt: this.now().toISOString(),
      artifactClaim: {
        appVersion: runtime.appVersion,
        releaseTag: input.releaseTag,
        productSourceCommit: input.productSourceCommit.toLowerCase(),
        installerFileName: installer.installerFileName,
        installerSha256: installer.installerSha256
      },
      runtime: {
        platform: 'win32',
        systemVersion: runtime.systemVersion,
        osBuild: runtime.osBuild,
        arch: runtime.arch
      }
    }
    this.storedRun = { manifest, active: true }
    return cloneManifest(manifest) as TeacherTestRunManifestV1
  }

  end(): TeacherTestRunManifestV1 {
    if (!this.storedRun?.active) throw new Error('目前沒有進行中的老師實測 run。')
    this.storedRun = {
      active: false,
      manifest: {
        ...this.storedRun.manifest,
        endedAt: this.now().toISOString()
      }
    }
    return cloneManifest(this.storedRun.manifest) as TeacherTestRunManifestV1
  }

  /**
   * Called once when a Harness trace is created. The external review id is a
   * non-PII token that the reviewer copies into the external rubric; names and
   * signatures never enter the app export.
   */
  createEvaluationLink(
    input: TeacherTestCaseIdentityV1
  ): HarnessEvaluationLinkV1 | undefined {
    if (!this.storedRun?.active) return undefined
    const testCaseId = createHash('sha256')
      .update(canonicalizeTeacherTestCase(input), 'utf8')
      .digest('hex')
    return {
      schemaVersion: TEACHER_TEST_SCHEMA_VERSION,
      testRunId: this.storedRun.manifest.testRunId,
      testCaseId,
      canonicalizationVersion: TEACHER_TEST_CANONICALIZATION_VERSION,
      externalReviewId: `review-${randomUUID()}`
    }
  }
}

export function getDefaultTeacherTestRuntime(
  appVersion: string
): TeacherTestRuntimeSnapshot {
  const electronProcess = process as NodeJS.Process & {
    getSystemVersion?: () => string
  }
  const systemVersion =
    typeof electronProcess.getSystemVersion === 'function'
      ? electronProcess.getSystemVersion()
      : os.version()
  return {
    appVersion,
    platform: process.platform,
    systemVersion,
    // os.version() retains the Windows build-bearing version string; this is
    // recorded alongside Electron's system version rather than using release()
    // as the only source.
    osBuild: os.version(),
    arch: process.arch
  }
}
