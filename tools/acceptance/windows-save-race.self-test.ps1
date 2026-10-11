param([string]$SourcePath = (Join-Path $PSScriptRoot 'windows-packaged-updater.ps1'))
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath $SourcePath
$start = $source.IndexOf('  # Hold only the acknowledgement')
$end = $source.IndexOf("  [void](Wait-Probe { @(Get-ProbeEvents | Select-Object -Skip", $start)
if ($start -lt 0 -or $end -le $start) { throw 'Save-race choreography source boundary is missing.' }
$choreography = [scriptblock]::Create($source.Substring($start, $end - $start))

# Execute the actual script block with offline UI/file seams. No native input,
# application, renderer evaluation or real IPC is used. The captured VM trace
# gives Analyze -> already-selected Guess = 4568 ms, Guess -> input = 3420 ms,
# and input verification = 954 ms. Barrier-entry time was not captured; the
# 4000 ms navigation/discovery stress is explicit, not a claimed VM timestamp.
$script:probeFaultRoot = 'offline-save-race'
$script:probeUiActions = @()
$script:elapsed = 0; $script:pending = $false; $script:released = $false
$script:draft = ''; $script:actions = @()
$script:navigationMs = 4000; $script:actualWriteCompleted = $true; $script:completedEarly = $false
$script:deadlineRepresentation = 'native'; $script:deadlineAt = [DateTime]::UtcNow.AddSeconds(12).ToString('o')
$report = @{}
function Get-ProbeEvents { return @() }
function Get-ProbeWindow { return [pscustomobject]@{ Current = [pscustomobject]@{ ProcessId = 42 } } }
function Invoke-ProbeAction([string]$Name) {
  $script:actions += $Name
  if ($script:pending) {
    if ($Name -ceq '分析') { $script:elapsed += $script:navigationMs }
    elseif ($Name -ceq '猜著') { $script:elapsed += 4568 }
    else { throw "Unexpected action during pending acknowledgement: $Name" }
  }
}
function Confirm-ProbeRestart { $script:pending = $true; $script:elapsed = 0 }
function Wait-Probe([scriptblock]$Condition, [string]$Message, [int]$Seconds) {
  $result = & $Condition
  if (-not $result) { throw $Message }
  return $result
}
function Test-Path([string]$LiteralPath) {
  if ($LiteralPath.EndsWith('save-entered')) { return $script:pending }
  if ($LiteralPath.EndsWith('save-timed-out')) { return $script:elapsed -ge 12000 }
  if ($LiteralPath.EndsWith('save-completed')) { return $script:completedEarly }
  return $false
}
function Get-Content([string]$LiteralPath, [switch]$Raw) {
  return (@{ at = [DateTime]::UtcNow.ToString('o'); deadlineAt = $script:deadlineAt; actualWriteCompleted = $script:actualWriteCompleted; timeoutMs = 12000 } | ConvertTo-Json -Compress)
}
function ConvertFrom-Json {
  param([Parameter(ValueFromPipeline=$true)][string]$InputObject)
  process {
    $result = Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $InputObject
    # Exercise both real parser representations under each PowerShell version.
    # The native case leaves that shell's JSON date behavior untouched.
    if ($script:deadlineRepresentation -ceq 'string') { $result.deadlineAt = $script:deadlineAt }
    if ($script:deadlineRepresentation -ceq 'datetime') {
      $result.deadlineAt = [DateTime]::Parse($script:deadlineAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    }
    return $result
  }
}
function Set-ProbeInput([string]$Name, [string]$Value) {
  if (-not $script:pending -or $Name -cne '你選這一步的原因') { throw 'Draft input did not overlap the pending real-save seam.' }
  $script:elapsed += 3420 + 954
  $script:draft = $Value
  $script:probeUiActions += @{ method = 'UIA_Value'; result = 'completed'; verificationMs = 954 }
}
function Set-Content([string]$LiteralPath, [string]$Value, [string]$Encoding) {
  if ($LiteralPath.EndsWith('save-arm')) { return }
  if (-not $LiteralPath.EndsWith('save-release')) { throw 'Unexpected marker write.' }
  if (-not $script:pending -or -not $script:draft -or $script:elapsed -ge 12000) {
    throw "Save acknowledgement expired before verified draft release: $($script:elapsed) ms / 12000 ms."
  }
  $script:released = $true; $script:pending = $false
}
Write-Output "PowerShell $($PSVersionTable.PSVersion); local timezone $([TimeZoneInfo]::Local.Id)"
$futureDeadline = [DateTime]::UtcNow.AddSeconds(12).ToString('o')
foreach ($representation in @('native', 'string', 'datetime')) {
  $script:deadlineRepresentation = $representation; $script:deadlineAt = $futureDeadline
  $script:elapsed = 0; $script:pending = $false; $script:released = $false; $script:draft = ''; $script:probeUiActions = @()
  & $choreography
  if (-not $script:released -or -not $script:draft -or $script:pending) { throw 'Choreography never released a pending save after entering the draft.' }
  Write-Output "PASS $representation UTC deadline releases after verified draft at $($script:elapsed) ms under explicit navigation stress"
}
$pastDeadline = [DateTime]::UtcNow.AddSeconds(-1).ToString('o')
foreach ($representation in @('native', 'string', 'datetime')) {
  foreach ($mode in @('expired', 'deadline-expired', 'write-incomplete', 'completed-before-input')) {
    $script:deadlineRepresentation = $representation
    $script:deadlineAt = if ($mode -ceq 'deadline-expired') { $pastDeadline } else { $futureDeadline }
    $script:elapsed = 0; $script:pending = $false; $script:released = $false; $script:draft = ''; $script:probeUiActions = @()
    $script:navigationMs = if ($mode -ceq 'expired') { 8000 } else { 4000 }
    $script:actualWriteCompleted = $mode -cne 'write-incomplete'
    $script:completedEarly = $mode -ceq 'completed-before-input'
    $failure = $null
    try { & $choreography } catch { $failure = $_.Exception.Message }
    $expected = if ($mode -ceq 'write-incomplete') { '*atomic-write barrier evidence is invalid*' } else { '*did not finish while the real save acknowledgement was pending*' }
    if (-not $failure -or $failure -notlike $expected -or $script:released) { throw "Invalid save race was accepted or released: $representation / $mode / $failure" }
    Write-Output "PASS $representation $mode race fails before release"
  }
}
Write-Output 'Offline timing fixture only; actual packaged VM barrier and renderer observations remain required.'

# Exercise the actual final-install choreography: an updated executable version
# can be visible while NSIS is still replacing resources.
& {
  $installStart = $source.LastIndexOf("  Set-FeedPhase 'install' 'healthy'")
  $installEnd = $source.IndexOf('  if ((Get-FileHash -LiteralPath $dataPath', $installStart)
  if ($installStart -lt 0 -or $installEnd -le $installStart) { throw 'Final-install choreography source boundary is missing.' }
  $installChoreography = [scriptblock]::Create($source.Substring($installStart, $installEnd - $installStart))
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw 'Updater source parse failed.' }
  foreach ($name in @('Start-ProbeInstallerObservation', 'Update-ProbeInstallerObservation', 'Wait-ProbeInstallerCompletion')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($definition) { Invoke-Expression $definition.Extent.Text }
  }
  $candidate = @{ version = '0.4.15' }
  $script:probeExe = 'C:\offline\App\app.exe'
  $script:fixtureFileTime = [DateTime]::UtcNow.ToFileTimeUtc()
  function Set-FeedPhase { }
  function Get-ValidatedPendingInstaller { return 'C:\offline\candidate.exe' }
  function Get-FileHash { return @{ Hash = $(if ($script:installCase -eq 'wrong-hash' -and $script:inCallback) { 'other-hash' } else { 'fixture-hash' }) } }
  function Get-Item { return @{ VersionInfo = @{ ProductVersion = $(if ($script:installCase -eq 'old-version') { '0.4.14' } else { '0.4.15' }) } } }
  function Invoke-ProbeAction { }
  function Confirm-ProbeRestart { }
  function Register-WmiEvent($Namespace, $Class, $SourceIdentifier, $MessageData, [scriptblock]$Action) {
    $script:subscriptions[$Class] = @{ Action = $Action; State = $MessageData }
    return @{ Id = $script:subscriptions.Count }
  }
  function Get-CimInstance($Class, [string]$Filter) {
    if ($Filter) { return $script:fixtureProcesses[[uint32]($Filter -replace '\D', '')] }
    if ($script:installCase -eq 'live-child-event-pending') { return @{ ProcessId = 300; ParentProcessId = 100; ExecutablePath = 'C:\offline\late-child.tmp' } }
    return @()
  }
  function Emit-InstallerStart([uint32]$ProcessId, [uint32]$ParentId, [string]$Path) {
    $script:fixtureProcesses[$ProcessId] = @{ ProcessId = $ProcessId; ParentProcessId = $ParentId; ExecutablePath = $Path }
    $subscription = $script:subscriptions.Win32_ProcessStartTrace
    $event = @{ MessageData = $subscription.State; SourceEventArgs = @{ NewEvent = @{
      ProcessID = $ProcessId; ParentProcessID = $ParentId; TIME_CREATED = $script:fixtureFileTime + $ProcessId } } }
    $script:inCallback = $true
    & $subscription.Action
    $script:inCallback = $false
  }
  function Emit-InstallerStop([uint32]$ProcessId, [uint32]$ExitStatus) {
    $subscription = $script:subscriptions.Win32_ProcessStopTrace
    $event = @{ MessageData = $subscription.State; SourceEventArgs = @{ NewEvent = @{
      ProcessID = $ProcessId; ExitStatus = $ExitStatus; TIME_CREATED = $script:fixtureFileTime + 10000 } } }
    & $subscription.Action
  }
  function Wait-Probe([scriptblock]$Condition, [string]$Message, [int]$Seconds) {
    if (-not $script:probeInstallerMonitor) { return & $Condition } # Original source must still reach the red assertion.
    if ($Seconds -ne 180) { throw 'Normal installation timeout was extended.' }
    for ($step = 1; $step -le 3; $step++) {
      if ($step -eq 1) {
        $parentId = if ($script:installCase -eq 'unrelated-parent') { 999 } else { 42 }
        $path = if ($script:installCase -eq 'wrong-path') { 'C:\offline\other.exe' } else { 'C:\offline\candidate.exe' }
        Emit-InstallerStart 100 $parentId $path
        if ($script:installCase -eq 'child-pending') { Emit-InstallerStart 200 100 'C:\offline\nsis-child.tmp' }
        if ($script:installCase -eq 'app-relaunch') { Emit-InstallerStart 200 100 $script:probeExe }
      }
      if ($step -eq 2 -and $script:installCase -ne 'never-stopped') {
        Emit-InstallerStop 100 $(if ($script:installCase -eq 'failed-exit') { 73 } else { 0 })
      }
      if ($step -eq 3 -and $script:installCase -eq 'child-pending') { Emit-InstallerStop 200 0 }
      $script:installerFinished = $step -ge $(if ($script:installCase -eq 'child-pending') { 3 } else { 2 }) -and
        $script:installCase -in @('completed', 'child-pending', 'app-relaunch')
      $result = & $Condition
      if ($result) {
        if (-not $script:installerFinished) { throw 'Installer completion accepted an unfinished or failed lineage.' }
        return $result
      }
    }
    throw $Message
  }
  function Start-ProbeApplication {
    if (-not $script:installerFinished) { throw 'REGRESSION: updated EXE version allowed App start before actual installer completion.' }
    $script:applicationStarts++
  }
  foreach ($case in @('completed', 'child-pending', 'app-relaunch', 'never-stopped', 'failed-exit', 'wrong-hash', 'wrong-path', 'unrelated-parent', 'old-version', 'live-child-event-pending')) {
    $script:installCase = $case; $script:installerFinished = $false; $script:applicationStarts = 0
    $script:probeInstallerMonitor = $null; $script:subscriptions = @{}; $script:fixtureProcesses = @{}; $script:inCallback = $false
    $report = @{ candidateInstallerSha256 = 'fixture-hash' }; $failure = $null
    try { & $installChoreography } catch { $failure = $_.Exception.Message }
    if ($case -in @('completed', 'child-pending', 'app-relaunch')) {
      if ($failure -or $script:applicationStarts -ne 1 -or $report.normalInstallerObservation.status -ne 'completed' -or
          $report.normalInstallerObservation.versionObservedBeforeInstallerCompletion -ne $true) {
        throw "Installation completion fixture failed: $case / $failure"
      }
    } else {
      if (-not $failure -or $script:applicationStarts -ne 0 -or $report.normalInstallerObservation.status -ne 'failed') {
        throw "Unsafe installation fixture was accepted: $case / $failure"
      }
      if ($case -eq 'failed-exit' -and ($failure -notlike '*status 73*' -or $report.normalInstallerObservation.processes[0].exitStatus -ne 73)) {
        throw 'Actual installer failure code was not preserved.'
      }
    }
    Write-Output "PASS actual final-install choreography: $case"
  }
  Write-Output '10/10 offline installer lifecycle cases passed; actual VM completion and startup remain unverified.'
}
