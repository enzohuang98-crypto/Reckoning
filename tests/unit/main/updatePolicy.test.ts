import assert from 'node:assert/strict'
import { configureUpdatePolicy } from '../../../src/main/update/UpdatePolicy'

const updater = { autoDownload: true, autoInstallOnAppQuit: true }
configureUpdatePolicy(updater)

assert.equal(updater.autoDownload, false)
assert.equal(updater.autoInstallOnAppQuit, false)
console.log('更新须经使用者同意的政策测试：通过')
