import { strict as assert } from 'node:assert'
import { HarnessTraceStore } from '../../../src/main/storage/HarnessTraceStore'
import type { HarnessTrace } from '../../../src/shared/types/Harness'

const trace = {
  id: 'trace-allowlist',
  createdAt: new Date().toISOString(),
  positionFen: '4k4/9/9/9/9/9/9/9/9/4K4 w',
  mode: 'research',
  primaryEngineId: 'engine-1',
  phases: [],
  evidence: [],
  validationErrors: [],
  modelCalls: 1,
  engineRounds: 1,
  status: 'completed',
  finalText: 'safe text',
  apiKey: 'should-never-export',
  authorization: 'Bearer should-never-export',
  absolutePath: 'C:\\Users\\teacher\\secrets.json'
} as unknown as HarnessTrace & Record<string, unknown>

let written: unknown = null
const store = new HarnessTraceStore({
  read: () => [trace],
  write: (_name: string, value: unknown) => {
    written = value
  }
} as never)

const exported = store.listForExport()
assert.equal(exported.length, 1)
assert.equal(JSON.stringify(exported).includes('should-never-export'), false)
assert.equal(JSON.stringify(exported).includes('secrets.json'), false)
assert.equal(Object.prototype.hasOwnProperty.call(exported[0], 'apiKey'), false)

store.save(trace)
assert(written)
assert.equal(JSON.stringify(written).includes('should-never-export'), false)
assert.equal(JSON.stringify(written).includes('secrets.json'), false)

console.log('Harness trace allowlist checks passed.')
