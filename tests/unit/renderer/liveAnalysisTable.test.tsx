import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import type { EngineAnalysisResultPayload } from '../../../src/shared/types/ipc'
import {
  EngineConsole,
  type EngineThoughtEntry
} from '../../../src/renderer/src/features/analysis/EngineConsole'
import { EngineResultSummary } from '../../../src/renderer/src/features/analysis/EngineResultSummary'
import { LiveAnalysisTable } from '../../../src/renderer/src/features/analysis/LiveAnalysisTable'

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
  scoreDisplay: '+0.42',
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
    scoreAfterBestMove: { raw: 'score cp 42', displayText: '+0.42' },
    depth: 18,
    analysisTimeMs: 1_250,
    warnings: [],
    incomplete: false,
    candidateMoves: [
      {
        move: 'b2e2',
        displayMove: '炮二平五',
        score: { raw: 'score cp 42', displayText: '+0.42' },
        displayPrincipalVariation: ['炮二平五', '馬8進7', '馬二進三']
      },
      {
        move: 'h2e2',
        displayMove: '炮八平五',
        score: { raw: 'score cp 20', displayText: '+0.20' },
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
assert.match(resultText, /分數 \+0\.42/)
assert.match(resultText, /分數 \+0\.20/)
assert.doesNotMatch(resultText, /原始分數/, '主要分數不得再標成「原始分數」')
assert.match(resultText, /深度/)
assert.match(resultText, /耗時/)
assert.match(resultText, /炮二平五/)
assert.match(resultText, /炮八平五/)
assert.match(resultText, /馬8進7/)
assert.match(resultText, /馬2進3/)

function rankedThought(
  id: string,
  candidateRank: number,
  scoreDisplay: string,
  displayMove: string,
  depth = 18
): EngineThoughtEntry & { candidateRank: number } {
  return {
    ...thought,
    id,
    candidateRank,
    scoreDisplay,
    displayMove,
    displayPrincipalVariation: [displayMove],
    depth
  }
}

function instanceText(instance: TestRenderer.ReactTestInstance): string {
  const visit = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (Array.isArray(value)) return value.map(visit).join(' ')
    if (typeof value !== 'object' || value === null || !('children' in value)) return ''
    return visit((value as { children?: unknown }).children)
  }
  return visit(instance).replace(/\s+/g, ' ').trim()
}

function renderRankedRows(thoughts: EngineThoughtEntry[]): string[] {
  const renderer = TestRenderer.create(
    <LiveAnalysisTable
      status={{ engineName: 'Pikafish', available: true } as never}
      progress={null}
      busy
      thoughts={thoughts}
      result={null}
      error={null}
      notice={null}
      liveElapsedMs={1_000}
      sinceLastThoughtMs={0}
      retainingPreviousAnalysis={false}
    />
  )
  const body = renderer.root.findByType('tbody')
  return body.findAllByType('tr').map((row) =>
    row
      .findAllByType('td')
      .map(instanceText)
      .join(' ')
  )
}

const blackRows = renderRankedRows([
  rankedThought('black-rank-1', 1, '-109', '馬8進7'),
  rankedThought('black-rank-2', 2, '-65', '炮8平5')
])
assert.match(blackRows[0], /-109.*馬8進7/, '黑方第 1 候選必須固定在第一列')
assert.match(blackRows[1], /-65.*炮8平5/, '黑方第 2 候選必須固定在第二列')

const redRows = renderRankedRows([
  rankedThought('red-rank-1', 1, '52', '炮二平五'),
  rankedThought('red-rank-2', 2, '62', '馬二進三')
])
assert.match(redRows[0], /52.*炮二平五/, '紅方第 1 候選必須固定在第一列')
assert.match(redRows[1], /62.*馬二進三/, '紅方第 2 候選必須固定在第二列')

const deepenedRows = renderRankedRows([
  rankedThought('rank-1-depth-17', 1, '48', '炮二平五', 17),
  rankedThought('rank-2-depth-17', 2, '35', '馬二進三', 17),
  rankedThought('rank-1-depth-18', 1, '52', '炮二平五', 18),
  rankedThought('rank-2-depth-18', 2, '41', '馬二進三', 18)
])
assert.equal(deepenedRows.length, 2, '同一候選加深時應更新原列，不得不斷新增而跳動')
assert.match(deepenedRows[0], /52.*18/, '第 1 候選應顯示最新深度')
assert.match(deepenedRows[1], /41.*18/, '第 2 候選應顯示最新深度')

console.log('預設局面分析數字、候選著與分析找法測試：通過')
