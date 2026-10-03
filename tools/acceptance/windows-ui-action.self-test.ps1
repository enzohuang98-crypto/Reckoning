param([string]$SourcePath = (Join-Path $PSScriptRoot 'windows-packaged-ui.ps1'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($SourcePath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Source parse failed' }
foreach ($name in @('Get-ProbeControlDiagnostic', 'Find-ProbeAction', 'Show-ProbeControl', 'Invoke-ProbeAction')) {
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $function) { throw "Source missing $name" }
  Invoke-Expression $function.Extent.Text
}
# These are offline fixtures at the Windows UIA boundary. No native window,
# focus, pointer, keyboard, renderer, or application IPC is used.
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
$script:guessName = [string]([char]0x731C) + [char]0x8457
function New-GuessControl([string]$State = 'Off', [string]$Id = 'analysis-tab-guess', [string]$Class = 'inspector-tab', [bool]$Responds = $true) {
  $pattern = [pscustomobject]@{
    Current = [pscustomobject]@{ ToggleState = [System.Windows.Automation.ToggleState]::$State }
    toggles = 0; responds = $Responds
  }
  $pattern | Add-Member ScriptMethod Toggle {
    $this.toggles++
    if ($this.responds) { $this.Current.ToggleState = [System.Windows.Automation.ToggleState]::On }
  }
  $control = [pscustomobject]@{
    Current = [pscustomobject]@{
      Name = $script:guessName; ControlType = [System.Windows.Automation.ControlType]::Button
      AutomationId = $Id; ClassName = $Class; IsEnabled = $true; IsOffscreen = $false
    }
    Pattern = $pattern
  }
  $control | Add-Member ScriptMethod GetSupportedPatterns { return @([System.Windows.Automation.TogglePattern]::Pattern, [System.Windows.Automation.ScrollItemPattern]::Pattern) }
  $control | Add-Member ScriptMethod TryGetCurrentPattern {
    param($id, $target)
    if ($id -eq [System.Windows.Automation.TogglePattern]::Pattern) { $target.Value = $this.Pattern; return $true }
    $target.Value = $null; return $false
  }
  return $control
}
function Reset-Case($Control) {
  $script:controls = @($Control); $script:probeUiActions = @(); $script:foregroundChecks = 0
}
$observed = New-GuessControl
Reset-Case $observed
Invoke-ProbeAction $script:guessName
if ($observed.Pattern.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On -or
    $observed.Pattern.toggles -ne 1 -or $script:probeUiActions[-1].result -ne 'completed' -or
    $script:probeUiActions[-1].method -ne 'UIA_Toggle' -or $script:lastWaitSeconds -ne 5 -or
    $script:foregroundChecks -ne 1) { throw 'Observed pressed button did not open and verify the guessing view' }
Write-Output 'PASS actual VM TogglePattern fixture opens the guessing view'

$selected = New-GuessControl -State On -Class 'inspector-tab active'
Reset-Case $selected
Invoke-ProbeAction $script:guessName
if ($selected.Pattern.toggles -ne 0 -or $script:probeUiActions[-1].result -ne 'completed') {
  throw 'Already selected guessing view was toggled closed'
}
Write-Output 'PASS already selected source button stays open'

function Assert-Rejected($Control, [string]$ExpectedFailure, [bool]$Recorded = $true) {
  Reset-Case $Control
  $failure = $null
  try { Invoke-ProbeAction $script:guessName } catch { $failure = $_.Exception.Message }
  if (-not $failure -or $failure -notlike "*$ExpectedFailure*" -or $Control.Pattern.toggles -ne 0) {
    throw "Invalid UI control was operated or incorrectly accepted: $failure"
  }
  if ($Recorded -and $script:probeUiActions[-1].result -ne 'failed') { throw 'Failure was not recorded' }
  if (-not $Recorded -and $script:probeUiActions.Count -ne 0) { throw 'Unusable control was recorded as an action' }
}
Assert-Rejected (New-GuessControl -Id 'another-button') 'lacks a supported source-matched UIA action'
Write-Output 'PASS same-name button with another automation ID rejected'
Assert-Rejected (New-GuessControl -Class 'not-inspector-tab') 'lacks a supported source-matched UIA action'
Write-Output 'PASS same-name button with unrelated source class rejected'
Assert-Rejected (New-GuessControl -State Indeterminate) 'unsupported pressed state'
Write-Output 'PASS indeterminate toggle state rejected without input'

$unresponsive = New-GuessControl -Responds $false
Reset-Case $unresponsive
$failure = $null
try { Invoke-ProbeAction $script:guessName } catch { $failure = $_.Exception.Message }
if (-not $failure -or $failure -notlike '*did not become selected*' -or
    $unresponsive.Pattern.toggles -ne 1 -or $script:lastWaitSeconds -ne 5 -or
    $script:probeUiActions[-1].result -ne 'failed') { throw 'Unchanged view was accepted or input repeated' }
Write-Output 'PASS nonresponsive toggle fails bounded verification without repeated input'

$disabled = New-GuessControl
$disabled.Current.IsEnabled = $false
Assert-Rejected $disabled 'missing or disabled' $false
Write-Output 'PASS disabled source button rejected before input'

$unsupported = New-GuessControl
$unsupported | Add-Member ScriptMethod TryGetCurrentPattern { param($id, $target) $target.Value = $null; return $false } -Force
Assert-Rejected $unsupported 'lacks a supported source-matched UIA action'
Write-Output 'PASS source button without a supported pattern rejected'

$ordinary = New-GuessControl -Id '' -Class 'nav-btn'
$ordinary.Current.Name = 'ordinary-navigation'
$ordinary.Pattern | Add-Member NoteProperty invokes 0
$ordinary.Pattern | Add-Member ScriptMethod Invoke { $this.invokes++ }
$ordinary | Add-Member ScriptMethod TryGetCurrentPattern {
  param($id, $target)
  if ($id -eq [System.Windows.Automation.InvokePattern]::Pattern) { $target.Value = $this.Pattern; return $true }
  $target.Value = $null; return $false
} -Force
Reset-Case $ordinary
Invoke-ProbeAction 'ordinary-navigation'
if ($ordinary.Pattern.invokes -ne 1 -or $ordinary.Pattern.toggles -ne 0 -or
    $script:probeUiActions[-1].method -ne 'UIA_Invoke' -or $script:probeUiActions[-1].result -ne 'completed') {
  throw 'Normal InvokePattern navigation regressed'
}
Write-Output 'PASS ordinary InvokePattern navigation remains usable'
Write-Output '9/9 offline action cases passed; actual packaged VM input remains a separate gate.'
