import assert from 'node:assert/strict'
import { configureUpdatePolicy } from '../../../src/main/update/UpdatePolicy'

const updater = { autoDownload: true, autoInstallOnAppQuit: true }
configureUpdatePolicy(updater)

assert.equal(updater.autoDownload, false)
assert.equal(updater.autoInstallOnAppQuit, false)
console.log('背景準備但僅明確操作才安裝的政策測試：通過')
