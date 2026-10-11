param([Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Only an ephemeral GitHub-hosted VM may run this updater exercise.' }
$os = Get-CimInstance Win32_OperatingSystem
if ([int]$os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000) { throw 'A Windows 11 client VM is required.' }
$script:probeExe = Join-Path $env:LOCALAPPDATA 'Programs\xiangqi-analyzer\象棋AI分析講解.exe'
$script:probeOutputPath = $OutputPath
$mode = if ($env:ACCEPTANCE_MODE) { $env:ACCEPTANCE_MODE } else { 'test-pair' }
if ($mode -notin @('test-pair', 'exact-candidate')) { throw 'Unknown acceptance mode.' }
$exactMode = $mode -eq 'exact-candidate'
$report = [ordered]@{
  sourceCommit = (git rev-parse HEAD).Trim(); runId = $env:GITHUB_RUN_ID
  harnessCommit = (git rev-parse HEAD).Trim(); mode = $mode
  capturedAtUtc = [DateTime]::UtcNow.ToString('o'); os = [string]$os.Caption
  osProductType = [int]$os.ProductType; osBuild = [string]$os.BuildNumber
  nativeArchitecture = $env:PROCESSOR_ARCHITECTURE
  differences = @('ARM64 Windows 11 client with x64 emulation', 'Unpublished test versions with generic loopback feed; not final Release assets')
  formalCandidateAcceptance = 'not_run'; providerAcceptance = 'not_run'; signature = 'NotSigned'
  unsignedSmartScreenLimitation = 'Unsigned test packages; SmartScreen trust is not established.'
  downloadFailureRecovery = 'not_run'; backgroundUsable = 'not_run'; noAutoQuit = 'not_run'
  cacheCorruptionRecovery = 'not_run'; validCacheReopen = 'not_run'
  draftBlocksRestart = 'not_run'; savedDataPreserved = 'not_run'; savedDataFilePreserved = 'not_run'
  savedPositionUiRestored = 'not_run'; normalInstallationRestart = 'not_run'
  installPayloadBytes = $null; installFailureRetry = 'not_run'; earlyPrepareRecovery = 'not_run'
  draftAddedDuringSave = 'not_run'; observations = @(); screenshots = @()
  uiActions = @(); finalControlDiagnostics = @(); finalFenControlDiagnostics = @()
}
$server = $null
$installerExitSource = $null
$script:probeInstallerMonitor = $null
function Set-FeedPhase([string]$Phase, [string]$Mode) {
  $body = @{ phase = $Phase; mode = $Mode } | ConvertTo-Json -Compress
  [void](Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:18765/__probe/control' -ContentType 'application/json' -Body $body -TimeoutSec 5)
}
function Read-Feed { return Invoke-RestMethod -Uri 'http://127.0.0.1:18765/__probe/status' -TimeoutSec 5 }
function Get-ProbeActiveTransfer($Network, [string]$Phase, [long]$InstallerSize) {
  if ([long]$Network.installerSize -ne $InstallerSize) { throw 'Live feed installer size differs from actual candidate manifest.' }
  $matches = @($Network.requests | Where-Object {
    $_.phase -ceq $Phase -and $_.kind -eq 'installer' -and $_.method -eq 'GET' -and
    $_.status -in @(200, 206) -and $_.active -eq $true -and $_.completed -eq $false -and
    [long]$_.expectedBodyBytes -gt 0 -and [long]$_.expectedBodyBytes -le $InstallerSize -and
    [long]$_.bodyBytes -gt 0 -and [long]$_.bodyBytes -lt [long]$_.expectedBodyBytes
  })
  if ($matches.Count) { return $matches[0] }
  return $null
}
function Get-ProbeEvents {
  $path = Join-Path $script:probeFaultRoot 'events.jsonl'
  if (Test-Path -LiteralPath $path) {
    return @(Get-Content -LiteralPath $path -Encoding UTF8 | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
  }
  return @()
}
function Get-ProbeSaveBarrierTimeline {
  $timeline = @{}
  foreach ($name in @('save-entered', 'save-completed', 'save-timed-out')) {
    $path = Join-Path $script:probeFaultRoot $name
    if (Test-Path -LiteralPath $path) {
      $timeline[$name] = Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json
    }
  }
  $timeline.releaseMarkerPresent = Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'save-release')
  return $timeline
}
function Get-ProbeShortcutObservation([string]$Path) {
  $observation = @{
    path = $Path; reader = 'Shell.Application:System.Link.TargetParsingPath'
    exists = (Test-Path -LiteralPath $Path -PathType Leaf); target = $null; targetExists = $false
  }
  if (-not $observation.exists) { return $observation }
  $shell = $null; $folder = $null; $item = $null
  try {
    # The installer writes Unicode shell links. WScript.Shell can interpret
    # their names through the ANSI code page and return a blank target.
    # Use the same canonical shell property as the initial installer smoke test.
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.Namespace([IO.Path]::GetDirectoryName($Path))
    $item = $folder.ParseName([IO.Path]::GetFileName($Path))
    $observation.target = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
    if ($observation.target) { $observation.targetExists = Test-Path -LiteralPath $observation.target -PathType Leaf }
  } catch { $observation.failure = $_.Exception.Message }
  finally {
    foreach ($value in @($item, $folder, $shell)) {
      if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($value)
      }
    }
  }
  return $observation
}
function Get-ProbeVisibleFen {
  # Native read-only BoardEditor textbox: its role/name identify the current
  # board even when Chromium omits ClassName. Labels, status and FEN elsewhere
  # cannot prove this value. No renderer evaluation, storage or inferred FEN.
  $controls = @(Get-ProbeControls | Where-Object {
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and
    [string]$_.Current.Name -ceq '目前 FEN'
  })
  if ($controls.Count -gt 1) { throw 'Visible current board FEN is ambiguous.' }
  if ($controls.Count -ne 1) { return $null }
  $control = $controls[0]
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $readOnly = $pattern.Current.IsReadOnly
    $source = 'exact_current_fen_value_pattern'
  } elseif ($control.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    $readOnly = $pattern.DocumentRange.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute)
    $source = 'exact_current_fen_text_pattern'
  } else { return $null }
  if ($readOnly -isnot [bool] -or $readOnly -ne $true) { return $null }
  # This exact observed field may lie below the VM viewport. Require UIA to
  # reveal it before reading the current value, including after board changes.
  Show-ProbeControl $control 'current board FEN'
  $current = $control.Current
  if ($current.IsOffscreen -or $current.ControlType -ne [System.Windows.Automation.ControlType]::Edit -or
      [string]$current.Name -cne '目前 FEN') { return $null }
  if ($source -ceq 'exact_current_fen_value_pattern') {
    $value = $pattern.Current
    $readOnly = $value.IsReadOnly
    $text = [string]$value.Value
  } else {
    $readOnly = $pattern.DocumentRange.GetAttributeValue([System.Windows.Automation.TextPattern]::IsReadOnlyAttribute)
    # One extra character detects truncation beyond the allowed full value.
    $text = [string]$pattern.DocumentRange.GetText(257)
  }
  if ($readOnly -isnot [bool] -or $readOnly -ne $true -or $text.Length -gt 256) { return $null }
  $text = $text.Trim()
  if ($text -cmatch '^[rnbakcpRNBAKCP1-9/]+ [wb] - - [0-9]+ [1-9][0-9]*$') {
    $ranks = ($text -split ' ')[0] -split '/'
    if ($ranks.Count -ne 10) { return $null }
    foreach ($rank in $ranks) {
      $width = 0
      foreach ($cell in $rank.ToCharArray()) {
        if ($cell -ge '1' -and $cell -le '9') { $width += [int]::Parse([string]$cell) } else { $width++ }
      }
      if ($width -ne 9) { return $null }
    }
    return @{ fen = $text; source = $source; control = Get-ProbeControlDiagnostic $control; readOnly = $true }
  }
  return $null
}
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
function Start-ProbeInstallerObservation([string]$InstallerPath, [string]$InstallerHash, [int]$AppProcessId) {
  # Capture OS events before the UI dispatch. No candidate instrumentation or
  # command lines are used; only the validated installer's lineage is reported.
  $state = @{
    installerPath = $InstallerPath; installerHash = $InstallerHash; appProcessId = $AppProcessId
    appPath = $script:probeExe; elevatePath = (Join-Path (Split-Path $script:probeExe) 'resources\elevate.exe')
    starts = [Collections.ArrayList]::Synchronized((New-Object Collections.ArrayList))
    stops = [Collections.ArrayList]::Synchronized((New-Object Collections.ArrayList))
    tracked = @{}; sources = @(); jobs = @()
    evidence = @{ source = 'Win32_ProcessStartTrace+Win32_ProcessStopTrace'; appProcessId = $AppProcessId
      installerPath = $InstallerPath; installerSha256 = $InstallerHash; status = 'waiting'
      subscribedAtUtc = [DateTime]::UtcNow.ToString('o'); processes = @(); versionObservedAtUtc = $null }
  }
  $script:probeInstallerMonitor = $state
  $prefix = "Reckoning-Isolated-Normal-Installer-$($env:GITHUB_RUN_ID)-$PID"
  $state.sources += "$prefix-start"
  $state.jobs += Register-WmiEvent -Namespace 'root\cimv2' -Class Win32_ProcessStartTrace -SourceIdentifier "$prefix-start" -MessageData $state -Action {
    $trace = $event.SourceEventArgs.NewEvent
    $entry = @{ processId = [uint32]$trace.ProcessID; parentProcessId = [uint32]$trace.ParentProcessID
      startedFileTime = [long]$trace.TIME_CREATED; path = $null; sha256 = $null }
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.processId)" -ErrorAction Stop
      if ($process -and [uint32]$process.ParentProcessId -eq $entry.parentProcessId) {
        $entry.path = [string]$process.ExecutablePath
        if ([string]::Equals($entry.path, $event.MessageData.installerPath, [StringComparison]::OrdinalIgnoreCase)) {
          $entry.sha256 = (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256 -ErrorAction Stop).Hash
        }
      }
    } catch { $entry.identityCaptureFailure = $_.Exception.GetType().Name }
    [void]$event.MessageData.starts.Add($entry)
  }
  $state.sources += "$prefix-stop"
  $state.jobs += Register-WmiEvent -Namespace 'root\cimv2' -Class Win32_ProcessStopTrace -SourceIdentifier "$prefix-stop" -MessageData $state -Action {
    $trace = $event.SourceEventArgs.NewEvent
    [void]$event.MessageData.stops.Add(@{ processId = [uint32]$trace.ProcessID
      stoppedFileTime = [long]$trace.TIME_CREATED; exitStatus = [uint32]$trace.ExitStatus })
  }
}
function Update-ProbeInstallerObservation {
  $state = $script:probeInstallerMonitor
  $starts = @($state.starts.ToArray() | Sort-Object startedFileTime)
  # Events can arrive in either callback order. Resolve ancestry from retained
  # start events before pairing stop events with the exact process instance.
  do {
    $added = $false
    foreach ($entry in $starts) {
      $parent = $state.tracked[[uint32]$entry.parentProcessId]
      $direct = [uint32]$entry.parentProcessId -eq $state.appProcessId
      $role = $null
      if (($direct -or ($parent -and $parent.role -eq 'launcher')) -and
          [string]::Equals($entry.path, $state.installerPath, [StringComparison]::OrdinalIgnoreCase)) {
        $role = 'candidate-installer'
      } elseif ($direct -and [string]::Equals($entry.path, $state.elevatePath, [StringComparison]::OrdinalIgnoreCase)) {
        $role = 'launcher'
      } elseif ($parent -and $parent.role -in @('candidate-installer', 'installer-child')) {
        $role = if ([string]::Equals($entry.path, $state.appPath, [StringComparison]::OrdinalIgnoreCase)) { 'app-relaunch' } else { 'installer-child' }
      }
      if (-not $role) { continue }
      $existing = $state.tracked[[uint32]$entry.processId]
      if ($existing) {
        if ($existing.startedFileTime -ne $entry.startedFileTime) { throw 'Installer lineage reused a PID; completion identity is ambiguous.' }
        continue
      }
      $node = @{ processId = [uint32]$entry.processId; parentProcessId = [uint32]$entry.parentProcessId
        role = $role; path = $entry.path; sha256 = $entry.sha256; startedFileTime = $entry.startedFileTime
        startedAtUtc = [DateTime]::FromFileTimeUtc($entry.startedFileTime).ToString('o')
        stoppedAtUtc = $null; exitStatus = $null }
      $state.tracked[[uint32]$entry.processId] = $node
      $state.evidence.processes = @($state.tracked.Values | Sort-Object startedFileTime)
      if ($role -eq 'candidate-installer' -and $entry.sha256 -ne $state.installerHash) {
        throw 'OS-observed installer path did not match the validated candidate SHA-256.'
      }
      $added = $true
    }
  } while ($added)
  foreach ($node in $state.tracked.Values) {
    $stops = @($state.stops.ToArray() | Where-Object {
      $_.processId -eq $node.processId -and $_.stoppedFileTime -ge $node.startedFileTime
    })
    if ($stops.Count -gt 1) { throw 'Installer process-stop identity is ambiguous.' }
    if ($stops.Count -eq 1) {
      $node.exitStatus = $stops[0].exitStatus
      $node.stoppedAtUtc = [DateTime]::FromFileTimeUtc($stops[0].stoppedFileTime).ToString('o')
    }
  }
  $installers = @($state.tracked.Values | Where-Object role -eq 'candidate-installer')
  if ($installers.Count -gt 1) { throw 'Multiple matching candidate installer launches were observed.' }
  $required = @($state.tracked.Values | Where-Object role -ne 'app-relaunch')
  foreach ($node in $required) {
    if ($null -ne $node.exitStatus -and $node.exitStatus -ne 0) {
      throw "Actual installer lineage PID $($node.processId) exited with status $($node.exitStatus)."
    }
  }
  if ($installers.Count -ne 1 -or @($required | Where-Object { $null -eq $_.exitStatus }).Count) { return $false }
  # A live child can precede delivery of its start callback. Do not conclude
  # completion from the bootstrap exit while that OS process is still present.
  $live = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $requiredIds = @($required | ForEach-Object { $_.processId })
  $pending = @($live | Where-Object {
    $_.ProcessId -in $requiredIds -or ($_.ParentProcessId -in $requiredIds -and
      -not [string]::Equals([string]$_.ExecutablePath, $state.appPath, [StringComparison]::OrdinalIgnoreCase))
  })
  $state.evidence.pendingProcessIds = @($pending | ForEach-Object { [uint32]$_.ProcessId })
  return $pending.Count -eq 0
}
function Wait-ProbeInstallerCompletion([string]$Version) {
  $state = $script:probeInstallerMonitor
  try {
    [void](Wait-Probe {
      $complete = Update-ProbeInstallerObservation
      $versionMatches = $false
      try { $versionMatches = (Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion -in @($Version, "$Version.0") } catch { }
      if ($versionMatches -and -not $state.evidence.versionObservedAtUtc) {
        $state.evidence.versionObservedAtUtc = [DateTime]::UtcNow.ToString('o')
        $state.evidence.versionObservedBeforeInstallerCompletion = -not $complete
      }
      return $complete -and $versionMatches
    } 'Normal updater did not complete its OS-observed installer lineage successfully with the expected candidate version.' 180)
    $state.evidence.status = 'completed'
    $state.evidence.completedAtUtc = [DateTime]::UtcNow.ToString('o')
  } catch {
    $state.evidence.status = 'failed'; $state.evidence.failure = $_.Exception.Message
    throw
  }
}
function Stop-ProbeInstallerObservation {
  if (-not $script:probeInstallerMonitor) { return }
  foreach ($source in $script:probeInstallerMonitor.sources) {
    Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue
    Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
  }
  foreach ($job in $script:probeInstallerMonitor.jobs) { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
}
try {
  $predecessor = Get-Content -Raw -Encoding UTF8 release/isolated-package-manifest.json | ConvertFrom-Json
  $candidate = Get-Content -Raw -Encoding UTF8 release/update-candidate/isolated-package-manifest.json | ConvertFrom-Json
  if ($exactMode) {
    node tools/acceptance/windows-exact-candidate.cjs verify release/update-candidate
    if ($LASTEXITCODE -ne 0) { throw 'Exact candidate provenance verification failed.' }
    $report.sourceCommit = $candidate.sourceCommit
    $report.candidateManifest = $candidate
    $report.faultRun = $candidate.faultRun
    $report.differences = @('ARM64 Windows 11 client with x64 emulation',
      'Unchanged public candidate; only predecessor has lower version, loopback feed and declared observation hooks',
      'NSIS exit-73 retry is separate same-source test-pair evidence, not executed with canonical candidate bytes')
    $report.exactCandidateUpdaterAcceptance = 'not_run'
    $report.installFailureRetryScope = 'not-run-on-canonical-installer; separate-same-source-fault-variant'
    if ($predecessor.version -cne $candidate.predecessorVersion) { throw 'Explicit predecessor version mismatch.' }
  }
  if ($predecessor.sourceCommit -cne $report.sourceCommit -or $candidate.sourceCommit -cne $report.sourceCommit -or
      $predecessor.harnessCommit -cne $report.harnessCommit -or $predecessor.mode -cne $mode -or
      $predecessor.role -ne 'predecessor' -or
      $candidate.role -cne $(if ($exactMode) { 'release-candidate' } else { 'test-candidate' }) -or
      $predecessor.productionRelease -ne $false -or $candidate.productionRelease -ne $exactMode -or
      $predecessor.signature -ne 'NotSigned' -or $candidate.signature -ne 'NotSigned') { throw 'Unpublished package provenance mismatch.' }
  if ([version]$candidate.version -le [version]$predecessor.version) { throw 'Updater exercise requires a newer real package identity.' }
  if ((Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion -notin @($predecessor.version, "$($predecessor.version).0")) { throw 'Installed predecessor version mismatch.' }
  $feed = Get-Content -Raw -LiteralPath (Join-Path (Split-Path $script:probeExe) 'resources\app-update.yml')
  if ($feed -notmatch '(?m)^provider:\s*generic\s*$' -or $feed -notmatch 'http://127\.0\.0\.1:18765/') { throw 'Installed updater is not isolated from production.' }
  $report.predecessorVersion = $predecessor.version
  $report.predecessorCommit = $predecessor.sourceCommit
  $predecessorSetup = @($predecessor.artifacts | Where-Object { $_.name -ceq "xiangqi-analyzer-$($predecessor.version)-setup.exe" })
  if ($predecessorSetup.Count -ne 1) { throw 'Predecessor lacks a unique installer entry.' }
  $report.predecessorInstallerSha256 = $predecessorSetup[0].sha256
  $report.candidateVersion = $candidate.version
  $setupEntry = @($candidate.artifacts | Where-Object { $_.name -ceq "xiangqi-analyzer-$($candidate.version)-setup.exe" })
  if ($setupEntry.Count -ne 1) { throw 'Candidate manifest lacks a unique actual installer.' }
  $report.candidateInstallerSha256 = $setupEntry[0].sha256
  $report.candidateInstallerSize = [long]$setupEntry[0].size
  if ($predecessor.probeRunId -cne $env:GITHUB_RUN_ID -or (-not $exactMode -and $candidate.probeRunId -cne $env:GITHUB_RUN_ID) -or
      $env:GITHUB_RUN_ID -notmatch '^[1-9][0-9]{0,19}$') { throw 'Compile-time probe identity mismatch.' }
  $script:probeFaultRoot = Join-Path ([IO.Path]::GetTempPath()) "reckoning-updater-probe-$($env:GITHUB_RUN_ID)"
  [void](New-Item -ItemType Directory -Path $script:probeFaultRoot -Force)
  $report.probeDifferences = @($predecessor.differences) + @($candidate.differences)
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
  # Source-defined test-only UI calls the existing download handler before the
  # real loopback feed has revealed any version. The SDK remains unchanged.
  Invoke-ProbeAction 'Test: prepare before discovery'
  [void](Wait-Probe { @(Get-ProbeEvents | Where-Object stage -eq 'prepare-complete').Count -gt 0 } 'Early prepare did not complete through normal trusted UI IPC.' 10)
  if (@((Read-Feed).requests | Where-Object { $_.kind -eq 'installer' -or ($_.kind -eq 'metadata' -and $_.status -ne 503) }).Count) {
    throw 'Early prepare did not precede version discovery.'
  }
  $report.earlyPrepareMode = 'declared-test-UI-before-version-discovery'
  # Create real persisted test data through the application UI, not AppData edits.
  Invoke-ProbeAction '局面工具'
  Invoke-ProbeAction '擺棋與保存局面' -Prefix
  $savedFenObservation = Wait-Probe { Get-ProbeVisibleFen } 'Actual saved board FEN is not available through normal UI.' 10
  $marker = "Isolated updater data $($env:GITHUB_RUN_ID)"
  Set-ProbeInput '局面名稱（選填）' $marker
  Invoke-ProbeAction '保存'
  [void](Wait-Probe { Find-ProbeAction $marker } 'Saved test position did not appear through the real UI.')
  $dataPath = Join-Path $env:APPDATA 'xiangqi-analyzer\app-data.json'
  [void](Wait-Probe { (Test-Path -LiteralPath $dataPath) -and (Get-Content -Raw -LiteralPath $dataPath).Contains($marker) } 'Actual saved position was not persisted.')
  $report.testDataMarker = $marker
  $report.savedPositionFen = $savedFenObservation.fen
  $report.savedPositionUiBefore = $savedFenObservation
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
  $transferBefore = Wait-Probe { Get-ProbeActiveTransfer (Read-Feed) 'background-recovery' $report.candidateInstallerSize } 'Installer active transfer never began.' 90
  $backgroundProcessId = (Get-ProbeWindow).Current.ProcessId
  Invoke-ProbeAction '分析'
  Invoke-ProbeAction '猜著'
  Set-ProbeInput '你選這一步的原因' 'Background download remains usable'
  $transferAfter = Get-ProbeActiveTransfer (Read-Feed) 'background-recovery' $report.candidateInstallerSize
  $inputAction = $script:probeUiActions[-1]
  if (-not $transferAfter -or $transferAfter.at -cne $transferBefore.at -or
      [long]$transferAfter.bodyBytes -le [long]$transferBefore.bodyBytes -or
      $inputAction.method -cne 'UIA_Value' -or $inputAction.result -cne 'completed' -or
      (Get-ProbeWindow).Current.ProcessId -ne $backgroundProcessId) {
    throw 'Verified input and same App PID did not overlap one real incomplete installer transfer.'
  }
  $report.backgroundTransferEvidence = @{ before = $transferBefore; after = $transferAfter; input = $inputAction; processId = $backgroundProcessId }
  $report.backgroundUsable = 'passed'
  Set-ProbeInput '你選這一步的原因' ''
  Open-ProbeSystemSettings
  Assert-Prepared
  if ((Get-ProbeWindow).Current.ProcessId -ne $backgroundProcessId) { throw 'App exited or relaunched during background preparation.' }
  $report.downloadFailureRecovery = 'passed'
  $report.noAutoQuit = 'passed'
  $report.earlyPrepareRecovery = 'passed'
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
  $report.cacheReusePayloadBytes = [long]$cacheNetwork.phases.'valid-cache-reopen'.installerBytes
  $report.cacheReusePayloadRequests = [long]$cacheNetwork.phases.'valid-cache-reopen'.installerRequests
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

  # Hold only the acknowledgement of an already completed actual atomic write.
  # Navigation stays normal UI; the passive observations distinguish the
  # pre-save clear state from a draft entered while the save promise is pending.
  $eventOffset = @(Get-ProbeEvents).Count
  $raceProcessId = (Get-ProbeWindow).Current.ProcessId
  $report.draftRaceEvidence = @{ eventOffset = $eventOffset; processId = $raceProcessId; armedAt = [DateTime]::UtcNow.ToString('o') }
  Set-Content -LiteralPath (Join-Path $script:probeFaultRoot 'save-arm') -Value 'one-shot' -Encoding ASCII
  Invoke-ProbeAction '重新啟動完成更新'
  Confirm-ProbeRestart
  [void](Wait-Probe { Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'save-entered') } 'Real save acknowledgement barrier was not entered.' 10)
  $writeBarrier = Get-Content -Raw -LiteralPath (Join-Path $script:probeFaultRoot 'save-entered') | ConvertFrom-Json
  if ($writeBarrier.actualWriteCompleted -ne $true -or $writeBarrier.timeoutMs -ne 12000) { throw 'Real atomic-write barrier evidence is invalid.' }
  # PowerShell 7 may deserialize this JSON timestamp as an existing UTC
  # DateTime. Reparsing that object through a string loses its timezone.
  $writeDeadline = $writeBarrier.deadlineAt
  if ($writeDeadline -isnot [DateTime]) {
    $writeDeadline = [DateTime]::Parse($writeDeadline, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  }
  Invoke-ProbeAction '分析'
  # The guessing view was selected and its exact input verified empty before
  # opening settings. Returning preserves it; re-toggling the selected tab
  # added a full UIA scan and scroll inside the twelve-second barrier.
  Set-ProbeInput '你選這一步的原因' 'Draft entered while actual save acknowledgement is pending'
  $report.draftRaceEvidence.input = $script:probeUiActions[-1]
  if ($report.draftRaceEvidence.input.method -cne 'UIA_Value' -or $report.draftRaceEvidence.input.result -cne 'completed' -or
      (Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'save-timed-out')) -or
      (Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'save-completed')) -or
      [DateTime]::UtcNow -ge $writeDeadline.ToUniversalTime()) {
    throw 'Verified draft input did not finish while the real save acknowledgement was pending.'
  }
  $report.draftRaceEvidence.releaseRequestedAt = [DateTime]::UtcNow.ToString('o')
  Set-Content -LiteralPath (Join-Path $script:probeFaultRoot 'save-release') -Value 'release' -Encoding ASCII
  [void](Wait-Probe { @(Get-ProbeEvents | Select-Object -Skip $eventOffset | Where-Object stage -eq 'after-save-draft-present').Count -gt 0 } 'Actual post-save draft check did not reject the newly entered draft.' 5)
  $raceEvents = @(Get-ProbeEvents | Select-Object -Skip $eventOffset)
  if (-not @($raceEvents | Where-Object stage -eq 'first-draft-clear').Count -or
      -not (Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'save-completed')) -or
      (Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'save-timed-out')) -or
      @($raceEvents | Where-Object stage -eq 'install-dispatch').Count -or
      (Get-ProbeWindow).Current.ProcessId -ne $raceProcessId -or
      (Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion -notin @($predecessor.version, "$($predecessor.version).0")) {
    throw 'Save-race evidence did not preserve the old App without installer dispatch.'
  }
  $report.draftAddedDuringSave = 'passed'
  $report.draftRaceEvidence.events = $raceEvents
  $report.draftRaceEvidence.barrier = Get-ProbeSaveBarrierTimeline
  Record-Probe 'draft-added-during-save'
  Set-ProbeInput '你選這一步的原因' ''
  Open-ProbeSystemSettings

  # SDK owns launching the actual hash-validated NSIS executable. Its one-shot
  # customInit fault exits before installation. SDK quits the App on spawn,
  # so the real recovery mode is normal reopening, not an in-process retry.
  if (-not $exactMode) {
  Set-FeedPhase 'install' 'healthy'
  # Subscribe before SDK launch so even a fast customInit failure is retained.
  # Only the matching NSIS PID's OS stop event is recorded, never other processes.
  $installerExitSource = "Reckoning-Isolated-Installer-Exit-$($env:GITHUB_RUN_ID)-$PID"
  [void](Register-WmiEvent -Namespace 'root\cimv2' -Class Win32_ProcessStopTrace -SourceIdentifier $installerExitSource)
  Set-Content -LiteralPath (Join-Path $script:probeFaultRoot 'install-fail-next') -Value 'one-shot' -Encoding ASCII
  Invoke-ProbeAction '重新啟動完成更新'
  Confirm-ProbeRestart
  [void](Wait-Probe { (Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'install-failed.json')) -and -not (Get-ProbeWindow) } 'Real NSIS one-shot failure and App exit were not observed.' 45)
  $installFault = Get-Content -Raw -LiteralPath (Join-Path $script:probeFaultRoot 'install-failed.json') | ConvertFrom-Json
  if ($installFault.configuredExitCode -ne 73 -or $installFault.failureKind -cne 'one-shot-customInit' -or
      [long]$installFault.processId -le 0 -or [long]$installFault.processId -gt [uint32]::MaxValue) { throw 'NSIS fault marker lacks a valid actual process identity.' }
  $installerStop = Wait-Probe {
    $matching = @(Get-Event -SourceIdentifier $installerExitSource -ErrorAction SilentlyContinue | Where-Object {
      [uint32]$_.SourceEventArgs.NewEvent.ProcessID -eq [uint32]$installFault.processId
    })
    if ($matching.Count -gt 1) { throw 'NSIS process-stop observation is ambiguous.' }
    if ($matching.Count -eq 1) { return $matching[0].SourceEventArgs.NewEvent }
  } 'Matching NSIS PID did not produce an actual OS process-stop event.' 15
  $actualInstallerExit = @{
    source = 'Win32_ProcessStopTrace'; processId = [uint32]$installerStop.ProcessID
    processName = [string]$installerStop.ProcessName; exitStatus = [uint32]$installerStop.ExitStatus
    atUtc = [DateTime]::FromFileTimeUtc([long]$installerStop.TIME_CREATED).ToString('o')
  }
  if ($actualInstallerExit.exitStatus -ne 73 -or
      @(Get-Process -Id $actualInstallerExit.processId -ErrorAction SilentlyContinue).Count -gt 0 -or
      (Test-Path -LiteralPath (Join-Path $script:probeFaultRoot 'install-fail-next')) -or
      (Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion -notin @($predecessor.version, "$($predecessor.version).0") -or
      (Get-FileHash -LiteralPath $dataPath -Algorithm SHA256).Hash -ne $report.savedDataSha256Before) { throw 'Installer failure altered old App/data or did not consume the real one-shot fault.' }
  Set-FeedPhase 'install-failure-recovery' 'healthy'
  Start-ProbeApplication
  Open-ProbeSystemSettings
  Assert-Prepared
  [void](Get-ValidatedPendingInstaller $report.candidateInstallerSha256)
  $retryNetwork = Read-Feed
  if ($retryNetwork.phases.'install-failure-recovery'.metadataBytes -le 0 -or
      $retryNetwork.phases.'install-failure-recovery'.installerBytes -gt 0 -or
      $retryNetwork.phases.'install-failure-recovery'.installerRequests -gt 0) { throw 'Installer failure recovery did not revalidate and reuse the actual cached installer.' }
  $report.installFailureRecoveryMode = 'normal-reopen-and-UI-retry-after-real-NSIS-exit-73'
  $report.installFailureEvidence = @{ configuredFault = $installFault; actualOsExit = $actualInstallerExit }
  }
  Set-FeedPhase 'install' 'healthy'
  $preparedInstaller = Get-ValidatedPendingInstaller $report.candidateInstallerSha256
  $report.preparedInstallerSha256 = (Get-FileHash -LiteralPath $preparedInstaller -Algorithm SHA256).Hash
  Start-ProbeInstallerObservation $preparedInstaller $report.preparedInstallerSha256 (Get-ProbeWindow).Current.ProcessId
  $report.normalInstallerObservation = $script:probeInstallerMonitor.evidence
  Invoke-ProbeAction '重新啟動完成更新'
  Confirm-ProbeRestart
  Wait-ProbeInstallerCompletion $candidate.version
  Start-ProbeApplication
  if ((Get-FileHash -LiteralPath $dataPath -Algorithm SHA256).Hash -ne $report.savedDataSha256Before) { throw 'Actual saved application data changed during install.' }
  $report.savedDataSha256After = (Get-FileHash -LiteralPath $dataPath -Algorithm SHA256).Hash
  $report.savedDataFilePreserved = 'passed'
  $report.finalInstalledVersion = (Get-Item -LiteralPath $script:probeExe).VersionInfo.ProductVersion
  Open-ProbeSystemSettings
  Assert-ProbeUiVersion $candidate.version 'Updated packaged candidate'
  $report.candidateUiVersion = $candidate.version
  Invoke-ProbeAction '分析'
  Invoke-ProbeAction '局面工具'
  Invoke-ProbeAction '擺棋與保存局面' -Prefix
  [void](Wait-Probe { Find-ProbeAction $marker } 'Updated App did not expose the actual saved position marker.' 10)
  # Deliberately change the actual current position through the normal UI
  # before loading. A no-op saved-position action cannot pass this assertion.
  $savedSide = ($report.savedPositionFen -split ' ')[1]
  $differentSide = if ($savedSide -ceq 'w') { 'b' } else { 'w' }
  Invoke-ProbeAction $(if ($differentSide -ceq 'b') { '黑方先' } else { '紅方先' })
  $differentFen = $report.savedPositionFen -replace ' [wb] - - ', " $differentSide - - "
  $changedFenObservation = Wait-Probe {
    $observed = Get-ProbeVisibleFen
    if ($observed -and $observed.fen -ceq $differentFen) { return $observed }
  } 'Normal UI did not change the current position before the saved-position reload.' 10
  Invoke-ProbeAction $marker
  $restoredFenObservation = Wait-Probe {
    $observed = Get-ProbeVisibleFen
    if ($observed -and $observed.fen -ceq $report.savedPositionFen) { return $observed }
  } 'Updated App did not restore the saved position FEN through its real UI.' 10
  $report.savedPositionUiEvidence = @{ marker = $marker; changed = $changedFenObservation; restored = $restoredFenObservation }
  $report.savedPositionUiRestored = 'passed'
  $report.savedDataPreserved = 'passed'
  $shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) '象棋AI分析講解.lnk'
  $report.desktopShortcutObservation = Get-ProbeShortcutObservation $shortcut
  if (-not $report.desktopShortcutObservation.exists -or -not $report.desktopShortcutObservation.targetExists -or
      -not [string]::Equals($report.desktopShortcutObservation.target, $script:probeExe, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Updated desktop shortcut is missing, unreadable, or does not point at the installed executable; see desktopShortcutObservation.'
  }
  $report.desktopShortcutTarget = $report.desktopShortcutObservation.target
  $installNetwork = Read-Feed
  $installPhase = $installNetwork.phases.install
  $report.installPayloadBytes = if ($installPhase) { [long]$installPhase.installerBytes } else { 0 }
  $report.installPayloadRequests = if ($installPhase) { [long]$installPhase.installerRequests } else { 0 }
  if ($report.installPayloadBytes -ne 0 -or $report.installPayloadRequests -ne 0) { throw 'Restart/install phase requested installer payload again.' }
  $report.normalInstallationRestart = 'passed'
  if ($exactMode) { $report.exactCandidateUpdaterAcceptance = 'passed' }
  else { $report.installFailureRetry = 'passed' }
  Record-Probe 'updated-workspace'
  $report.result = 'passed'
  $report.remainingPackagedGates = @()
} catch {
  $report.result = 'failed'
  $report.failure = $_.Exception.Message
  throw
} finally {
  if ($script:probeFaultRoot) {
    try {
      $report.probeEvents = @(Get-ProbeEvents)
      $report.saveBarrierTimeline = Get-ProbeSaveBarrierTimeline
    } catch { $report.probeTimelineFailure = $_.Exception.Message }
  }
  if ($installerExitSource) {
    Unregister-Event -SourceIdentifier $installerExitSource -ErrorAction SilentlyContinue
    Get-Event -SourceIdentifier $installerExitSource -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
  }
  Stop-ProbeInstallerObservation
  $report.applicationStarts = @($script:probeApplicationStarts)
  $report.uiActions = @($script:probeUiActions)
  try {
    $report.finalControlDiagnostics = @(Get-ProbeControls | Where-Object {
      $_.Current.ControlType -in @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::MenuItem, [System.Windows.Automation.ControlType]::Edit)
    } | Select-Object -First 80 | ForEach-Object { Get-ProbeControlDiagnostic $_ })
    $report.finalFenControlDiagnostics = @(Get-ProbeControls | Where-Object {
      [string]$_.Current.ClassName -ceq 'fen-output' -or [string]$_.Current.Name -ceq '目前 FEN' -or
      ([string]$_.Current.Name).Trim() -cmatch '^[rnbakcpRNBAKCP1-9/]+ [wb] - - [0-9]+ [1-9][0-9]*$'
    } | Select-Object -First 12 | ForEach-Object { Get-ProbeControlDiagnostic $_ })
  } catch { $report.controlDiagnosticFailure = $_.Exception.Message }
  try { $report.screenshots += Save-ProbeScreen 'final' } catch { $report.screenshotFailure = $_.Exception.Message }
  $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  # App closes normally; installer is never called directly by this exercise.
  try { Close-ProbeApplication } catch { }
}
