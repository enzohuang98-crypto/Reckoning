module.exports = {
  extends: './electron-builder.yml',
  publish: [
    {
      provider: 'github',
      owner: 'enzohuang98-crypto',
      repo: 'Reckoning',
      releaseType: 'release'
    }
  ]
}
