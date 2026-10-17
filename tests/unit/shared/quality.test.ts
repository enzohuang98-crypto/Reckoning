/**
 * AI 回答文字品質詞表（scoreUsedAsReason、VAGUE_PHRASES）
 *
 * v2 AnswerCheck 以這兩項產生軟警告。v1 十項品質評分器與因果鏈驗證已於 P4-1 刪除；
 * 這裡保留原評測集中「只講分數」「空泛帶過」的樣本，直接驗證這兩項判斷。
 */

import {
  scoreUsedAsReason,
  VAGUE_PHRASES
} from '../../../src/shared/logic/ai/ExplanationQualityScorer'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail === undefined ? '' : ` — ${String(detail)}`}`)
  }
}

function hasVaguePhrase(text: string): boolean {
  return VAGUE_PHRASES.some((phrase) => text.includes(phrase))
}

console.log('\n## 以分數當理由')

check(
  '只講分數被擋下',
  scoreUsedAsReason('馬八進七之後引擎分數較低，炮二平五分數較高，所以馬八進七比較差。')
)
check(
  '回歸案例「只用分數當理由」被擋下',
  scoreUsedAsReason(
    '馬八進七之後引擎評分較低，而炮二平五的分數較高，所以馬八進七不好，建議改走分數更高的著法。'
  )
)
check('直述數字差距被擋下', scoreUsedAsReason('炮二平五比馬八進七高出 0.35 個兵。'))
check(
  '具體棋理解說不被誤判為以分數當理由',
  !scoreUsedAsReason(
    '因為先走馬八進七而不是炮二平五，紅方開局第一時間的中路壓制被推遲；黑方趁機馬8進7完成出子，之後再馬2進3補齊另一翼，兩翼馬完成部署。結果紅方要到第三手才補回中炮，先手節奏被拖慢，中路攻勢延後。'
  )
)

console.log('\n## 空泛詞')

const vagueSamples: Array<[string, string]> = [
  ['空泛回答', '黑方大致上可以獲得不錯的機會。'],
  ['回歸案例「空泛評價帶過」', '這步棋大致上還可以，但整體而言不夠理想，局面複雜，總體而言建議多注意灵活性與主動性。'],
  ['緩手：空泛版本', '這步下得偏慢，整體而言節奏不太好。'],
  ['錯失先手：空泛版本', '這步棋基本上讓對方比較舒服，主動性不足。'],
  ['讓對手完成部署：空泛版本', '對手因此可以慢慢發展，各方面都還可以。'],
  ['王區變弱：空泛版本', '王區變弱，需要注意安全。'],
  ['錯過戰術：空泛版本', '這裡其實有更好的下法，值得注意。']
]
for (const [name, text] of vagueSamples) {
  check(`${name}含空泛詞`, hasVaguePhrase(text))
}

const concreteSamples: Array<[string, string]> = [
  ['緩手：具體版本', '馬八進七是緩手：錯過炮二平五立即壓制中路的一手，黑方馬8進7先出子。'],
  ['錯失先手：具體版本', '因為先走馬八進七，紅方讓出先手；黑方馬8進7後，紅方炮二平五已慢一拍。'],
  ['棋子受限：具體版本', '馬八進七後紅馬被卒3進1蹩馬腿，這匹馬受制無法過河。'],
  ['錯過戰術：具體版本', '錯過炮二平五後的抽將戰術：主線炮二平五、馬8進7、車九平八可形成捉雙，得子機會消失。']
]
for (const [name, text] of concreteSamples) {
  check(`${name}不含空泛詞`, !hasVaguePhrase(text))
}

console.log(`結果：${passed} 通過，${failed} 失敗`)
if (failed > 0) process.exitCode = 1
