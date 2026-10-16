import assert from 'node:assert/strict'
import { trustSystemCertificates } from '../../../src/main/security/SystemCertificates'

type Api = Parameters<typeof trustSystemCertificates>[0]

function fakeApi(defaults: string[], system: string[] | Error): { api: Api; set: string[][] } {
  const set: string[][] = []
  const api = {
    getCACertificates: (type?: string) => {
      if (type === 'system') {
        if (system instanceof Error) throw system
        return system
      }
      return defaults
    },
    setDefaultCACertificates: (certs: string[]) => {
      set.push(certs)
    }
  } as unknown as Api
  return { api, set }
}

// 系統根憑證加在內建清單之後，重複的不再加入。
const merged = fakeApi(['A', 'B'], ['B', 'KASPERSKY'])
assert.deepEqual(trustSystemCertificates(merged.api), { added: 1, ok: true })
assert.deepEqual(merged.set, [['A', 'B', 'KASPERSKY']])

// 系統沒有額外憑證：不改設定。
const same = fakeApi(['A'], ['A'])
assert.deepEqual(trustSystemCertificates(same.api), { added: 0, ok: true })
assert.equal(same.set.length, 0)

// 讀不到系統憑證：維持原狀、不丟錯，不擋 App 啟動。
const broken = fakeApi(['A'], new Error('store unavailable'))
assert.deepEqual(trustSystemCertificates(broken.api), { added: 0, ok: false })
assert.equal(broken.set.length, 0)

// 舊版 Node 沒有這兩個 API：直接略過。
assert.deepEqual(trustSystemCertificates({} as Api), { added: 0, ok: false })

console.log('system certificate trust tests passed')
