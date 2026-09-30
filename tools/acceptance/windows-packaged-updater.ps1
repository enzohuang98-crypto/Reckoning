param([Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Only an ephemeral GitHub-hosted VM may run this updater exercise.' }
$os = Get-CimInstance Win32_OperatingSystem
if ([int]$os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000) { throw 'A Windows 11 client VM is required.' }
$script:probeExe = Join-Path $env:LOCALAPPDATA 'Programs\xiangqi-analyzer\象棋AI分析講解.exe'
$script:probeOutputPath = $OutputPath
$report = [ordered]@{
  sourceCommit = (git rev-parse HEAD).Trim(); runId = $env:GITHUB_RUN_ID
  capturedAtUtc = [DateTime]::UtcNow.ToString('o'); os = [string]$os.Caption
  nativeArchitecture = $env:PROCESSOR_ARCHITECTURE
  differences = @('ARM64 Windows 11 client with x64 emulation', 'Unpublished test versions with generic loopback feed; not final Release assets')
  formalCandidateAcceptance = 'not_run'; providerAcceptance = 'not_run'; signature = 'NotSigned'
  unsignedSmartScreenLimitation = 'Unsigned test packages; SmartScreen trust is not established.'
  downloadFailureRecovery = 'not_run'; backgroundUsable = 'not_run'; noAutoQuit = 'not_run'
  cacheCorruptionRecovery = 'not_run'; validCacheReopen = 'not_run'
  draftBlocksRestart = 'not_run'; savedDataPreserved = 'not_run'; normalInstallationRestart = 'not_run'
  installPayloadBytes = $null; installFailureRetry = 'not_run'; earlyPrepareRecovery = 'not_run'
  draftAddedDuringSave = 'not_run'; observations = @(); screenshots = @()
  uiActions = @(); finalControlDiagnostics = @()
}
$server = $null
function Set-FeedPhase([string]$Phase, [string]$Mode) {
  $body = @{ phase = $Phase; mode = $Mode } | ConvertTo-Json -Compress
  [void](Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:18765/__probe/control' -ContentType 'application/json' -Body $body -TimeoutSec 5)
}
function Read-Feed { return Invoke-RestMethod -Uri 'http://127.0.0.1:18765/__probe/status' -TimeoutSec 5 }
function Record-Probe([string]$Stage) {
  $names = Get-ProbeNames
  $report.observations += @{
    stage = $Stage; at = [DateTime]::UtcNow.ToString('o')
    controls = @($names | Where-Object { $_ -match '更新|版本|資料|儲存|保存|猜著|草稿|分析|設定|Pikafish' } | Select-Object -Unique -First 80)
    network = (Read-Feed).phases
  }
  $report.screenshots += Save-ProbeScreen $Stage
}
function Assert-Prepared {
  [void](Wait-Probe { Find-ProbeAction '重新啟動完成更新' } 'Actual App did not finish preparing the update.' 240)
  Assert-ProbeForeground
}
function Get-ValidatedPendingInstaller([string]$ExpectedHash) {
  $pendingRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'xiangqi-analyzer-updater\pending'))
  $info = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $pendingRoot 'update-info.json') | ConvertFrom-Json
  if ([IO.Path]::GetFileName([string]$info.fileName) -cne [string]$info.fileName) { throw 'Unsafe updater cache filename.' }
  $path = [IO.Path]::GetFullPath((Join-Path $pendingRoot $info.fileName))
  if (-not $path.StartsWith($pendingRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cache path escapes this isolated pending directory.' }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'Prepared installer cache does not match candidate SHA-256.' }
  return $path
}
try {
  $predecessor = Get-Content -Raw -Encoding UTF8 release/isolated-package-manifest.json | ConvertFrom-Json
  $candidate = Get-Content -Raw -Encoding UTF8 release/update-candidate/isolated-package-manifest.json | ConvertFrom-Json
  if ($predecessor.sourceCommit -ne $report.sourceCommit -or $candidate.sourceCommit -ne $report.sourceCommit -or
      $predecessor.role -ne 'predecessor' -or $candidate.role -ne 'test-candidate' -or
      $predecessor.productionRelease -ne $false -or $candidate.productionRelease -ne $false -or
      $predecessor.signature -ne 'NotSigned' -or $candidate.signature -ne 'NotSigned') { throw 'Unpublished package provenance mismatch.' }
  if ([version]$candidate.version -le [version]$predecessor.version) { throw 'Updater exercise requires a newer real package identity.' }
  if ((Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion -notin @($predecessor.version, "$($predecessor.version).0")) { throw 'Installed predecessor version mismatch.' }
  $feed = Get-Content -Raw -LiteralPath (Join-Path (Split-Path $script:probeExe) 'resources\app-update.yml')
  if ($feed -notmatch '(?m)^provider:\s*generic\s*$' -or $feed -notmatch 'http://127\.0\.0\.1:18765/') { throw 'Installed updater is not isolated from production.' }
  $report.predecessorVersion = $predecessor.version
  $report.candidateVersion = $candidate.version
  $setupEntry = @($candidate.artifacts | Where-Object { $_.name -ceq "xiangqi-analyzer-$($candidate.version)-setup.exe" })
  if ($setupEntry.Count -ne 1) { throw 'Candidate manifest lacks a unique actual installer.' }
  $report.candidateInstallerSha256 = $setupEntry[0].sha256
  $report.installedPath = $script:probeExe
  . "$PSScriptRoot/windows-packaged-ui.ps1"
  $serverEvidence = [IO.Path]::ChangeExtension($OutputPath, $null) + '-network.json'
  $node = (Get-Command node.exe).Source
  $feedScript = Join-Path $PSScriptRoot 'windows-update-feed.cjs'
  $candidateDirectory = (Resolve-Path release/update-candidate).Path
  # This background helper is deliberately hidden; the App under test is visible.
  $serverArguments = @(('"' + $feedScript + '"'), ('"' + $candidateDirectory + '"'), ('"' + $serverEvidence + '"'))
  $serverOut = [IO.Path]::ChangeExtension($OutputPath, $null) + '-feed-output.log'
  $serverError = [IO.Path]::ChangeExtension($OutputPath, $null) + '-feed-error.log'
  $report.feedOutputLog = [IO.Path]::GetFileName($serverOut)
  $report.feedErrorLog = [IO.Path]::GetFileName($serverError)
  $server = Start-Process -FilePath $node -ArgumentList $serverArguments -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverError -PassThru
  [void](Wait-Probe { try { Read-Feed } catch { $false } } 'Isolated instrumented update server did not start.' 15)
  Start-ProbeApplication
  # Create real persisted test data through the application UI, not AppData edits.
  Invoke-ProbeAction '局面工具'
  Invoke-ProbeAction '擺棋與保存局面' -Prefix
  $marker = "Isolated updater data $($env:GITHUB_RUN_ID)"
  Set-ProbeInput '局面名稱（選填）' $marker
  Invoke-ProbeAction '保存'
  [void](Wait-Probe { Find-ProbeAction $marker } 'Saved test position did not appear through the real UI.')
  $dataPath = Join-Path $env:APPDATA 'xiangqi-analyzer\app-data.json'
  [void](Wait-Probe { (Test-Path -LiteralPath $dataPath) -and (Get-Content -Raw -LiteralPath $dataPath).Contains($marker) } 'Actual saved position was not persisted.')
  $report.testDataMarker = $marker
  $report.savedDataSha256Before = (Get-FileHash -LiteralPath $dataPath -Algorithm SHA256).Hash

  # Controlled HTTP failures apply to the actual installer, not a fake provider.
  Set-FeedPhase 'download-failure' 'fail-payload'
  Open-ProbeSystemSettings
  Assert-ProbeUiVersion $predecessor.version 'Packaged predecessor'
  $report.predecessorUiVersion = $predecessor.version
  Invoke-ProbeAction '立即檢查'
  [void](Wait-Probe { (Get-ProbeNames -join ' ') -match '更新下載失敗|更新失敗' } 'Controlled installer download failure was not surfaced by App.' 120)
  $failureNetwork = Read-Feed
  if (-not @($failureNetwork.requests | Where-Object { $_.kind -eq 'installer' -and $_.status -eq 503 }).Count) { throw 'No real controlled installer HTTP failure was recorded.' }
  Record-Probe 'download-failure'
  Set-FeedPhase 'background-recovery' 'throttled'
  Invoke-ProbeAction '立即檢查'
  [void](Wait-Probe { (Read-Feed).phases.'background-recovery'.installerBytes -gt 0 } 'Installer download never began.' 90)
  $backgroundProcessId = (Get-ProbeWindow).Current.ProcessId
  Invoke-ProbeAction '分析'
  Invoke-ProbeAction '猜著'
  Set-ProbeInput '你選這一步的原因' 'Background download remains usable'
  if ((Get-ProbeNames -join ' ') -notmatch '下载更新\s*\d+%|正在背景準備更新') { throw 'The usable App input was not exercised during an in-progress download.' }
  $report.backgroundUsable = 'passed'
  Set-ProbeInput '你選這一步的原因' ''
  Open-ProbeSystemSettings
  Assert-Prepared
  if ((Get-ProbeWindow).Current.ProcessId -ne $backgroundProcessId) { throw 'App exited or relaunched during background preparation.' }
  $report.downloadFailureRecovery = 'passed'
  $report.noAutoQuit = 'passed'
  $cachedInstaller = Get-ValidatedPendingInstaller $report.candidateInstallerSha256
  $report.cachedInstallerPath = $cachedInstaller
  Record-Probe 'prepared'

  # Corrupt only the proven ephemeral cache, then exercise normal revalidation.
  Close-ProbeApplication
  $stream = [IO.File]::Open($cachedInstaller, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write((New-Object byte[] 16), 0, 16) } finally { $stream.Dispose() }
  if ((Get-FileHash -LiteralPath $cachedInstaller -Algorithm SHA256).Hash -eq $report.candidateInstallerSha256) { throw 'Cache corruption test did not alter the cached installer.' }
  Set-FeedPhase 'cache-corruption-recovery' 'healthy'
  Start-ProbeApplication
  Open-ProbeSystemSettings
  Assert-Prepared
  $cachedInstaller = Get-ValidatedPendingInstaller $report.candidateInstallerSha256
  if ((Read-Feed).phases.'cache-corruption-recovery'.installerBytes -le 0) { throw 'Corrupt cache was not replaced through real network transfer.' }
  $report.cacheCorruptionRecovery = 'passed'
  Record-Probe 'cache-recovered'

  Close-ProbeApplication
  Set-FeedPhase 'valid-cache-reopen' 'healthy'
  Start-ProbeApplication
  Open-ProbeSystemSettings
  Assert-Prepared
  [void](Get-ValidatedPendingInstaller $report.candidateInstallerSha256)
  $cacheNetwork = Read-Feed
  if ($cacheNetwork.phases.'valid-cache-reopen'.installerBytes -gt 0 -or $cacheNetwork.phases.'valid-cache-reopen'.installerRequests -gt 0) { throw 'Valid same-version cache was downloaded again after reopening.' }
  if ($cacheNetwork.phases.'valid-cache-reopen'.metadataBytes -le 0) { throw 'Cache acceptance lacked a fresh actual metadata check.' }
  $report.validCacheReopen = 'passed'
  Record-Probe 'valid-cache-reopen'

  Invoke-ProbeAction '分析'
  Invoke-ProbeAction '猜著'
  Set-ProbeInput '你選這一步的原因' 'Do not discard this unsubmitted draft'
  Open-ProbeSystemSettings
  Set-FeedPhase 'draft-blocked' 'healthy'
  Invoke-ProbeAction '重新啟動完成更新'
  Confirm-ProbeRestart
  [void](Wait-Probe { (Get-ProbeNames -join ' ') -match '仍有尚未提交的著法或理由' } 'Unsubmitted draft did not block restart installation.' 15)
  if ((Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion -notin @($predecessor.version, "$($predecessor.version).0")) { throw 'Draft-blocked App version changed.' }
  $report.draftBlocksRestart = 'passed'
  Record-Probe 'draft-blocked'
  Invoke-ProbeAction '分析'
  Set-ProbeInput '你選這一步的原因' ''
  Open-ProbeSystemSettings

  Set-FeedPhase 'install' 'healthy'
  Invoke-ProbeAction '重新啟動完成更新'
  Confirm-ProbeRestart
  [void](Wait-Probe {
    try { (Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion -in @($candidate.version, "$($candidate.version).0") } catch { $false }
  } 'Normal updater did not install the expected candidate version.' 180)
  Start-ProbeApplication
  if ((Get-FileHash -LiteralPath $dataPath -Algorithm SHA256).Hash -ne $report.savedDataSha256Before) { throw 'Actual saved application data changed during install.' }
  $report.savedDataPreserved = 'passed'
  $report.finalInstalledVersion = (Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion
  Open-ProbeSystemSettings
  Assert-ProbeUiVersion $candidate.version 'Updated packaged candidate'
  $report.candidateUiVersion = $candidate.version
  Invoke-ProbeAction '分析'
  $shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) '象棋AI分析講解.lnk'
  $shell = New-Object -ComObject WScript.Shell
  if ($shell.CreateShortcut($shortcut).TargetPath -ne $script:probeExe) { throw 'Updated desktop shortcut points at a different executable.' }
  $report.desktopShortcutTarget = $script:probeExe
  $installNetwork = Read-Feed
  $installPhase = $installNetwork.phases.install
  $report.installPayloadBytes = if ($installPhase) { [long]$installPhase.installerBytes } else { 0 }
  $report.installPayloadRequests = if ($installPhase) { [long]$installPhase.installerRequests } else { 0 }
  if ($report.installPayloadBytes -ne 0 -or $report.installPayloadRequests -ne 0) { throw 'Restart/install phase requested installer payload again.' }
  $report.normalInstallationRestart = 'passed'
  Record-Probe 'updated-workspace'
  $report.result = 'partial'
  $report.remainingPackagedGates = @('Installer failure retry without UAC/elevation injection', 'Early prepare not exposed as a UI action before version discovery', 'A draft added during asynchronous save needs a deterministic actual UI race exercise')
} catch {
  $report.result = 'failed'
  $report.failure = $_.Exception.Message
  throw
} finally {
  $report.uiActions = @($script:probeUiActions)
  try {
    $report.finalControlDiagnostics = @(Get-ProbeControls | Where-Object {
      $_.Current.ControlType -in @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::MenuItem, [System.Windows.Automation.ControlType]::Edit)
    } | Select-Object -First 80 | ForEach-Object { Get-ProbeControlDiagnostic $_ })
  } catch { $report.controlDiagnosticFailure = $_.Exception.Message }
  try { $report.screenshots += Save-ProbeScreen 'final' } catch { $report.screenshotFailure = $_.Exception.Message }
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  # App closes normally; installer is never called directly by this exercise.
  try { Close-ProbeApplication } catch { }
}
