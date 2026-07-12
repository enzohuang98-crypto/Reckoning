param(
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $ExpectedVersion = [string](Get-Content -Raw -Encoding UTF8 'package.json' | ConvertFrom-Json).version
}

$releaseDir = Resolve-Path -LiteralPath 'release'
$setupName = "xiangqi-analyzer-$ExpectedVersion-setup.exe"
$setup = Join-Path $releaseDir $setupName
$blockmap = "$setup.blockmap"
$latest = Join-Path $releaseDir 'latest.yml'

foreach ($path in @($setup, $blockmap, $latest)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing update artifact: $path"
  }
  if ((Get-Item -LiteralPath $path).Length -le 0) {
    throw "Update artifact is empty: $path"
  }
}

$metadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $latest
$versionMatch = [regex]::Match($metadata, '(?m)^version:\s*["'']?([^\r\n"'']+)')
if (-not $versionMatch.Success -or $versionMatch.Groups[1].Value.Trim() -ne $ExpectedVersion) {
  throw "latest.yml version does not match $ExpectedVersion."
}

$pathMatch = [regex]::Match($metadata, '(?m)^path:\s*["'']?([^\r\n"'']+)')
if (-not $pathMatch.Success -or $pathMatch.Groups[1].Value.Trim() -ne $setupName) {
  throw "latest.yml path does not match $setupName."
}

$hashAlgorithm = [Security.Cryptography.SHA512]::Create()
$stream = [IO.File]::OpenRead($setup)
try {
  $expectedSha512 = [Convert]::ToBase64String($hashAlgorithm.ComputeHash($stream))
} finally {
  $stream.Dispose()
  $hashAlgorithm.Dispose()
}

$publishedHashes = @(
  [regex]::Matches($metadata, '(?m)^\s*sha512:\s*["'']?([^\r\n"'']+)') |
    ForEach-Object { $_.Groups[1].Value.Trim() }
)
if ($publishedHashes.Count -eq 0 -or $expectedSha512 -notin $publishedHashes) {
  throw 'latest.yml SHA-512 does not match the setup executable.'
}

Write-Host "Verified update artifacts for version $ExpectedVersion"
Write-Host "Setup: $setupName"
Write-Host "Authenticode: $((Get-AuthenticodeSignature -LiteralPath $setup).Status)"
