import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface FrozenCase {
  caseKey: string
  positionFen: string
  sideToMove: string
  attachedMove: string
  question: string
  mode: 'focused' | 'research'
}

interface FrozenCasesDocument {
  schemaVersion: number
  canonicalizationVersion: number
  sourceFixture: { path: string; sha256: string }
  cases: FrozenCase[]
}

const documentPath = resolve(
  process.cwd(),
  'docs/operations/teacher-test-cases-v1.json'
)
const fixturePath = resolve(process.cwd(), 'tests/fixtures/playok/acceptance-cases.json')
const document = JSON.parse(
  readFileSync(documentPath, 'utf8')
) as FrozenCasesDocument

assert.equal(document.schemaVersion, 1)
assert.equal(document.canonicalizationVersion, 1)
assert.equal(document.cases.length, 6)
assert.equal(
  createHash('sha256')
    .update(readFileSync(fixturePath))
    .digest('hex'),
  document.sourceFixture.sha256
)

const testCaseIds = document.cases.map((testCase) => {
  assert.equal(testCase.positionFen.split(' ')[1], testCase.sideToMove)
  assert.match(testCase.positionFen, /^[^\r\n]+ [wb] /)
  assert.match(testCase.attachedMove, /^[a-i][0-9][a-i][0-9]$/)
  assert.ok(testCase.question.length > 0)
  return createHash('sha256')
    .update(
      JSON.stringify({
        canonicalizationVersion: 1,
        positionFen: testCase.positionFen,
        question: testCase.question.normalize('NFC').replace(/\r\n?/g, '\n'),
        attachedMove: testCase.attachedMove,
        mode: testCase.mode
      }),
      'utf8'
    )
    .digest('hex')
})

assert.equal(new Set(testCaseIds).size, document.cases.length)
console.log('Teacher test frozen cases checks passed.')
