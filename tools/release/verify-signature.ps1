param(
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  $ExpectedVersion = [string](Get-Content -Raw -Encoding UTF8 'package.json' | ConvertFrom-Json).version
}

$setup = "release/xiangqi-analyzer-$ExpectedVersion-setup.exe"
if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) {
  throw "Setup artifact is missing: $setup"
}

$signature = Get-AuthenticodeSignature -LiteralPath $setup
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
  throw "Setup Authenticode signature is not valid: $($signature.Status) $($signature.StatusMessage)"
}
if (-not $signature.TimeStamperCertificate) {
  throw 'Setup Authenticode signature has no trusted timestamp.'
}

Write-Host "Authenticode signature is valid: $($signature.SignerCertificate.Subject)"
Write-Host "Trusted timestamp: $($signature.TimeStamperCertificate.Subject)"
