import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import type { EngineAnalysisResultPayload } from '../../../src/shared/types/ipc'
import {
  EngineConsole,
  type EngineThoughtEntry
} from '../../../src/renderer/src/features/analysis/EngineConsole'
import { EngineResultSummary } from '../../../src/renderer/src/features/analysis/EngineResultSummary'

function renderedText(renderer: TestRenderer.ReactTestRenderer): string {
  const visit = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (Array.isArray(value)) return value.map(visit).join(' ')
    if (typeof value !== 'object' || value === null || !('children' in value)) return ''
    return visit((value as { children?: unknown }).children)
  }
  return visit(renderer.toJSON()).replace(/\s+/g, ' ').trim()
}

const thought: EngineThoughtEntry = {
  id: 'root-depth-18',
  phase: 'root_analysis',
  elapsedMs: 1_250,
  depth: 18,
  nodes: 1_234_567,
  nps: 987_654,
  scoreRaw: '+0.42',
  displayMove: '炮二平五',
  displayPrincipalVariation: ['炮二平五', '馬8進7', '馬二進三'],
  engineRole: 'primary',
  engineName: 'Pikafish'
}

const consoleView = TestRenderer.create(
  <EngineConsole
    status={{ engineName: 'Pikafish', available: true } as never}
    progress={null}
    busy={false}
    completedDepth={18}
    thoughts={[thought]}
    liveElapsedMs={null}
    sinceLastThoughtMs={null}
  />
)
const consoleText = renderedText(consoleView)
assert.match(consoleText, /深度 18/)
assert.match(consoleText, /分數 \+0\.42/)
assert.match(consoleText, /耗時 1\.3s/)
assert.match(consoleText, /NPS 987\.7K/)
assert.match(consoleText, /節點 1\.2M/)
assert.match(consoleText, /炮二平五/)
assert.match(consoleText, /馬8進7/)

const result = {
  analysisId: 'analysis-table-test',
  engineAnalysis: {
    displayBestMove: '炮二平五',
    scoreAfterBestMove: { raw: '+0.42' },
    depth: 18,
    analysisTimeMs: 1_250,
    warnings: [],
    incomplete: false,
    candidateMoves: [
      {
        move: 'b2e2',
        displayMove: '炮二平五',
        score: { raw: '+0.42' },
        displayPrincipalVariation: ['炮二平五', '馬8進7', '馬二進三']
      },
      {
        move: 'h2e2',
        displayMove: '炮八平五',
        score: { raw: '+0.20' },
        displayPrincipalVariation: ['炮八平五', '馬2進3']
      }
    ]
  },
  moveComparison: {
    confidence: 'high',
    uncertaintyReasons: []
  }
} as unknown as EngineAnalysisResultPayload

const compactResult = TestRenderer.create(
  <EngineResultSummary result={result} compact />
)
const candidateList = compactResult.root.find(
  (node) => node.type === 'ol' && node.props['aria-label'] === '候選著法與分析找法'
)
assert.equal(candidateList.findAllByType('li').length, 2)
const resultText = renderedText(compactResult)
assert.match(resultText, /原始分數/)
assert.match(resultText, /深度/)
assert.match(resultText, /耗時/)
assert.match(resultText, /炮二平五/)
assert.match(resultText, /炮八平五/)
assert.match(resultText, /馬8進7/)
assert.match(resultText, /馬2進3/)

console.log('預設局面分析數字、候選著與分析找法測試：通過')
