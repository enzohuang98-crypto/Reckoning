const rawUrl = process.env.XQA_UPDATE_URL?.trim()

if (!rawUrl) {
  throw new Error('XQA_UPDATE_URL is required to build an auto-update release.')
}

const updateUrl = new URL(rawUrl)
if (
  updateUrl.protocol !== 'https:' ||
  updateUrl.username ||
  updateUrl.password ||
  (updateUrl.port && updateUrl.port !== '443')
) {
  throw new Error('XQA_UPDATE_URL must be a credential-free HTTPS URL on port 443.')
}

module.exports = {
  extends: './electron-builder.yml',
  publish: [
    {
      provider: 'generic',
      url: updateUrl.toString()
    }
  ]
}
