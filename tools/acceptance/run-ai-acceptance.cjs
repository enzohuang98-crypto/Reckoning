try {
  const path = require('node:path')
  const { app } = require('electron')

  const repoRoot = path.resolve(__dirname, '..', '..')
  process.chdir(repoRoot)
  process.env.TSX_TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.node.json')

  app.disableHardwareAcceleration()
  app.setName('xiangqi-analyzer')
  app.setPath('userData', path.join(app.getPath('appData'), 'xiangqi-analyzer'))

  if (!app.requestSingleInstanceLock()) {
    console.error(
      'Acceptance runner refused to start because xiangqi-analyzer is already running. Close the app and retry.'
    )
    process.exit(2)
  } else {
    require('tsx/cjs')
    require('./run-ai-acceptance.ts')
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(2)
}
