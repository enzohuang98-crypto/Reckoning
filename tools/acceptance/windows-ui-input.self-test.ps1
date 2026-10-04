param([string]$SourcePath = (Join-Path $PSScriptRoot 'windows-packaged-ui.ps1'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($SourcePath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Source parse failed' }
foreach ($name in @('Get-ProbeInputControls', 'Get-ProbeControlDiagnostic', 'Set-ProbeInput')) {
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $function) { throw "Source missing $name" }
  Invoke-Expression $function.Extent.Text
}
# Offline UIA objects only; no native window, input, renderer or real IPC.
function Assert-ProbeForeground { $script:foregroundChecks++ }
function Show-ProbeControl($Control, [string]$Name) { $script:revealed = $Control }
function Get-ProbeControls { throw 'Input lookup performed a full descendant scan.' }
function Wait-Probe([scriptblock]$Condition, [string]$Message, [int]$Seconds) {
  for ($i = 0; $i -lt 3; $i++) { $result = & $Condition; if ($result) { return $result } }
  throw $Message
}
function Get-ProbeWindow { return $script:window }
function New-Input([int]$Id = 1, [string]$Name = 'draft', [bool]$Enabled = $true, [bool]$ReadOnly = $false) {
  $pattern = [pscustomobject]@{ Current = [pscustomobject]@{ IsReadOnly = $ReadOnly; Value = '' }; writes = 0 }
  $pattern | Add-Member ScriptMethod SetValue { param($value) $this.writes++; $script:pendingValue = $value }
  $control = [pscustomobject]@{
    Current = [pscustomobject]@{ Name = $Name; ControlType = [System.Windows.Automation.ControlType]::Edit; IsEnabled = $Enabled; IsOffscreen = $false; AutomationId = 'input'; ClassName = 'text-input' }
    Pattern = $pattern; id = $Id
  }
  $control | Add-Member ScriptMethod GetRuntimeId { return @($this.id) }
  $control | Add-Member ScriptMethod GetSupportedPatterns { return @([System.Windows.Automation.ValuePattern]::Pattern) }
  $control | Add-Member ScriptMethod TryGetCurrentPattern { param($id, $target) $target.Value = $this.Pattern; return $true }
  return $control
}
function Reset-InputCase($Controls, [string]$Mode = 'normal') {
  $script:controls = @($Controls); $script:mode = $Mode; $script:queries = 0
  $script:probeUiActions = @(); $script:foregroundChecks = 0; $script:revealed = $null; $script:pendingValue = $null
  $script:window = [pscustomobject]@{}
  $script:window | Add-Member ScriptMethod FindAll {
    param($scope, $condition)
    if ($scope -ne [System.Windows.Automation.TreeScope]::Descendants -or $condition -isnot [System.Windows.Automation.AndCondition]) { throw 'Input search did not use a native UIA predicate.' }
    $properties = @{}
    foreach ($part in $condition.GetConditions()) {
      if ($part -isnot [System.Windows.Automation.PropertyCondition] -or $part.Flags -ne [System.Windows.Automation.PropertyConditionFlags]::None) { throw 'Input predicate is not exact.' }
      $properties[$part.Property.ProgrammaticName] = $part.Value
    }
    if ($properties.Count -ne 3 -or
        $properties['AutomationElementIdentifiers.ControlTypeProperty'] -ne [System.Windows.Automation.ControlType]::Edit.Id -or
        $properties['AutomationElementIdentifiers.NameProperty'] -cne 'draft' -or
        $properties['AutomationElementIdentifiers.IsEnabledProperty'] -ne $true) { throw 'Input predicate omitted role, exact name or enabled state.' }
    $script:queries++
    if ($script:queries -gt 1) {
      if ($script:mode -eq 'replacement') { $script:controls[0].id = 2 }
      if ($script:mode -eq 'duplicate' -and $script:queries -eq 2) { $script:controls += New-Input -Id 2 }
      if ($script:mode -ne 'unretained') { foreach ($field in $script:controls) { $field.Pattern.Current.Value = $script:pendingValue } }
    }
    return @($script:controls | Where-Object { $_.Current.Name -ceq 'draft' -and $_.Current.IsEnabled })
  }
}
$field = New-Input
Reset-InputCase @($field, (New-Input -Id 8 -Name 'unrelated'), (New-Input -Id 9 -Enabled $false))
Set-ProbeInput 'draft' 'new draft'
if ($field.Pattern.writes -ne 1 -or $script:queries -ne 2 -or $script:foregroundChecks -ne 1 -or
    $script:revealed -ne $field -or $script:probeUiActions[-1].result -ne 'completed' -or
    $script:probeUiActions[-1].immediatelyMatched -ne $false -or -not $script:probeUiActions[-1].completedAt) {
  throw 'Exact input was not revealed, entered once and verified after accessibility lag.'
}
Write-Output 'PASS scoped native UIA input lookup and same-control verification tolerate accessibility lag'
foreach ($mode in @('replacement', 'duplicate', 'unretained')) {
  $field = New-Input
  Reset-InputCase @($field) $mode
  $failure = $null
  try { Set-ProbeInput 'draft' 'new draft' } catch { $failure = $_.Exception.Message }
  if (-not $failure -or $field.Pattern.writes -ne 1 -or $script:probeUiActions[-1].result -ne 'failed') { throw "Unsafe input verification passed: $mode" }
  Write-Output "PASS input $mode fails without repeated input"
}
foreach ($fields in @(@((New-Input), (New-Input -Id 2)), @((New-Input -Enabled $false)), @((New-Input -ReadOnly $true)))) {
  Reset-InputCase $fields
  $failure = $null
  try { Set-ProbeInput 'draft' 'new draft' } catch { $failure = $_.Exception.Message }
  if (-not $failure -or @($fields | Where-Object { $_.Pattern.writes -ne 0 }).Count) { throw 'Ambiguous, disabled or read-only input received an action.' }
}
Write-Output 'PASS ambiguous, disabled and read-only inputs rejected before input'
Write-Output '7/7 offline input cases passed; actual packaged VM input remains a separate gate.'
