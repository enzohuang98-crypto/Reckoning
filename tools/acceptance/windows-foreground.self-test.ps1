param([string]$SourcePath = (Join-Path $PSScriptRoot 'windows-packaged-ui.ps1'))
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($SourcePath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Source parse failed.' }
foreach ($name in @('Test-ProbeWslPromptText', 'Test-ProbeWslPromptIdentity', 'Try-CancelProbeWslPrompt', 'Assert-ProbeForeground')) {
  $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($function) { Invoke-Expression $function.Extent.Text }
}
# This is an inert fake. It deliberately has no DllImport/native API calls.
Add-Type -TypeDefinition @'
using System;
public static class UpdateProbeWindow {
  public static long Foreground = 202;
  public static bool Blocked = true, EscapeWorks = true;
  public static int Escapes = 0, Clicks = 0;
  public static IntPtr GetForegroundWindow() { return new IntPtr(Foreground); }
  public static bool SetForegroundWindow(IntPtr window) { if (!Blocked) Foreground = window.ToInt64(); return !Blocked; }
  public static bool Click(int x, int y) { Clicks++; if (!Blocked) Foreground = 101; return true; }
  public static bool EscapeForForeground(IntPtr window) {
    if (Foreground != window.ToInt64()) return false;
    Escapes++; if (EscapeWorks) Blocked = false; return true;
  }
}
'@
function Get-ProbeWindow {
  $window = [pscustomobject]@{ Current = [pscustomobject]@{ NativeWindowHandle = 101; BoundingRectangle = [pscustomobject]@{ Left=0; Top=0; Width=1024; Height=720 } } }
  $window | Add-Member ScriptMethod SetFocus { }
  return $window
}
function Wait-Probe([scriptblock]$Condition, [string]$Message, [int]$Seconds) {
  for ($i = 0; $i -lt 2; $i++) { $result = & $Condition; if ($result) { return $result } }
  throw $Message
}
function Get-ProbeForegroundObservation {
  $script:observations++
  if ($script:changedWindow -and $script:observations -ge 2) { [UpdateProbeWindow]::Foreground = 303 }
  if ([UpdateProbeWindow]::Foreground -eq 101) { return @{ handle=101; processId=10; processName='probe'; trustedWslPrompt=$false } }
  if ([UpdateProbeWindow]::Foreground -ne 202) { return @{ handle=303; processId=30; processName='other'; trustedWslPrompt=$false } }
  return $script:foregroundObservation
}
function Reset-ForegroundCase {
  [UpdateProbeWindow]::Foreground = 202; [UpdateProbeWindow]::Blocked = $true; [UpdateProbeWindow]::EscapeWorks = $true
  [UpdateProbeWindow]::Escapes = 0; [UpdateProbeWindow]::Clicks = 0
  $script:probeFocusClicks = 0; $script:probeWslCancelCount = 0; $script:probeUiActions = @()
  $script:observations = 0; $script:changedWindow = $false
  $script:foregroundObservation = @{ handle=202; processId=20; processName='WindowsTerminal'; trustedWslPrompt=$true; exactPrompt=$true }
}
$savedActions = $env:GITHUB_ACTIONS; $savedEnvironment = $env:RUNNER_ENVIRONMENT; $savedRunId = $env:GITHUB_RUN_ID
try {
  $terminal = Join-Path $env:ProgramFiles 'WindowsApps\Microsoft.WindowsTerminal_1.22.10731.0_arm64__8wekyb3d8bbwe\WindowsTerminal.exe'
  $title = Join-Path $env:WINDIR 'system32\wsl.exe'
  $subject = 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'
  if (-not (Test-ProbeWslPromptIdentity $terminal 'Valid' $subject $title)) { throw 'Exact protected signed terminal identity rejected.' }
  if (-not (Test-ProbeWslPromptIdentity $terminal 'Valid' $subject "Administrator: $title")) { throw 'Exact elevated terminal title rejected.' }
  foreach ($case in @(
    @{ path=$terminal; status='NotSigned'; subject=$subject; title=$title },
    @{ path=$terminal; status='Valid'; subject='O=Unknown Publisher'; title=$title },
    @{ path=$terminal; status='Valid'; subject=$subject; title='User Account Control' },
    @{ path=$terminal; status='Valid'; subject=$subject; title='Windows Security' },
    @{ path=$terminal; status='Valid'; subject=$subject; title='Windows protected your PC' },
    @{ path=$terminal; status='Valid'; subject=$subject; title='Microsoft Account sign in' },
    @{ path=(Join-Path ([IO.Path]::GetTempPath()) 'WindowsTerminal.exe'); status='Valid'; subject=$subject; title=$title },
    @{ path=$terminal.Replace('8wekyb3d8bbwe', 'untrusted'); status='Valid'; subject=$subject; title=$title }
  )) {
    if (Test-ProbeWslPromptIdentity $case.path $case.status $case.subject $case.title) { throw 'Unknown process, publisher or security title was trusted.' }
  }
  Write-Output 'PASS exact Microsoft terminal identity and elevation title; eight publisher/path/security-window negatives rejected'
  $prompt = "Windows Subsystem for Linux must be updated to the latest version to proceed. You can update by running 'wsl.exe --update'. For more information please visit https://aka.ms/wslinstall Press any key to install Windows Subsystem for Linux. Press ESC or CTRL-C to cancel. This prompt will time out in 60 seconds."
  if (-not (Test-ProbeWslPromptText $prompt.Replace('wsl.exe', "wsl.e`r`nxe"))) { throw 'Observed terminal line wrapping rejected.' }
  foreach ($text in @('Press ESC or CTRL-C to cancel.', ($prompt + ' Windows Security: enter password'), $prompt.Replace('60 seconds', '30 seconds'), $prompt.Replace('Windows Subsystem for Linux.', 'another program.'), ($prompt + (' ' * 4097)))) {
    if (Test-ProbeWslPromptText $text) { throw 'Partial, changed or additional prompt text was accepted.' }
  }
  Write-Output 'PASS exact wrapped prompt; five partial/changed/security/oversized text negatives rejected'
  $env:GITHUB_ACTIONS = 'true'; $env:RUNNER_ENVIRONMENT = 'github-hosted'; $env:GITHUB_RUN_ID = '12345'
  Reset-ForegroundCase
  Assert-ProbeForeground
  if ([UpdateProbeWindow]::Escapes -ne 1 -or [UpdateProbeWindow]::Foreground -ne 101) { throw 'Observed WSL cancellation did not restore actual App foreground.' }
  Write-Output 'PASS exact observed WSL prompt receives one cancel and App foreground is verified'
  foreach ($case in @('unknown-window', 'changed-window', 'non-hosted', 'cancel-ineffective', 'already-attempted')) {
    Reset-ForegroundCase
    if ($case -eq 'unknown-window') { $script:foregroundObservation.trustedWslPrompt = $false }
    if ($case -eq 'changed-window') { $script:changedWindow = $true }
    if ($case -eq 'non-hosted') { $env:RUNNER_ENVIRONMENT = 'self-hosted' }
    if ($case -eq 'cancel-ineffective') { [UpdateProbeWindow]::EscapeWorks = $false }
    if ($case -eq 'already-attempted') { $script:probeWslCancelCount = 1 }
    $failure = $null
    try { Assert-ProbeForeground } catch { $failure = $_.Exception.Message }
    $expectedEscapes = if ($case -eq 'cancel-ineffective') { 1 } else { 0 }
    if (-not $failure -or [UpdateProbeWindow]::Escapes -ne $expectedEscapes -or [UpdateProbeWindow]::Foreground -eq 101) { throw "Unsafe foreground case accepted: $case" }
    if ($script:probeUiActions[-1].result -ne 'failed' -or -not $script:probeUiActions[-1].after) { throw 'Foreground failure lost observed identity diagnostics.' }
    $env:RUNNER_ENVIRONMENT = 'github-hosted'
    Write-Output "PASS $case fails without background acceptance or extra input"
  }
  Reset-ForegroundCase
  [UpdateProbeWindow]::Foreground = 101
  Assert-ProbeForeground
  if ([UpdateProbeWindow]::Escapes -ne 0 -or [UpdateProbeWindow]::Clicks -ne 0) { throw 'Already foreground App received unnecessary input.' }
  Write-Output 'PASS already foreground App uses no recovery input'
  Write-Output 'Offline foreground predicates and fake input only; real Windows VM recovery remains required.'
} finally {
  $env:GITHUB_ACTIONS = $savedActions; $env:RUNNER_ENVIRONMENT = $savedEnvironment; $env:GITHUB_RUN_ID = $savedRunId
}
