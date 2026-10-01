/* Run: electron tests/e2e/rendererLayout.e2e.cjs --artifact-dir <directory>
 * Real source React/CSS in Chromium with a hidden, isolated Electron window.
 * This verifies renderer layout, not packaged Windows/updater acceptance.
 */
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const outputArg = process.argv.indexOf('--artifact-dir')
const artifactDir = outputArg < 0 ? path.join(os.tmpdir(), 'reckoning-renderer-layout-artifacts') : path.resolve(process.argv[outputArg + 1])
const quick = process.argv.includes('--quick')
const sizes = quick ? [[960, 640]] : [[960, 640], [1008, 680], [1024, 768], [1280, 720], [1366, 768], [1920, 1080], [1280, 360], [1920, 320], [1366, 480]]
const scales = quick ? [1] : [1, 1.25, 1.5, 2]
let window
let profile

async function evaluate(fn, ...args) {
  return window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`)
}
async function settle() {
  await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function click(selector) {
  await evaluate((selector) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing ${selector}`)
    element.click()
  }, selector)
  await settle()
}
async function screenshot(name) {
  // capturePage returns the last painted frame; let the hidden renderer paint
  // the state whose geometry was just measured.
  await new Promise((resolve) => setTimeout(resolve, 100))
  const capture = await window.webContents.capturePage()
  await fs.writeFile(path.join(artifactDir, `${name}.png`), capture.toPNG())
}
async function measureBoard() {
  return evaluate(() => {
    const svg = document.querySelector('.xiangqi-board')
    const wrap = document.querySelector('.board-wrap')
    const editor = document.querySelector('.board-editor')
    const rect = (element) => {
      const r = element.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
    }
    const clipped = []
    const board = svg.getBoundingClientRect()
    for (let ancestor = svg.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      const r = ancestor.getBoundingClientRect()
      if (['hidden', 'clip'].includes(style.overflowY) && (board.y < r.y - 1 || board.bottom > r.bottom + 1)) clipped.push(ancestor.className)
      if (['auto', 'scroll'].includes(style.overflowY)) break
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      board: rect(svg), wrap: rect(wrap), editor: rect(editor), clipped,
      cells: [...svg.querySelectorAll('[role="gridcell"]')].map(rect),
      documentWidth: document.documentElement.scrollWidth
    }
  })
}
async function reachable(selector) {
  return evaluate((selector) => {
    const element = document.querySelector(selector)
    if (!element) return { ok: false, reason: 'missing' }
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const r = element.getBoundingClientRect()
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      const a = ancestor.getBoundingClientRect()
      if (style.overflowX !== 'visible') { left = Math.max(left, a.left); right = Math.min(right, a.right) }
      if (style.overflowY !== 'visible') { top = Math.max(top, a.top); bottom = Math.min(bottom, a.bottom) }
    }
    const x = r.x + r.width / 2, y = r.y + r.height / 2
    const hit = document.elementFromPoint(x, y)
    return { ok: r.width > 0 && r.height > 0 && x >= left && x <= right && y >= top && y <= bottom && (element === hit || element.contains(hit)), rect: { x: r.x, y: r.y, width: r.width, height: r.height }, visible: { left, top, right, bottom } }
  }, selector)
}

async function main() {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'reckoning-renderer-layout-'))
  app.setPath('userData', profile)
  await app.whenReady()
  await fs.mkdir(artifactDir, { recursive: true })
  const { build } = await import('vite')
  const rendered = path.join(profile, 'renderer')
  await build({ configFile: false, root, base: './',
    resolve: { alias: { '@shared': path.join(root, 'src/shared') } },
    esbuild: { jsx: 'automatic' },
    build: { outDir: rendered, emptyOutDir: false, rollupOptions: { input: path.join(root, 'tests/support/renderer-layout.html') } }
  })
  window = new BrowserWindow({ show: false, useContentSize: true, width: 1008, height: 680,
    webPreferences: { preload: path.join(root, 'tests/support/renderer-layout-preload.cjs'), partition: 'renderer-layout', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }))
  const errors = []
  window.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message) })
  const rows = [], failures = []
  for (const [width, height] of sizes) for (const scale of scales) {
    const id = `${width}x${height}-${scale * 100}percent`
    window.setContentSize(width, height)
    window.webContents.setZoomFactor(scale)
    await window.loadFile(path.join(rendered, 'tests/support/renderer-layout.html'))
    await evaluate(() => new Promise((resolve, reject) => {
      let tries = 0
      const poll = () => document.querySelector('.ai-explanation') ? resolve() : ++tries > 200 ? reject(new Error('Renderer did not mount')) : setTimeout(poll, 25)
      poll()
    }))
    await settle()
    const row = { id, physicalViewport: { width, height }, scale, sourceRenderer: true }
    for (const toolsOpen of [false, true]) {
      if (toolsOpen) {
        await click('.toolbar-group .toolbar-menu > summary')
        await evaluate(() => [...document.querySelectorAll('.toolbar-menu-item')].find((element) => element.textContent.includes('擺棋與保存局面')).click())
        await settle()
      }
      const label = toolsOpen ? 'tools-open' : 'analysis'
      await evaluate(() => {
        for (const element of document.querySelectorAll('.app-main, .app-main-analyze, .analyze-page')) element.scrollTop = 0
      })
      await settle()
      const geometry = await measureBoard()
      row[label] = geometry
      await screenshot(`${id}-${label}`)
      try {
        assert.equal(geometry.clipped.length, 0, `Board clipped by ${geometry.clipped.join(', ')}`)
        assert.ok(geometry.board.y >= geometry.wrap.y - 1 && geometry.board.bottom <= geometry.wrap.bottom + 1, 'All ten board rows must fit inside the board wrap')
        assert.ok(geometry.board.width >= 260 && geometry.board.height >= 288, 'Board must remain readable at small/scaled viewports')
        assert.equal(geometry.cells.length, 90)
        assert.ok((await reachable('.xiangqi-board [role="gridcell"][aria-rowindex="1"][aria-colindex="1"]')).ok, 'First board cell must be reachable')
        assert.ok((await reachable('.xiangqi-board [role="gridcell"][aria-rowindex="10"][aria-colindex="9"]')).ok, 'Last board cell must be reachable')
        assert.ok(geometry.documentWidth <= geometry.viewport.width + 1, 'Document must fit the CSS viewport')
        if (toolsOpen) assert.ok((await reachable('.editor-controls input')).ok, 'Save-position control must be reachable')
        assert.ok((await reachable('.follow-up-row input')).ok, 'AI follow-up input must be reachable after scrolling the long Chinese explanation')
        assert.ok((await reachable('[aria-label="設定"]')).ok, 'Header settings navigation must remain reachable')
      } catch (error) { failures.push(`${id} ${label}: ${error.message}`) }
    }
    await click('[aria-label="設定"]')
    await evaluate(() => [...document.querySelectorAll('.settings-nav-item')].find((element) => element.textContent.includes('資料與系統')).click())
    await settle()
    const settings = await evaluate(() => {
      const section = document.querySelector('.settings-section-grid')
      const checkbox = section.querySelector('input[type="checkbox"]')
      const label = checkbox.parentElement
      const r = label.getBoundingClientRect(), c = checkbox.getBoundingClientRect()
      return { sectionWidth: section.clientWidth, scrollWidth: section.scrollWidth, labelWidth: r.width, checkboxWidth: c.width, display: getComputedStyle(label).display }
    })
    row.settings = settings
    await screenshot(`${id}-settings`)
    try {
      assert.ok(settings.scrollWidth <= settings.sectionWidth + 1, 'Settings columns must fit their container')
      assert.ok(settings.checkboxWidth >= 12 && settings.labelWidth > 100, 'Background update checkbox and label must be readable')
      assert.ok((await reachable('.settings-section-grid input[type="checkbox"]')).ok, 'Background update checkbox must be reachable')
      await click('.settings-section-grid input[type="checkbox"]')
      assert.equal(await evaluate(() => document.querySelector('.settings-section-grid input[type="checkbox"]').checked), false, 'Checkbox must remain operable')
      assert.ok((await reachable('.settings-section-grid > .card button')).ok, 'Check-update button must be reachable')
    } catch (error) { failures.push(`${id} settings: ${error.message}`) }
    rows.push(row)
  }
  await fs.writeFile(path.join(artifactDir, 'geometry.json'), JSON.stringify({ renderer: 'Electron source fixture; synthetic state only', rows, errors, failures }, null, 2))
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(failures.length, 0, failures.join('\n'))
  console.log(`PASS renderer layout: ${rows.length} viewport/scale combinations, board/tools/settings/long Chinese content. Artifacts: ${artifactDir}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => {
  window?.destroy()
  app.exit(process.exitCode ?? 0)
})
