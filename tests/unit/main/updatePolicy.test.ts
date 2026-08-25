import assert from 'node:assert/strict'
import { configureUpdatePolicy } from '../../../src/main/update/UpdatePolicy'

const updater = { autoDownload: false, autoInstallOnAppQuit: true }
configureUpdatePolicy(updater)

assert.equal(updater.autoDownload, true)
assert.equal(updater.autoInstallOnAppQuit, false)
console.log('自动更新政策测试：通过')
