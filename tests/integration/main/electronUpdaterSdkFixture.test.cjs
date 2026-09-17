const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { app } = require('electron')
const {
  createElectronUpdaterFixture,
  makeBlockMap,
  makePayload
} = require('../../support/electron-updater-sdk-fixture.cjs')

app.disableHardwareAcceleration()

async function run() {
  await app.whenReady()
  const fixture = await createElectronUpdaterFixture(app)
  const fixtureMajor = Number.parseInt(app.getVersion().split('.')[0], 10) + 10
  const firstVersion = `${fixtureMajor}.1.0`
  const differentialVersion = `${fixtureMajor}.2.0`
  const fallbackVersion = `${fixtureMajor}.3.0`

  try {
    const payload = makePayload('first-download', 3)
    fixture.publish({ version: firstVersion, payload })

    const updater = fixture.createUpdater()
    const result = await updater.checkForUpdates()
    assert.equal(result?.isUpdateAvailable, true)

    const downloaded = await updater.downloadUpdate()
    assert.equal(downloaded.length, 1)
    assert.equal(fixture.requests.payloadBytes, payload.length, '首次下載必須實際取得完整 installer payload')
    assert.ok(fixture.requests.metadataGets > 0)
    assert.equal(fixture.requests.installerGets, 1)
    assert.equal(fixture.requests.fullPayloadGets, 1)
    assert.equal(fixture.requests.rangePayloadGets, 0)

    fixture.resetRequests()
    const freshUpdater = fixture.createUpdater()
    const cachedResult = await freshUpdater.checkForUpdates()
    assert.equal(cachedResult?.isUpdateAvailable, true)
    const cachedDownload = await freshUpdater.downloadUpdate()
    assert.deepEqual(cachedDownload, downloaded)
    assert.equal(fixture.requests.payloadBytes, 0, 'fresh updater 必須接受相同版本與 SHA-512 的有效 cache')
    assert.equal(fixture.requests.installerGets, 0)
    assert.equal(fixture.requests.fullPayloadGets, 0)
    assert.equal(fixture.requests.rangePayloadGets, 0)

    fixture.corruptCachedPayload()
    fixture.resetRequests()
    fixture.failNextPayloadRequest()
    const retryingUpdater = fixture.createUpdater()
    await retryingUpdater.checkForUpdates()
    let corruptCacheReportedReady = false
    retryingUpdater.once('update-downloaded', () => {
      corruptCacheReportedReady = true
    })
    await assert.rejects(retryingUpdater.downloadUpdate(), /503|ERR_UPDATER|server/i)
    assert.equal(corruptCacheReportedReady, false, '破損 cache 加上失敗網路不得回報 ready')

    const retried = await retryingUpdater.downloadUpdate()
    assert.equal(corruptCacheReportedReady, true, '失敗後同一 updater 必須可重試成功')
    assert.ok(fixture.requests.payloadBytes > 0)
    assert.deepEqual(readFileSync(retried[0]), payload)

    const changedPayload = makePayload('same-version-different-hash', 3)
    fixture.publish({ version: firstVersion, payload: changedPayload })
    fixture.resetRequests()
    const changedHashUpdater = fixture.createUpdater()
    await changedHashUpdater.checkForUpdates()
    const changedHashDownload = await changedHashUpdater.downloadUpdate()
    assert.ok(fixture.requests.payloadBytes > 0, '同版本但不同 SHA-512 不得沿用舊 cache')
    assert.deepEqual(readFileSync(changedHashDownload[0]), changedPayload)

    const sharedHead = makePayload('differential-shared-head', 1)
    const oldMiddle = makePayload('differential-old-middle', 1)
    const newMiddle = makePayload('differential-new-middle', 1)
    const sharedTail = makePayload('differential-shared-tail', 1)
    const oldPayload = Buffer.concat([sharedHead, oldMiddle, sharedTail])
    const differentialPayload = Buffer.concat([sharedHead, newMiddle, sharedTail])
    const oldBlockMap = makeBlockMap([sharedHead, oldMiddle, sharedTail])
    const newBlockMap = makeBlockMap([sharedHead, newMiddle, sharedTail])
    // The SDK normally receives these two files from an already-installed NSIS version.
    // This non-installing fixture seeds only that prior-version boundary, then uses public SDK download APIs.
    fixture.seedDifferentialBase(oldPayload, oldBlockMap)
    fixture.publish({ version: differentialVersion, payload: differentialPayload, blockMap: newBlockMap })
    fixture.resetRequests()
    const differentialUpdater = fixture.createUpdater()
    await differentialUpdater.checkForUpdates()
    const differentialDownload = await differentialUpdater.downloadUpdate()
    assert.equal(fixture.requests.fullPayloadGets, 0)
    assert.equal(fixture.requests.blockmapGets, 1)
    assert.equal(fixture.requests.installerGets, fixture.requests.rangePayloadGets)
    assert.equal(fixture.requests.rangePayloadGets, 1)
    assert.equal(fixture.requests.payloadBytes, newMiddle.length)
    assert.ok(fixture.requests.payloadBytes < differentialPayload.length)
    assert.deepEqual(readFileSync(differentialDownload[0]), differentialPayload)

    const fallbackPayload = Buffer.concat([sharedHead, makePayload('fallback-middle', 1), sharedTail])
    fixture.seedDifferentialBase(oldPayload, oldBlockMap)
    fixture.publish({
      version: fallbackVersion,
      payload: fallbackPayload,
      blockMap: { ...makeBlockMap([sharedHead, makePayload('fallback-middle', 1), sharedTail]), version: '3' }
    })
    fixture.resetRequests()
    const fallbackUpdater = fixture.createUpdater()
    await fallbackUpdater.checkForUpdates()
    const fallbackDownload = await fallbackUpdater.downloadUpdate()
    assert.equal(fixture.requests.blockmapGets, 1)
    assert.equal(fixture.requests.rangePayloadGets, 0)
    assert.equal(fixture.requests.installerGets, 1)
    assert.equal(fixture.requests.fullPayloadGets, 1, 'blockmap 不相容時只能有一次 full fallback')
    assert.equal(fixture.requests.payloadBytes, fallbackPayload.length)
    assert.deepEqual(readFileSync(fallbackDownload[0]), fallbackPayload)
  } finally {
    await fixture.close()
    app.quit()
  }

  console.log('electron-updater 公開下載路徑 fixture：cache、重試、differential 與 full fallback 通過')
}

void run().catch((error) => {
  console.error(error)
  app.exit(1)
})
