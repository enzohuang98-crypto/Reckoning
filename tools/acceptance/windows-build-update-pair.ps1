param()
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Unpublished test package builds require the ephemeral GitHub-hosted runner.'
}
$source = Get-Content -Raw -Encoding UTF8 electron-builder.yml
$packageSource = Get-Content -Raw -Encoding UTF8 package.json
$lockSource = Get-Content -Raw -Encoding UTF8 package-lock.json
if ($source -notmatch '(?m)^forceCodeSigning:\s*true\s*$') { throw 'Source must retain forceCodeSigning: true.' }
$version = [string]($packageSource | ConvertFrom-Json).version
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw 'A stable patch version is required.' }
$candidateVersion = "$($Matches[1]).$($Matches[2]).$([int]$Matches[3] + 1)"
$sourceCommit = (git rev-parse HEAD).Trim()
if ($env:GITHUB_RUN_ID -notmatch '^[1-9][0-9]{0,19}$') { throw 'Invalid isolated run identity.' }

function Write-PackageManifest([string]$Directory, [string]$PackageVersion, [string]$Role) {
  $files = @("xiangqi-analyzer-$PackageVersion-setup.exe", "xiangqi-analyzer-$PackageVersion-setup.exe.blockmap", 'latest.yml')
  $artifacts = foreach ($file in $files) {
    $item = Get-Item -LiteralPath (Join-Path $Directory $file)
    if ($item.Length -le 0) { throw "Empty artifact: $file" }
    @{ name = $file; size = $item.Length; sha256 = (Get-FileHash $item.FullName -Algorithm SHA256).Hash }
  }
  $signature = Get-AuthenticodeSignature (Join-Path $Directory $files[0])
  if ($signature.Status -ne 'NotSigned') { throw 'Expected explicitly unsigned test installer.' }
  @{
    sourceCommit = $sourceCommit; version = $PackageVersion; role = $Role
    runId = $env:GITHUB_RUN_ID; artifacts = @($artifacts)
    signature = [string]$signature.Status; productionRelease = $false
    probeRunId = $env:GITHUB_RUN_ID
    differences = @('Generic loopback updater feed http://127.0.0.1:18765/; never published',
      'Compile-time isolated UI prepare control, metadata observations and one-shot real-save acknowledgement barrier') +
      $(if ($Role -eq 'test-candidate') { @('Unpublished next-patch identity; one-shot real NSIS customInit exit 73 fault, armed only in the VM') } else { @() })
  } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $Directory 'isolated-package-manifest.json')
}

try {
  # Existing explicit unsigned workflow exception; production source is restored.
  # The production config stays signed. Only this unpublished config overrides it.
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Ordinary application build failed.' }
  npx.cmd --no-install tsx --tsconfig tsconfig.node.json tools/acceptance/isolated-build-policy.self-test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Isolated build boundary verification failed.' }
  node tools/acceptance/verify-no-updater-hooks.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Ordinary bundle contains isolated updater hooks.' }
  @'
module.exports = {
  extends: './electron-builder.yml',
  forceCodeSigning: false,
  publish: [{ provider: 'generic', url: 'http://127.0.0.1:18765/' }]
}
'@ | Set-Content -Encoding utf8 electron-builder.isolated.cjs
  npm.cmd run build -- --mode isolated-updater-acceptance
  if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
  npx.cmd --no-install electron-builder --win nsis --x64 --config electron-builder.isolated.cjs --publish never
  if ($LASTEXITCODE -ne 0) { throw 'Predecessor installer build failed.' }
  Write-PackageManifest 'release' $version 'predecessor'

  # Only this ephemeral build's package identity changes. Both contain the new
  # updater and exactly the same compiled application source; neither is released.
  $package = $packageSource | ConvertFrom-Json
  $package.version = $candidateVersion
  $package | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 package.json
  # npm's root package record has an empty property name; a hashtable preserves it.
  $lock = $lockSource | ConvertFrom-Json -AsHashtable
  $lock['version'] = $candidateVersion
  $lock['packages']['']['version'] = $candidateVersion
  $lock | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 package-lock.json
  # Rebuild after changing identity so compile-time package version imports,
  # should any be added, cannot leave the candidate UI claiming the predecessor.
  npm.cmd run build -- --mode isolated-updater-acceptance
  if ($LASTEXITCODE -ne 0) { throw 'Candidate application build failed.' }
  $productionInclude = (Resolve-Path resources/packaging/custom-installer.nsh).Path
  $faultInclude = (Resolve-Path tools/acceptance/isolated-updater-fault.nsh).Path
  @"
!define RECKONING_PROBE_RUN_ID "$($env:GITHUB_RUN_ID)"
!include "$productionInclude"
!include "$faultInclude"
"@ | Set-Content -Encoding utf8 electron-builder.isolated.nsh
  @'
module.exports = {
  extends: './electron-builder.yml',
  forceCodeSigning: false,
  nsis: { include: require('path').resolve('electron-builder.isolated.nsh') },
  directories: { output: 'release/update-candidate' },
  publish: [{ provider: 'generic', url: 'http://127.0.0.1:18765/' }]
}
'@ | Set-Content -Encoding utf8 electron-builder.isolated.cjs
  npx.cmd --no-install electron-builder --win nsis --x64 --config electron-builder.isolated.cjs --publish never
  if ($LASTEXITCODE -ne 0) { throw 'Unpublished candidate installer build failed.' }
  Write-PackageManifest 'release/update-candidate' $candidateVersion 'test-candidate'
} finally {
  Set-Content -NoNewline -Encoding utf8 package.json $packageSource
  Set-Content -NoNewline -Encoding utf8 package-lock.json $lockSource
}
