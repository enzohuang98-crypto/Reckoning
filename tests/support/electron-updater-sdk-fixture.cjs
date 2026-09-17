const { createHash } = require('node:crypto')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawn } = require('node:child_process')
const { gzipSync } = require('node:zlib')
const { NsisUpdater } = require('electron-updater')

function sha512(data) {
  return createHash('sha512').update(data).digest('base64')
}

function makePayload(label, chunkCount) {
  const chunks = []
  for (let index = 0; index < chunkCount; index++) {
    const seed = createHash('sha256').update(`${label}:${index}`).digest()
    const chunk = Buffer.alloc(32 * 1024)
    for (let offset = 0; offset < chunk.length; offset += seed.length) {
      seed.copy(chunk, offset, 0, Math.min(seed.length, chunk.length - offset))
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function makeBlockMap(chunks) {
  return {
    version: '2',
    files: [
      {
        name: 'file',
        offset: 0,
        checksums: chunks.map((chunk) => createHash('sha256').update(chunk).digest('base64')),
        sizes: chunks.map((chunk) => chunk.length)
      }
    ]
  }
}

async function createElectronUpdaterFixture(electronApp) {
  const root = mkdtempSync(join(tmpdir(), 'reckoning-electron-updater-sdk-'))
  const localAppData = join(root, 'local-app-data')
  const userDataPath = join(root, 'user-data')
  const updaterCacheDirName = `reckoning-sdk-${process.pid}-${Date.now()}`
  const configPath = join(root, 'app-update.yml')
  const previousLocalAppData = process.env.LOCALAPPDATA
  const previousUserDataPath = electronApp.getPath('userData')
  mkdirSync(localAppData, { recursive: true })
  mkdirSync(userDataPath, { recursive: true })
  process.env.LOCALAPPDATA = localAppData
  electronApp.setPath('userData', userDataPath)

  const requests = {
    metadataGets: 0,
    blockmapGets: 0,
    installerGets: 0,
    fullPayloadGets: 0,
    rangePayloadGets: 0,
    payloadBytes: 0
  }
  let release = null
  let failPayloadRequests = 0

  const server = createServer((request, response) => {
    if (release == null) {
      response.writeHead(503).end('fixture release not published')
      return
    }

    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    if (pathname === '/latest.yml') {
      requests.metadataGets++
      const yaml = [
        `version: ${release.version}`,
        'files:',
        `  - url: ${release.fileName}`,
        `    sha512: ${sha512(release.payload)}`,
        `    size: ${release.payload.length}`,
        `path: ${release.fileName}`,
        `sha512: ${sha512(release.payload)}`,
        'releaseDate: 2026-09-15T00:00:00.000Z',
        ''
      ].join('\n')
      response.writeHead(200, {
        'content-type': 'text/yaml',
        'content-length': Buffer.byteLength(yaml)
      })
      response.end(yaml)
      return
    }

    if (pathname.endsWith('.blockmap')) {
      requests.blockmapGets++
      if (release.blockMap == null || pathname !== `/${release.fileName}.blockmap`) {
        response.writeHead(404).end('blockmap unavailable')
        return
      }
      const body = gzipSync(JSON.stringify(release.blockMap))
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length })
      response.end(body)
      return
    }

    if (pathname === `/${release.fileName}`) {
      requests.installerGets++
      const range = request.headers.range
      if (range == null) requests.fullPayloadGets++
      else requests.rangePayloadGets++
      if (failPayloadRequests > 0) {
        failPayloadRequests--
        response.writeHead(503).end('fixture payload failure')
        return
      }
      if (range != null) {
        const match = /^bytes=(\d+)-(\d+)$/.exec(range)
        if (match == null) {
          response.writeHead(416).end()
          return
        }
        const start = Number(match[1])
        const end = Math.min(Number(match[2]), release.payload.length - 1)
        const body = release.payload.subarray(start, end + 1)
        requests.payloadBytes += body.length
        response.writeHead(206, {
          'content-range': `bytes ${start}-${end}/${release.payload.length}`,
          'accept-ranges': 'bytes',
          'content-length': body.length
        })
        response.end(body)
        return
      }

      requests.payloadBytes += release.payload.length
      response.writeHead(200, {
        'accept-ranges': 'bytes',
        'content-length': release.payload.length
      })
      response.end(release.payload)
      return
    }

    response.writeHead(404).end('fixture path not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address == null || typeof address === 'string') throw new Error('Fixture server has no TCP port.')
  const feedUrl = `http://127.0.0.1:${address.port}/`
  writeFileSync(
    configPath,
    [
      'provider: generic',
      `url: ${feedUrl}`,
      'useMultipleRangeRequest: false',
      `updaterCacheDirName: ${updaterCacheDirName}`,
      ''
    ].join('\n')
  )

  function publish({ version, payload, blockMap = null }) {
    release = { version, payload, blockMap, fileName: `Reckoning-Setup-${version}.exe` }
  }

  function resetRequests() {
    for (const key of Object.keys(requests)) requests[key] = 0
  }

  function corruptCachedPayload() {
    if (release == null) throw new Error('Cannot corrupt cache before publishing a release.')
    const cachedPayload = join(localAppData, updaterCacheDirName, 'pending', release.fileName)
    writeFileSync(cachedPayload, Buffer.from('corrupt updater cache payload'))
  }

  function failNextPayloadRequest() {
    failPayloadRequests++
  }

  function seedDifferentialBase(payload, blockMap) {
    const cacheRoot = join(localAppData, updaterCacheDirName)
    mkdirSync(cacheRoot, { recursive: true })
    writeFileSync(join(cacheRoot, 'installer.exe'), payload)
    writeFileSync(join(cacheRoot, 'current.blockmap'), gzipSync(JSON.stringify(blockMap)))
  }

  function createUpdater() {
    const updater = new NsisUpdater()
    updater.updateConfigPath = configPath
    updater.forceDevUpdateConfig = true
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.disableWebInstaller = true
    updater.logger = null
    return updater
  }

  async function close() {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    electronApp.setPath('userData', previousUserDataPath)
    if (previousLocalAppData == null) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previousLocalAppData
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    } catch (error) {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
      // Chromium can hold its isolated user-data LevelDB until Electron exits.
      // A short-lived Node-mode Electron child removes only this verified temp root afterward.
      const cleanupScript = [
        "const fs=require('node:fs')",
        "const os=require('node:os')",
        "const path=require('node:path')",
        "const target=path.resolve(process.argv[1])",
        "const temp=path.resolve(os.tmpdir())",
        "if(path.dirname(target)!==temp||!path.basename(target).startsWith('reckoning-electron-updater-sdk-'))process.exit(2)",
        "let attempts=0",
        "const remove=()=>{try{fs.rmSync(target,{recursive:true,force:true,maxRetries:2,retryDelay:25});process.exit(0)}catch{if(++attempts>=100)process.exit(1);setTimeout(remove,50)}}",
        'remove()'
      ].join(';')
      const cleanup = spawn(process.execPath, ['-e', cleanupScript, root], {
        detached: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore',
        windowsHide: true
      })
      cleanup.unref()
    }
  }

  return {
    close,
    corruptCachedPayload,
    createUpdater,
    failNextPayloadRequest,
    localAppData,
    publish,
    requests,
    resetRequests,
    root,
    seedDifferentialBase,
    updaterCacheDirName
  }
}

module.exports = { createElectronUpdaterFixture, makeBlockMap, makePayload, sha512 }
