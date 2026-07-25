/**
 * 相依套件弱點稽核（分層把關）。
 *
 * 背景：`npm audit --audit-level=moderate` 對整棵樹一視同仁，但本專案的
 * 執行期相依（會被打包進使用者安裝的 App）與建置工具相依（只在開發者/CI
 * 機器上跑 electron-builder）風險等級完全不同。electron-builder 的相依鏈
 * 目前卡在 minimatch 3.x/5.x/9.x，而它們需要的 brace-expansion 1.x/2.x
 * 沒有任何 backport 修正版；唯一修好的 5.0.8 改了匯出形式
 * （`module.exports = expand` → `{ expand }`），強制覆蓋會讓舊 minimatch
 * 在含大括號的 glob pattern 上丟 `TypeError: expand is not a function`，
 * 直接弄壞 `npm run dist` 打包。
 *
 * 因此政策為：
 *
 *   1. 執行期相依（--omit=dev）：任何 moderate 以上弱點一律擋下。
 *   2. 建置工具相依：若 `npm audit fix` 能在不破壞相容性的前提下修好
 *      （fixAvailable === true），視為「應該修卻沒修」，一樣擋下。
 *   3. 建置工具相依且只剩破壞性修法（fixAvailable 為 false 或
 *      isSemVerMajor）：只報告、不擋，並列出詳情供人工追蹤。
 *
 * 第 2 條是關鍵——它讓這個豁免不會變成永久免死金牌：只要上游釋出可安全
 * 套用的修正，CI 就會立刻要求我們套用。
 */

import { spawnSync } from 'node:child_process'

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
const MINIMUM_SEVERITY = 'moderate'

function meetsThreshold(severity) {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(MINIMUM_SEVERITY)
}

/** 執行 npm audit --json；audit 發現弱點時會以非零結束，故不能只看 exit code。 */
function runAudit(extraArgs) {
  const args = ['audit', '--json', ...extraArgs]
  const result = spawnSync('npm', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024
  })

  if (result.error) {
    throw new Error(`無法執行 npm ${args.join(' ')}：${result.error.message}`)
  }

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    const detail = (result.stderr || result.stdout || '').trim().slice(0, 2000)
    throw new Error(`npm ${args.join(' ')} 沒有回傳可解析的 JSON：\n${detail}`)
  }

  // npm 自己回報執行失敗（例如 registry 連不上）時不可當成「沒有弱點」。
  if (report.error) {
    throw new Error(
      `npm audit 執行失敗：${report.error.summary ?? JSON.stringify(report.error)}`
    )
  }

  return report
}

function collect(report) {
  return Object.entries(report.vulnerabilities ?? {})
    .filter(([, item]) => meetsThreshold(item.severity))
    .map(([name, item]) => ({
      name,
      severity: item.severity,
      range: item.range,
      fixAvailable: item.fixAvailable,
      advisories: (item.via ?? [])
        .filter((via) => typeof via === 'object')
        .map((via) => ({ title: via.title, url: via.url }))
    }))
}

/** fixAvailable === true 代表 `npm audit fix` 可在 semver 範圍內安全修好。 */
function hasSafeFix(vulnerability) {
  return vulnerability.fixAvailable === true
}

function describeFix(fixAvailable) {
  if (fixAvailable === true) return 'npm audit fix 可安全修復'
  if (!fixAvailable) return '上游尚無修正版'
  const breaking = fixAvailable.isSemVerMajor ? '，且為破壞性變更' : ''
  return `僅能改用 ${fixAvailable.name}@${fixAvailable.version}${breaking}`
}

function printList(title, items) {
  console.log(`\n${title}`)
  for (const item of items) {
    console.log(`  - ${item.name} (${item.severity}) ${item.range}`)
    console.log(`      修復途徑：${describeFix(item.fixAvailable)}`)
    for (const advisory of item.advisories) {
      console.log(`      ${advisory.title}`)
      if (advisory.url) console.log(`      ${advisory.url}`)
    }
  }
}

function main() {
  console.log('## 相依套件弱點稽核')

  // ---- 第 1 層：執行期相依，零容忍 ----
  const runtime = collect(runAudit(['--omit=dev']))
  if (runtime.length > 0) {
    printList(
      `✗ 執行期相依有 ${runtime.length} 個 ${MINIMUM_SEVERITY} 以上弱點（會隨 App 散布，必須修復）：`,
      runtime
    )
    console.error('\n執行期相依不得帶有已知弱點。')
    process.exit(1)
  }
  console.log(`  ✓ 執行期相依：0 個 ${MINIMUM_SEVERITY} 以上弱點`)

  // ---- 第 2 層：建置工具相依 ----
  const all = collect(runAudit([]))
  const runtimeNames = new Set(runtime.map((item) => item.name))
  const buildOnly = all.filter((item) => !runtimeNames.has(item.name))

  const actionable = buildOnly.filter(hasSafeFix)
  const accepted = buildOnly.filter((item) => !hasSafeFix(item))

  if (actionable.length > 0) {
    printList(
      `✗ 建置工具相依有 ${actionable.length} 個可安全修復的弱點（請執行 npm audit fix 後重跑）：`,
      actionable
    )
    console.error('\n可安全修復的弱點不得累積。')
    process.exit(1)
  }

  if (accepted.length > 0) {
    printList(
      `⚠ 建置工具相依有 ${accepted.length} 個已知弱點，目前只剩破壞性修法，暫予記錄追蹤：`,
      accepted
    )
    console.log(
      '\n這些套件只在開發者與 CI 機器上執行 electron-builder 時使用，不會被打包進使用者安裝的 App。'
    )
    console.log(
      '上游一旦釋出可安全套用的修正，第 2 層檢查會自動要求套用，不會無限期豁免。'
    )
  } else {
    console.log('  ✓ 建置工具相依：0 個未處理弱點')
  }

  console.log('\n相依套件弱點稽核通過。')
}

try {
  main()
} catch (error) {
  console.error(`\n相依套件弱點稽核無法完成：${error.message}`)
  process.exit(1)
}
