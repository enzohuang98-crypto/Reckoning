import assert from 'node:assert/strict'
import {
  formatCentipawnDisplay,
  formatEngineScoreDisplay
} from '../../../src/shared/logic/analysis/EngineScoreDisplay'
import type { EngineScore } from '../../../src/shared/types/EngineAnalysis'

assert.equal(formatCentipawnDisplay(125), '125')
assert.equal(formatCentipawnDisplay(-40), '-40')
assert.equal(formatCentipawnDisplay(0), '0')
assert.equal(formatCentipawnDisplay(1.6), '2')

const cpScore: EngineScore = {
  type: 'cp',
  cp: 125,
  value: 1.25,
  comparableValue: 1.25,
  raw: 'score cp 125',
  displayText: '+1.25',
  wasInverted: false,
  source: 'root_analysis'
}
assert.equal(formatEngineScoreDisplay(cpScore), '125')

const mateScore: EngineScore = {
  type: 'mate',
  mateIn: 3,
  comparableValue: 29997,
  raw: 'score mate 3',
  displayText: '殺 3',
  isTerminalMate: false,
  wasInverted: false,
  source: 'root_analysis'
}
assert.equal(formatEngineScoreDisplay(mateScore), '殺 3')

console.log('皮卡魚整數分數顯示測試：通過')
