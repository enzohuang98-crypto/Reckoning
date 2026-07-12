$ErrorActionPreference = 'Stop'

$repoUrl = 'https://github.com/enzohuang98-crypto/xiangqi-analyzer-site.git'
$branch = 'main'
$updatePath = 'downloads'
$package = Get-Content -Raw -Encoding UTF8 'package.json' | ConvertFrom-Json
$version = [string]$package.version
$releaseDir = Resolve-Path -LiteralPath 'release'
$setup = Join-Path $releaseDir "xiangqi-analyzer-$version-setup.exe"
$blockmap = "$setup.blockmap"
$latest = Join-Path $releaseDir 'latest.yml'

foreach ($path in @($setup, $blockmap, $latest)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing update artifact: $path"
  }
}

& (Join-Path $PSScriptRoot 'verify-update-artifacts.ps1') -ExpectedVersion $version

$tempRoot = [IO.Path]::GetTempPath()
$publishDir = Join-Path $tempRoot 'xiangqi-analyzer-auto-update'
$resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
$resolvedPublishDir = [IO.Path]::GetFullPath($publishDir)
if (-not $resolvedPublishDir.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean unexpected path: $resolvedPublishDir"
}
if (Test-Path -LiteralPath $publishDir) {
  Remove-Item -LiteralPath $publishDir -Recurse -Force
}
git clone --depth 1 --branch $branch $repoUrl $publishDir
if ($LASTEXITCODE -ne 0) {
  throw "Unable to clone update repository (exit code $LASTEXITCODE)."
}

$downloadDir = Join-Path $publishDir $updatePath
$resolvedDownloadDir = [IO.Path]::GetFullPath($downloadDir)
if (-not $resolvedDownloadDir.StartsWith($resolvedPublishDir, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to update unexpected path: $resolvedDownloadDir"
}
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

$publishedLatest = Join-Path $downloadDir 'latest.yml'
if (Test-Path -LiteralPath $publishedLatest) {
  Remove-Item -LiteralPath $publishedLatest -Force
}

Copy-Item -LiteralPath $setup -Destination (Join-Path $downloadDir (Split-Path $setup -Leaf)) -Force
Copy-Item -LiteralPath $blockmap -Destination (Join-Path $downloadDir (Split-Path $blockmap -Leaf)) -Force
Copy-Item -LiteralPath $latest -Destination $publishedLatest -Force

Push-Location $publishDir
try {
  git config user.name "xiangqi-analyzer-release"
  git config user.email "release@xiangqi-analyzer.local"
  git add $updatePath
  git diff --cached --quiet
  $diffExitCode = $LASTEXITCODE
  if ($diffExitCode -eq 0) {
    Write-Host "No update artifact changes to publish."
  } elseif ($diffExitCode -eq 1) {
    git commit -m "release xiangqi analyzer $version update artifacts"
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to commit update artifacts (exit code $LASTEXITCODE)."
    }
    git push origin $branch
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to push update artifacts (exit code $LASTEXITCODE)."
    }
  } else {
    throw "Unable to inspect staged update artifacts (exit code $diffExitCode)."
  }
} finally {
  Pop-Location
}

Write-Host "Published update channel for version $version"
Write-Host "latest.yml: https://raw.githubusercontent.com/enzohuang98-crypto/xiangqi-analyzer-site/main/downloads/latest.yml"
