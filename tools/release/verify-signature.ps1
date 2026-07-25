param(
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $ExpectedVersion = [string](Get-Content -Raw -Encoding UTF8 'package.json' | ConvertFrom-Json).version
}

$setup = "release/xiangqi-analyzer-$ExpectedVersion-setup.exe"
$hasSigningCertificate = -not [string]::IsNullOrWhiteSpace($env:CSC_LINK)

$kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$signtool = Get-ChildItem -LiteralPath $kitsRoot -Recurse -Filter signtool.exe |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $signtool) {
  throw "Windows SDK signtool.exe was not found under $kitsRoot."
}

$verifyOutput = @(& $signtool.FullName verify /pa $setup 2>&1)
$verifyExitCode = $LASTEXITCODE
$verifyText = $verifyOutput -join "`n"

if ($hasSigningCertificate -and $verifyExitCode -ne 0) {
  throw "Signed release verification failed: $verifyText"
}
if (-not $hasSigningCertificate) {
  if ($verifyExitCode -eq 0) {
    throw 'Release was signed even though no signing certificate was configured.'
  }
  if ($verifyText -notmatch 'No signature found') {
    throw "Unexpected unsigned release verification failure: $verifyText"
  }
  Write-Host 'Authenticode status: NotSigned (explicitly allowed for this release).'
} else {
  Write-Host 'Authenticode status: Valid.'
}

# An accepted unsigned verification intentionally returns signtool exit code 1.
# Reset it so the calling workflow step does not report failure after the policy
# checks above already passed.
$global:LASTEXITCODE = 0
