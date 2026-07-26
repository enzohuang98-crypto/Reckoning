$ErrorActionPreference = 'Stop'

$githubOwner = 'enzohuang98-crypto'
$githubRepo = 'Reckoning'

Write-Host "Building auto-update package for GitHub Releases: $githubOwner/$githubRepo"
$buildStartedUtc = [DateTime]::UtcNow
npm.cmd run dist:update
if ($LASTEXITCODE -ne 0) {
  throw "npm.cmd run dist:update failed with exit code $LASTEXITCODE."
}

$version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
$builtArtifacts = @(
  Join-Path 'release' 'latest.yml'
  Join-Path 'release' "xiangqi-analyzer-$version-setup.exe"
  Join-Path 'release' "xiangqi-analyzer-$version-setup.exe.blockmap"
)

foreach ($path in $builtArtifacts) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing auto-update artifact: $path"
  }
  $item = Get-Item -LiteralPath $path
  if ($item.Length -le 0 -or $item.LastWriteTimeUtc -lt $buildStartedUtc.AddSeconds(-2)) {
    throw "Auto-update artifact was not freshly built: $path"
  }
}

$setupPath = $builtArtifacts[1]
$setupSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupPath).Hash
$shaManifest = Join-Path 'release' 'SHA256SUMS.txt'
Set-Content -Encoding ASCII -LiteralPath $shaManifest `
  -Value "$setupSha256  $([IO.Path]::GetFileName($setupPath))"
$artifacts = @($builtArtifacts) + $shaManifest

$appUpdate = Join-Path 'release' 'win-unpacked\resources\app-update.yml'
if (-not (Test-Path -LiteralPath $appUpdate -PathType Leaf)) {
  throw "Missing packaged updater configuration: $appUpdate"
}
$appUpdateText = Get-Content -Raw -Encoding UTF8 -LiteralPath $appUpdate
if (
  $appUpdateText -notmatch '(?m)^provider:\s*github\s*$' -or
  $appUpdateText -notmatch "(?m)^owner:\s*$([regex]::Escape($githubOwner))\s*$" -or
  $appUpdateText -notmatch "(?m)^repo:\s*$([regex]::Escape($githubRepo))\s*$"
) {
  throw "Packaged updater configuration does not match GitHub Releases repository $githubOwner/$githubRepo."
}

& (Join-Path $PSScriptRoot 'verify-update-artifacts.ps1') -ExpectedVersion $version

Write-Host ''
Write-Host 'Auto-update artifacts are in release/:'
Get-Item -LiteralPath $artifacts | Select-Object FullName, Length, LastWriteTime
