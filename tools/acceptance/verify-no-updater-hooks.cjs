const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)])
}
const built = files('out').filter(file => /\.(?:js|cjs|mjs|html)$/.test(file))
assert(built.some(file => /[\\/]main[\\/]/.test(file)))
assert(built.some(file => /[\\/]preload[\\/]/.test(file)))
assert(built.some(file => /[\\/]renderer[\\/]/.test(file)))
for (const file of built) assert.doesNotMatch(readFileSync(file, 'utf8'),
  /isolated-updater-probe:record|reckoning-updater-probe-|save-arm|save-entered|Test: prepare before discovery/,
  `Ordinary bundle must not contain updater instrumentation: ${file}`)
console.log('Ordinary main/preload/renderer bundles contain no updater acceptance hooks.')
