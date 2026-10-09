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
