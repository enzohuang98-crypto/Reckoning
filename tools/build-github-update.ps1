$ErrorActionPreference = 'Stop'

$updateUrl = 'https://raw.githubusercontent.com/enzohuang98-crypto/xiangqi-analyzer-site/main/downloads/'
$env:XQA_UPDATE_URL = $updateUrl

Write-Host "Building auto-update package for $updateUrl"
$buildStartedUtc = [DateTime]::UtcNow
npm.cmd run dist:update
if ($LASTEXITCODE -ne 0) {
  throw "npm.cmd run dist:update failed with exit code $LASTEXITCODE."
}

$version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
$artifacts = @(
  Join-Path 'release' 'latest.yml'
  Join-Path 'release' "xiangqi-analyzer-$version-setup.exe"
  Join-Path 'release' "xiangqi-analyzer-$version-setup.exe.blockmap"
)

foreach ($path in $artifacts) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing auto-update artifact: $path"
  }
  $item = Get-Item -LiteralPath $path
  if ($item.Length -le 0 -or $item.LastWriteTimeUtc -lt $buildStartedUtc.AddSeconds(-2)) {
    throw "Auto-update artifact was not freshly built: $path"
  }
}

Write-Host ''
Write-Host 'Auto-update artifacts are in release/:'
Get-Item -LiteralPath $artifacts | Select-Object FullName, Length, LastWriteTime
