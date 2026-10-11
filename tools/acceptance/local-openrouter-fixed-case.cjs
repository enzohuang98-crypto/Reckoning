const path = require('node:path')
const { app } = require('electron')

const root = path.resolve(__dirname, '..', '..')
process.chdir(root)
process.env.TSX_TSCONFIG_PATH = path.join(root, 'tsconfig.node.json')
app.setName('xiangqi-analyzer')
app.setPath('userData', path.join(app.getPath('appData'), 'xiangqi-analyzer'))

if (!app.requestSingleInstanceLock()) {
  process.stderr.write('Close the installed app before the fixed-case run.\n')
  process.exit(2)
}

require('tsx/cjs')
app.whenReady().then(async () => {
  await require('./local-openrouter-fixed-case.ts').run()
  app.quit()
}).catch(() => {
  process.stderr.write('Fixed-case runner failed; inspect its safe report.\n')
  app.exit(2)
})
