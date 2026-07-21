param(
  [string]$Tag
)

$ErrorActionPreference = 'Stop'

$githubRepository = 'enzohuang98-crypto/Reckoning'
$package = Get-Content -Raw -Encoding UTF8 'package.json' | ConvertFrom-Json
$version = [string]$package.version
$expectedTag = "v$version"
if ([string]::IsNullOrWhiteSpace($Tag)) {
  $Tag = $expectedTag
}
if ($Tag -ne $expectedTag) {
  throw "Release tag '$Tag' does not match package version '$expectedTag'."
}

$releaseDir = Resolve-Path -LiteralPath 'release'
$setup = Join-Path $releaseDir "xiangqi-analyzer-$version-setup.exe"
$blockmap = "$setup.blockmap"
$latest = Join-Path $releaseDir 'latest.yml'

& (Join-Path $PSScriptRoot 'verify-update-artifacts.ps1') -ExpectedVersion $version

gh auth status
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub CLI is not authenticated.'
}
gh release view $Tag --repo $githubRepository | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub Release $Tag does not exist in $githubRepository."
}

gh release upload $Tag $setup $blockmap $latest --repo $githubRepository --clobber
if ($LASTEXITCODE -ne 0) {
  throw "Unable to upload update artifacts to GitHub Release $Tag (exit code $LASTEXITCODE)."
}

Write-Host "Published update artifacts to https://github.com/$githubRepository/releases/tag/$Tag"
