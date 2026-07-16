import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { parsePlayOkWxf } from '../../../src/shared/logic/board/PlayOkWxf'
import { START_FEN } from '../../../src/shared/types/BoardState'

interface SourceManifestEntry {
  sourceUrl: string
  gameId: string
  fixture: string
  result: string
  halfMoveCount: number
  downloadUrl: string
  sha256: string
  statRow: {
    terminationLabel: string | null
    abandoned: boolean
  }
  selectionReason: string
}

interface SourcesManifest {
  criteria: {
    abandoned: boolean
    minimumHalfMoves: number
    fullyReplayable: boolean
  }
  sources: SourceManifestEntry[]
}

const fixtureDir = new URL('../../fixtures/playok/', import.meta.url)
const manifest = JSON.parse(
  readFileSync(new URL('sources.manifest.json', fixtureDir), 'utf8')
) as SourcesManifest

const expected = new Map([
  [
    'xq272174077',
    {
      halfMoves: 153,
      firstDisplay: 'P3+1',
      lastDisplay: 'R6.2',
      lastMove: 'd6h6',
      finalFen: '2Nk5/3r5/4b4/7R1/9/9/9/4B4/4A4/2B1KA3 b - - 2 77'
    }
  ],
  [
    'xq267431809',
    {
      halfMoves: 75,
      firstDisplay: 'C8.5',
      lastDisplay: 'H3-1',
      lastMove: 'g4i3',
      finalFen: '2b1k2r1/4a4/4b4/p3p2Cp/9/9/P7N/4B2R1/4A4/3AK4 b - - 0 38'
    }
  ],
  [
    'xq276129901',
    {
      halfMoves: 161,
      firstDisplay: 'A6+5',
      lastDisplay: 'H6+7',
      lastMove: 'd5c7',
      finalFen: '3k2b2/4a4/2Nab4/9/4n4/9/4p1p2/2p6/4AC3/2BK1AB2 b - - 1 81'
    }
  ]
])

assert.equal(manifest.criteria.abandoned, false)
assert.equal(manifest.criteria.minimumHalfMoves, 30)
assert.equal(manifest.criteria.fullyReplayable, true)
assert.equal(manifest.sources.length, 3)
assert.equal(new Set(manifest.sources.map((source) => source.sourceUrl)).size, 3)

for (const source of manifest.sources) {
  const expectedGame = expected.get(source.gameId)
  assert.ok(expectedGame, `manifest 含未預期對局：${source.gameId}`)
  assert.equal(source.fixture, `${source.gameId}.wxf`)
  assert.equal(source.downloadUrl, `https://www.playok.com/p/?g=${source.gameId}.txt`)
  assert.equal(source.halfMoveCount, expectedGame.halfMoves)
  assert.ok(source.halfMoveCount >= manifest.criteria.minimumHalfMoves)
  assert.equal(source.statRow.terminationLabel, null)
  assert.equal(source.statRow.abandoned, false)
  assert.equal(source.selectionReason, 'longest qualifying')

  const fixtureUrl = new URL(source.fixture, fixtureDir)
  const fixture = readFileSync(fixtureUrl)
  assert.equal(
    createHash('sha256').update(fixture).digest('hex'),
    source.sha256,
    `${basename(fixtureUrl.pathname)} SHA-256`
  )

  const input = fixture.toString('utf8')
  assert.match(input, /^FORMAT\s+WXF$/m)
  assert.equal(input.match(/^RESULT\s+(.+)$/m)?.[1].trim(), source.result)

  const parsed = parsePlayOkWxf(input)
  assert.equal(parsed.valid, true, source.gameId)
  if (!parsed.valid) continue

  assert.equal(parsed.format, 'wxf', source.gameId)
  assert.equal(parsed.moves.length, expectedGame.halfMoves, source.gameId)
  assert.equal(parsed.positions.length, expectedGame.halfMoves + 1, source.gameId)
  assert.equal(parsed.positions[0].fen, START_FEN, source.gameId)
  assert.equal(parsed.displayMoves[0], expectedGame.firstDisplay, source.gameId)
  assert.equal(parsed.displayMoves.at(-1), expectedGame.lastDisplay, source.gameId)
  assert.equal(parsed.moves.at(-1), expectedGame.lastMove, source.gameId)
  assert.equal(parsed.positions.at(-1)?.fen, expectedGame.finalFen, source.gameId)
}

assert.deepEqual(new Set(expected.keys()), new Set(manifest.sources.map((source) => source.gameId)))

console.log('PlayOK source fixture tests passed')
