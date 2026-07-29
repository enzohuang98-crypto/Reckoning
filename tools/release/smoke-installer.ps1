param(
  [ValidateSet('Lifecycle', 'Install', 'Uninstall')]
  [string]$Phase = 'Lifecycle',
  [switch]$AllowUnsigned,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$ExpectedSha256
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$package = Get-Content -Raw -Encoding UTF8 (Join-Path $projectRoot 'package.json') |
  ConvertFrom-Json
$version = [string]$package.version
$setup = Join-Path $projectRoot "release\xiangqi-analyzer-$version-setup.exe"
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\xiangqi-analyzer'
$mainExe = Join-Path $installDir '象棋AI分析講解.exe'
$uninstaller = Join-Path $installDir 'Uninstall 象棋AI分析講解.exe'
$appGuid = 'c3970037-5aa0-51b0-95c7-b57bf9f33552'
$installRegistry = "HKCU:\Software\$appGuid"
$uninstallRegistry =
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appGuid"
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) '象棋AI分析講解.lnk'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) '象棋AI分析講解.lnk'
$roamingData = Join-Path $env:APPDATA 'xiangqi-analyzer'
$updaterCache = Join-Path $env:LOCALAPPDATA 'xiangqi-analyzer-updater'

function Wait-Until([scriptblock]$Condition, [string]$FailureMessage) {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $FailureMessage
}

function Assert-Path([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label is missing: $Path"
  }
}

function Assert-SetupIntegrity {
  Assert-Path $setup 'Setup artifact'
  if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
    throw 'ExpectedSha256 is required for release installer testing.'
  }
  $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash
  if ($actualSha256 -ne $ExpectedSha256.ToUpperInvariant()) {
    throw "Setup SHA-256 is $actualSha256; expected $($ExpectedSha256.ToUpperInvariant())."
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $setup
  if ($AllowUnsigned) {
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
      throw "Unsigned release expected an unsigned setup, got: $($signature.Status)"
    }
  } else {
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
      throw "Setup Authenticode signature is not valid: $($signature.Status)"
    }
    if (-not $signature.TimeStamperCertificate) {
      throw 'Setup Authenticode signature has no trusted timestamp.'
    }
  }
}

function Get-LinkTarget([string]$Path) {
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.Namespace([IO.Path]::GetDirectoryName($Path))
  $item = $folder.ParseName([IO.Path]::GetFileName($Path))
  return [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
}

function Test-CleanState {
  return -not (
    (Test-Path -LiteralPath $installDir) -or
    (Test-Path $installRegistry) -or
    (Test-Path $uninstallRegistry) -or
    (Test-Path -LiteralPath $desktopLink) -or
    (Test-Path -LiteralPath $startLink) -or
    (Test-Path -LiteralPath $roamingData) -or
    (Test-Path -LiteralPath $updaterCache)
  )
}

function Invoke-InstallValidation {
  Assert-SetupIntegrity
  if (-not (Test-CleanState)) {
    throw 'Installer smoke test requires a machine without an existing Reckoning installation.'
  }

  $installProcess = Start-Process -FilePath $setup `
    -ArgumentList '/S', '/currentuser' `
    -PassThru -Wait -WindowStyle Hidden
  if ($installProcess.ExitCode -ne 0) {
    throw "Silent installer failed with exit code $($installProcess.ExitCode)."
  }

  Wait-Until { Test-Path -LiteralPath $mainExe } 'Installed application did not appear.'
  Assert-Path (Join-Path $installDir 'resources\engine\pikafish.exe') 'Bundled Pikafish'
  Assert-Path (Join-Path $installDir 'resources\engine\pikafish.nnue') 'Bundled NNUE'
  Assert-Path (Join-Path $installDir 'resources\app-update.yml') 'Updater configuration'
  Assert-Path $uninstaller 'Uninstaller'
  Assert-Path $desktopLink 'Desktop shortcut'
  Assert-Path $startLink 'Start-menu shortcut'

  $productVersion = (Get-Item -LiteralPath $mainExe).VersionInfo.ProductVersion
  if ($productVersion -notin @($version, "$version.0")) {
    throw "Installed ProductVersion is $productVersion; expected $version."
  }

  Wait-Until { (Test-Path $installRegistry) -and (Test-Path $uninstallRegistry) } `
    'Windows installation registry entries were not created.'
  $installInfo = Get-ItemProperty $installRegistry
  $uninstallInfo = Get-ItemProperty $uninstallRegistry
  if ($installInfo.InstallLocation -ne $installDir) {
    throw "InstallLocation is '$($installInfo.InstallLocation)'; expected '$installDir'."
  }
  if ($uninstallInfo.DisplayVersion -ne $version) {
    throw "DisplayVersion is '$($uninstallInfo.DisplayVersion)'; expected '$version'."
  }
  if ($uninstallInfo.UninstallString -notlike "*$uninstaller* /currentuser") {
    throw "UninstallString is not bound to the installed uninstaller: $($uninstallInfo.UninstallString)"
  }
  if ((Get-LinkTarget $desktopLink) -ne $mainExe) {
    throw 'Desktop shortcut does not target the installed executable.'
  }
  if ((Get-LinkTarget $startLink) -ne $mainExe) {
    throw 'Start-menu shortcut does not target the installed executable.'
  }

  Write-Host "Installer smoke checks passed for version $version."
}

function Invoke-UninstallValidation {
  Assert-Path $uninstaller 'Uninstaller'
  $uninstallProcess = Start-Process -FilePath $uninstaller `
    -ArgumentList '/S', '/currentuser', '--delete-app-data' `
    -PassThru -Wait -WindowStyle Hidden
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "Silent uninstaller failed with exit code $($uninstallProcess.ExitCode)."
  }

  Wait-Until { Test-CleanState } `
    'Uninstaller left files, registry entries, shortcuts, AppData, or updater cache behind.'
  Write-Host 'Silent uninstall cleanup passed.'
}

if ($Phase -eq 'Install') {
  Invoke-InstallValidation
  exit 0
}

if ($Phase -eq 'Uninstall') {
  Invoke-UninstallValidation
  exit 0
}

# NSIS may keep its install process mutex alive until the PowerShell process that
# launched setup exits. Run install verification and uninstall verification in
# separate child processes so the smoke test matches two real user sessions.
$powerShellExe = (Get-Process -Id $PID).Path
& $powerShellExe -NoProfile -ExecutionPolicy Bypass `
  -File $PSCommandPath -Phase Install -AllowUnsigned:$AllowUnsigned -ExpectedSha256 $ExpectedSha256
$installExitCode = $LASTEXITCODE

$uninstallExitCode = 0
if (-not (Test-CleanState)) {
  & $powerShellExe -NoProfile -ExecutionPolicy Bypass `
    -File $PSCommandPath -Phase Uninstall -AllowUnsigned:$AllowUnsigned -ExpectedSha256 $ExpectedSha256
  $uninstallExitCode = $LASTEXITCODE
}

if ($installExitCode -ne 0) {
  throw "Installer verification phase failed with exit code $installExitCode."
}
if ($uninstallExitCode -ne 0) {
  throw "Uninstaller verification phase failed with exit code $uninstallExitCode."
}
if (-not (Test-CleanState)) {
  throw 'Installer lifecycle smoke test did not return the machine to a clean state.'
}
