import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { TeacherTestRunSection } from '../../../src/renderer/src/features/settings/TeacherTestRunSection'
import type { TeacherTestRunStatusV1 } from '../../../src/shared/types/Harness'

const sourceCommit = 'a'.repeat(40)
const status: TeacherTestRunStatusV1 = {
  currentAppVersion: '0.3.10',
  active: true,
  manifest: {
    schemaVersion: 1,
    testRunId: 'run-ui-identity',
    startedAt: '2026-08-06T12:00:00.000Z',
    artifactClaim: {
      appVersion: '0.3.10',
      releaseTag: 'v0.3.10',
      productSourceCommit: sourceCommit,
      installerFileName: 'xiangqi-analyzer-0.3.10-setup.exe',
      installerSha256: 'b'.repeat(64)
    },
    runtime: {
      platform: 'win32',
      systemVersion: '10.0.22631',
      osBuild: 'Windows 11 10.0.22631',
      arch: 'x64'
    }
  }
}

const renderer = TestRenderer.create(
  <TeacherTestRunSection
    status={status}
    busy={false}
    message={null}
    onStart={() => undefined}
    onEnd={() => undefined}
  />
)

const text = renderer.root
  .findAll((node) => typeof node.type === 'string')
  .flatMap((node) => node.children)
  .filter((child): child is string => typeof child === 'string')
  .join(' ')

assert.match(text, /App version：/)
assert.match(text, /0\.3\.10/)
assert.match(text, /release tag：/)
assert.match(text, /v0\.3\.10/)
assert.match(text, /source commit：/)
assert.match(text, new RegExp(sourceCommit))
assert.match(text, /xiangqi-analyzer-0\.3\.10-setup\.exe/)
assert.match(text, /Windows 11 10\.0\.22631/)

console.log('Teacher test run identity display checks passed.')
