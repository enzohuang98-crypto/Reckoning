import assert from 'node:assert/strict'
import { formatCentipawnDisplay } from '../../../src/shared/logic/analysis/EngineScoreDisplay'

assert.equal(formatCentipawnDisplay(125), '125')
assert.equal(formatCentipawnDisplay(-40), '-40')
assert.equal(formatCentipawnDisplay(0), '0')
assert.equal(formatCentipawnDisplay(1.6), '2')

console.log('皮卡魚整數分數顯示測試：通過')
