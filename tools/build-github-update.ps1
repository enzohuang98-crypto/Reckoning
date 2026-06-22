$ErrorActionPreference = 'Stop'

$updateUrl = 'https://raw.githubusercontent.com/enzohuang98-crypto/xiangqi-analyzer-site/main/downloads/'
$env:XQA_UPDATE_URL = $updateUrl

Write-Host "Building auto-update package for $updateUrl"
npm.cmd run dist:update

Write-Host ''
Write-Host 'Auto-update artifacts are in release/:'
Get-ChildItem -LiteralPath 'release' -Filter 'latest.yml' | Select-Object FullName, Length, LastWriteTime
Get-ChildItem -LiteralPath 'release' -Filter 'xiangqi-analyzer-*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 FullName, Length, LastWriteTime
Get-ChildItem -LiteralPath 'release' -Filter 'xiangqi-analyzer-*-setup.exe.blockmap' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 FullName, Length, LastWriteTime
