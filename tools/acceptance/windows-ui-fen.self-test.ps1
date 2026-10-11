param(
  [string]$UpdaterPath = (Join-Path $PSScriptRoot 'windows-packaged-updater.ps1'),
  [string]$UiPath = (Join-Path $PSScriptRoot 'windows-packaged-ui.ps1')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
foreach ($source in @($UpdaterPath, $UiPath)) {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "Source parse failed: $source" }
  foreach ($name in @('Get-ProbeVisibleFen', 'Get-ProbeControlDiagnostic', 'Show-ProbeControl')) {
    $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($function) { Invoke-Expression $function.Extent.Text }
  }
}
# Offline fixtures at the UIA boundary. No native window, focus, input,
# renderer evaluation, application IPC, or AppData is accessed.
function Assert-ProbeForeground { $script:foregroundChecks++ }
function Get-ProbeControls { return $script:controls }
function Wait-Probe([scriptblock]$Condition, [string]$Message, [int]$Seconds = 30) {
  $script:lastWaitSeconds = $Seconds
  for ($i = 0; $i -lt 3; $i++) {
    $result = & $Condition
    if ($result) { return $result }
  }
  throw $Message
}
function New-FenControl([string]$Value, [bool]$Offscreen = $false, [string]$Class = 'fen-output', [bool]$Scrollable = $true, [bool]$Responds = $true, [string]$PatternText = '', [object]$ReadOnly = $true, [bool]$ValueSupported = $true, [string]$Name = '目前 FEN', $Kind = [System.Windows.Automation.ControlType]::Edit) {
  $control = [pscustomobject]@{
    Current = [pscustomobject]@{
      Name = $Name; ClassName = $Class; IsOffscreen = $Offscreen
      ControlType = $Kind; AutomationId = ''; IsEnabled = $true
    }
    scrolls = 0; scrollable = $Scrollable; responds = $Responds; patternText = $PatternText; bound = $null
    readOnly = $ReadOnly; valueSupported = $ValueSupported; valueReads = 0; readOnlyReads = 0
  }
  $scroll = [pscustomobject]@{ Owner = $control }
  $scroll | Add-Member ScriptMethod ScrollIntoView {
    $this.Owner.scrolls++
    if ($this.Owner.responds) { $this.Owner.Current.IsOffscreen = $false }
  }
  $range = [pscustomobject]@{ Owner = $control }
  $range | Add-Member ScriptMethod GetText {
    param($limit)
    $this.Owner.bound = $limit
    return $this.Owner.patternText.Substring(0, [Math]::Min($limit, $this.Owner.patternText.Length))
  }
  $range | Add-Member ScriptMethod GetAttributeValue {
    param($attribute)
    if ($attribute -ne [System.Windows.Automation.TextPattern]::IsReadOnlyAttribute) { throw 'Unexpected text attribute read' }
    $this.Owner.readOnlyReads++
    return $this.Owner.readOnly
  }
  $valuePattern = [pscustomobject]@{ Owner = $control; Value = $Value }
  $valuePattern | Add-Member ScriptProperty Current {
    $this.Owner.valueReads++
    return [pscustomobject]@{ IsReadOnly = $this.Owner.readOnly; Value = $this.Value }
  }
  $control | Add-Member NoteProperty ScrollPattern $scroll
  $control | Add-Member NoteProperty TextPattern ([pscustomobject]@{ DocumentRange = $range })
  $control | Add-Member NoteProperty ValuePattern $valuePattern
  $control | Add-Member ScriptMethod GetSupportedPatterns {
    if ($this.scrollable) { [System.Windows.Automation.ScrollItemPattern]::Pattern }
    if ($this.patternText) { [System.Windows.Automation.TextPattern]::Pattern }
    if ($this.valueSupported) { [System.Windows.Automation.ValuePattern]::Pattern }
  }
  $control | Add-Member ScriptMethod TryGetCurrentPattern {
    param($id, $target)
    if ($this.scrollable -and $id -eq [System.Windows.Automation.ScrollItemPattern]::Pattern) { $target.Value = $this.ScrollPattern; return $true }
    if ($this.patternText -and $id -eq [System.Windows.Automation.TextPattern]::Pattern) { $target.Value = $this.TextPattern; return $true }
    if ($this.valueSupported -and $id -eq [System.Windows.Automation.ValuePattern]::Pattern) { $target.Value = $this.ValuePattern; return $true }
    $target.Value = $null; return $false
  }
  return $control
}
function Reset-Case($Controls) {
  $script:controls = @($Controls); $script:probeUiActions = @(); $script:foregroundChecks = 0; $script:lastWaitSeconds = $null
}
$fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
$visible = New-FenControl $fen
Reset-Case $visible
$observed = Get-ProbeVisibleFen
if (-not $observed -or $observed.fen -cne $fen -or $visible.scrolls -ne 0) { throw 'Visible exact current FEN was not preserved' }
Write-Output 'PASS exact visible FEN observed without scrolling'

$offscreen = New-FenControl $fen $true
Reset-Case $offscreen
$observed = Get-ProbeVisibleFen
if (-not $observed -or $observed.fen -cne $fen -or $offscreen.Current.IsOffscreen -or
    $offscreen.scrolls -ne 1 -or $script:foregroundChecks -ne 1 -or
    $script:probeUiActions[-1].method -cne 'UIA_ScrollItem' -or $script:probeUiActions[-1].result -cne 'completed') {
  throw 'Offscreen source-defined FEN was not brought into view and observed through UIA'
}
Write-Output 'PASS offscreen exact current FEN scrolled once and observed visibly'

$text = New-FenControl '' $true 'fen-output' $true $true $fen $true $false
Reset-Case $text
$observed = Get-ProbeVisibleFen
if (-not $observed -or $observed.fen -cne $fen -or $text.bound -ne 257 -or $text.scrolls -ne 1) { throw 'Bounded source-only TextPattern observation failed' }
Write-Output 'PASS source FEN bounded TextPattern read after scrolling'

$unrelated = New-FenControl $fen $true 'unrelated-output' $true $true $fen -Name '匯入 FEN'
Reset-Case $unrelated
if ((Get-ProbeVisibleFen) -or $unrelated.scrolls -ne 0 -or $unrelated.bound -ne $null) { throw 'Arbitrary FEN control was operated or accepted' }
Write-Output 'PASS unrelated FEN text is neither scrolled nor read'

$invalid = New-FenControl 'A paragraph containing a FEN is not a current board observation'
Reset-Case $invalid
if (Get-ProbeVisibleFen) { throw 'Invalid source text accepted as FEN' }
Write-Output 'PASS invalid source text cannot prove the current board'

foreach ($case in @(@{ scrollable = $false; responds = $true; failure = 'cannot be scrolled into view' }, @{ scrollable = $true; responds = $false; failure = 'remained offscreen' })) {
  $control = New-FenControl $fen $true 'fen-output' $case.scrollable $case.responds
  Reset-Case $control
  $failure = $null
  try { [void](Get-ProbeVisibleFen) } catch { $failure = $_.Exception.Message }
  if (-not $failure -or $failure -notlike "*$($case.failure)*" -or $script:probeUiActions[-1].result -cne 'failed') { throw "Unobservable FEN incorrectly accepted: $failure" }
  if (-not $case.responds -and ($control.scrolls -ne 1 -or $script:lastWaitSeconds -ne 5)) { throw 'Failed visibility verification retried input or had an unbounded wait' }
  Write-Output "PASS offscreen FEN fails closed when it $($case.failure)"
}

Reset-Case @((New-FenControl $fen), (New-FenControl ($fen -replace ' w ', ' b ')))
$failure = $null
try { [void](Get-ProbeVisibleFen) } catch { $failure = $_.Exception.Message }
if ($failure -cne 'Visible current board FEN is ambiguous.') { throw 'Two visible source FEN outputs were accepted' }
Write-Output 'PASS ambiguous source FEN outputs rejected'
$caseCount = 8

# The real ARM64 VM omitted ClassName. Identity must survive that platform
# mapping, while the actual field value must be read anew after board changes.
$emptyClass = New-FenControl $fen $true ''
Reset-Case $emptyClass
$observed = Get-ProbeVisibleFen
if (-not $observed -or $observed.fen -cne $fen -or $emptyClass.scrolls -ne 1 -or
    $observed.control.className -cne '' -or $observed.source -cne 'exact_current_fen_value_pattern' -or
    $observed.readOnly -ne $true) { throw 'Exact read-only FEN field with empty ClassName was not observed' }
Write-Output 'PASS empty-class current FEN field is identified, scrolled and read'
$caseCount++
$changedFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1'
$emptyClass.ValuePattern.Value = $changedFen
$observed = Get-ProbeVisibleFen
if (-not $observed -or $observed.fen -cne $changedFen -or $emptyClass.scrolls -ne 1) { throw 'Current FEN observation retained an old field value' }
Write-Output 'PASS same current FEN field is reread after its value changes'
$caseCount++

foreach ($wrong in @(
  @{ name = '匯入 FEN'; kind = [System.Windows.Automation.ControlType]::Edit },
  @{ name = "目前 FEN $fen"; kind = [System.Windows.Automation.ControlType]::StatusBar },
  @{ name = '目前 FEN'; kind = [System.Windows.Automation.ControlType]::StatusBar },
  @{ name = '目前 FEN'; kind = [System.Windows.Automation.ControlType]::Text },
  @{ name = $fen; kind = [System.Windows.Automation.ControlType]::Text }
)) {
  $control = New-FenControl $fen $true 'fen-output' $true $true $fen -Name $wrong.name -Kind $wrong.kind
  Reset-Case $control
  if ((Get-ProbeVisibleFen) -or $control.scrolls -ne 0 -or $control.bound -ne $null -or $control.valueReads -ne 0) { throw 'Misleading label, status or unrelated FEN was read or operated' }
  Write-Output 'PASS misleading role/name cannot identify the current FEN'
  $caseCount++
}

foreach ($useValue in @($true, $false)) {
  foreach ($readOnly in @($false, $null, 'True', [System.Windows.Automation.AutomationElement]::NotSupported)) {
    $control = New-FenControl $fen $true '' $true $true $fen $readOnly $useValue
    Reset-Case $control
    if ((Get-ProbeVisibleFen) -or $control.scrolls -ne 0 -or $control.bound -ne $null) { throw 'Writable or unknown-read-only field was scrolled or accepted' }
    Write-Output 'PASS writable or unproven read-only field rejected before scrolling'
    $caseCount++
  }
}

$text = New-FenControl '' $true '' $true $true "$fen`r`n" $true $false
Reset-Case $text
$observed = Get-ProbeVisibleFen
if (-not $observed -or $observed.fen -cne $fen -or $text.bound -ne 257 -or
    $text.readOnlyReads -ne 2 -or $observed.source -cne 'exact_current_fen_text_pattern') { throw 'Exact full read-only TextPattern fallback failed' }
Write-Output 'PASS empty-class TextPattern proves read-only and reads the exact whole FEN'
$caseCount++

foreach ($invalidFen in @(
  '9 w - - 0 1',
  '8/9/9/9/9/9/9/9/9/9 w - - 0 1',
  '99/9/9/9/9/9/9/9/9/9 w - - 0 1',
  "Current board: $fen",
  "$fen extra",
  ($fen + (' ' * 256) + 'another value')
)) {
  foreach ($useValue in @($true, $false)) {
    $control = New-FenControl $invalidFen $false '' $true $true $invalidFen $true $useValue
    Reset-Case $control
    if (Get-ProbeVisibleFen) { throw 'Malformed, embedded or truncated FEN was accepted' }
    Write-Output 'PASS malformed, embedded or oversized FEN rejected'
    $caseCount++
  }
}

Reset-Case @((New-FenControl $fen $false ''), (New-FenControl 'invalid' $true ''))
$failure = $null
try { [void](Get-ProbeVisibleFen) } catch { $failure = $_.Exception.Message }
if ($failure -cne 'Visible current board FEN is ambiguous.' -or @($script:controls | Where-Object { $_.scrolls -gt 0 -or $_.valueReads -gt 0 }).Count) { throw 'Duplicate current FEN identity was read or scrolled before rejection' }
Write-Output 'PASS duplicate field identity rejected before reading or scrolling either field'
$caseCount++
Write-Output "$caseCount/$caseCount offline FEN cases passed; actual packaged VM scrolling and saved-position restoration remain separate gates."
