# Dot-sourced only by the isolated packaged updater exercise. Normal UIA input;
# no remote-debugging port, renderer evaluation, IPC injection or user secrets.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UpdateProbeWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Mouse mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union data; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
  public static bool Click(int x, int y) {
    if (!SetCursorPos(x, y)) return false;
    var down = new Input(); down.data.mouse.flags = 2;
    var up = new Input(); up.data.mouse.flags = 4;
    return SendInput(2, new [] { down, up }, Marshal.SizeOf(typeof(Input))) == 2;
  }
}
'@
$script:probeFocusClicks = 0
$script:probeUiActions = @()
function Get-ProbeControlDiagnostic($Control) {
  try {
    $current = $Control.Current
    return @{
      name = $current.Name; type = $current.ControlType.ProgrammaticName
      automationId = $current.AutomationId; className = $current.ClassName
      enabled = $current.IsEnabled; offscreen = $current.IsOffscreen
      supportedPatterns = @($Control.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
    }
  } catch { return @{ diagnosticFailure = $_.Exception.Message } }
}
function Wait-Probe([scriptblock]$Condition, [string]$Message, [int]$Seconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $result = & $Condition
    if ($result) { return $result }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $Message
}
function Get-ProbeWindow {
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $script:probeExe })) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    foreach ($window in $windows) {
      if ($window.Current.Name -ceq '象棋 AI 分析講解' -and $window.Current.NativeWindowHandle -ne 0) { return $window }
    }
  }
  return $null
}
function Get-ProbeControls {
  $window = Get-ProbeWindow
  if (-not $window) { return @() }
  return $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}
function Get-ProbeNames { return @(Get-ProbeControls | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) }
function Get-ProbeUiVersionObservation {
  $heading = '版本與自動更新'
  $versionPattern = 'v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'
  $versions = @(); $diagnostics = @(); $headingPresent = $false
  foreach ($control in Get-ProbeControls) {
    $current = $control.Current
    if ($current.IsOffscreen -or $current.ControlType -notin @([System.Windows.Automation.ControlType]::Text, [System.Windows.Automation.ControlType]::Group, [System.Windows.Automation.ControlType]::Pane, [System.Windows.Automation.ControlType]::StatusBar)) { continue }
    $name = ([string]$current.Name).Trim()
    $isBadge = [string]$current.ClassName -ceq 'badge plain'
    $isHeading = $name -ceq $heading -or $name -match ('^(?:APPLICATION UPDATE\s+)?' + [regex]::Escape($heading) + '(?:\s*' + $versionPattern + ')?$')
    if ($isHeading) { $headingPresent = $true }
    $version = $null; $source = $null
    if ($name -cmatch ('^目前版本 (' + $versionPattern + ')$')) {
      $version = $Matches[1]; $source = 'exact_accessible_current_version'
    } elseif (($current.ControlType -eq [System.Windows.Automation.ControlType]::Text -or $isBadge) -and $name -cmatch ('^' + $versionPattern + '$')) {
      $version = $name; $source = 'exact_static_text_name'
    } elseif ($isHeading -and $name -cmatch ('^(?:APPLICATION UPDATE\s+)?' + [regex]::Escape($heading) + '\s*(' + $versionPattern + ')$')) {
      $version = $Matches[1]; $source = 'exact_combined_update_heading'
    } elseif ($isBadge) {
      # Only the source-defined version badge may expose its read-only text.
      # Do not read arbitrary document or input values.
      $textPattern = $null
      if ($control.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
        $badgeText = ([string]$textPattern.DocumentRange.GetText(128)).Trim()
        if ($badgeText -cmatch ('^' + $versionPattern + '$')) { $version = $badgeText; $source = 'exact_badge_text_pattern' }
      }
    }
    if ($version) { $versions += $version }
    $tokens = @([regex]::Matches($name, '(?<![A-Za-z0-9.])v[0-9]+\.[0-9]+\.[0-9]+(?:[A-Za-z0-9.+-]*)') | ForEach-Object { $_.Value } | Select-Object -First 4)
    if ($isBadge -or $isHeading -or $tokens.Count) {
      $diagnostics += @{
        type = $current.ControlType.ProgrammaticName; className = $current.ClassName
        nameLength = $name.Length; containsUpdateHeading = $name.Contains($heading)
        versionNames = $tokens; recognizedVersion = $version; source = $source
      }
    }
  }
  return @{ headingPresent = $headingPresent; versions = @($versions | Select-Object -Unique); controls = @($diagnostics | Select-Object -First 12) }
}
function Assert-ProbeUiVersion([string]$Version, [string]$Stage) {
  if ($Version -cnotmatch '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$') { throw 'Expected package version is not an exact patch version.' }
  Assert-ProbeForeground
  $action = @{ at = [DateTime]::UtcNow.ToString('o'); requestedName = $Stage; method = 'UIA_TextVersion'; result = 'not_run'; observations = @() }
  $script:probeUiActions += $action
  try {
    [void](Wait-Probe {
      $observation = Get-ProbeUiVersionObservation
      $action.observations = @($action.observations | Select-Object -Last 3) + @($observation)
      return $observation.headingPresent -and $observation.versions.Count -eq 1 -and $observation.versions[0] -ceq "v$Version"
    } "$Stage UI did not expose one exact current version v$Version in the update section; see version observations." 10)
    $action.result = 'completed'
  } catch { $action.result = 'failed'; $action.failure = $_.Exception.Message; throw }
}
function Assert-ProbeForeground {
  $window = Wait-Probe { Get-ProbeWindow } 'Installed application window is missing.'
  if ([UpdateProbeWindow]::GetForegroundWindow().ToInt64() -ne [long]$window.Current.NativeWindowHandle) {
    [void][UpdateProbeWindow]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle)
    try { $window.SetFocus() } catch { }
    if ([UpdateProbeWindow]::GetForegroundWindow().ToInt64() -ne [long]$window.Current.NativeWindowHandle) {
      $bounds = $window.Current.BoundingRectangle
      if ($script:probeFocusClicks -ge 3 -or $bounds.Left -lt 0 -or $bounds.Top -lt 0 -or $bounds.Width -lt 400 -or $bounds.Height -lt 300) {
        throw 'The verified application window cannot be brought into the foreground.'
      }
      $script:probeFocusClicks++
      if (-not [UpdateProbeWindow]::Click([int]($bounds.Left + 80), [int]($bounds.Top + 12))) { throw 'App title-bar focus input failed.' }
    }
  }
  [void](Wait-Probe {
    $current = Get-ProbeWindow
    $current -and [UpdateProbeWindow]::GetForegroundWindow().ToInt64() -eq [long]$current.Current.NativeWindowHandle
  } 'An OS overlay still owns the foreground; no background UI acceptance is allowed.' 10)
}
function Find-ProbeAction([string]$Name, [switch]$Prefix) {
  foreach ($control in Get-ProbeControls) {
    $current = $control.Current
    if ($current.ControlType -notin @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::MenuItem)) { continue }
    if ($current.IsEnabled -and (($Prefix -and $current.Name.StartsWith($Name, [StringComparison]::Ordinal)) -or (-not $Prefix -and $current.Name -ceq $Name))) { return $control }
  }
  return $null
}
function Invoke-ProbeAction([string]$Name, [switch]$Prefix) {
  Assert-ProbeForeground
  $button = Wait-Probe { Find-ProbeAction $Name -Prefix:$Prefix } "Required action '$Name' is missing or disabled."
  if ($button.Current.IsOffscreen) {
    $scroll = $null
    if (-not $button.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scroll)) { throw "Offscreen action '$Name' cannot be scrolled into view." }
    $scroll.ScrollIntoView()
    [void](Wait-Probe { -not $button.Current.IsOffscreen } "Action '$Name' remained offscreen." 5)
  }
  $action = @{
    at = [DateTime]::UtcNow.ToString('o'); requestedName = $Name
    control = Get-ProbeControlDiagnostic $button; method = 'not_run'; result = 'not_run'
  }
  $script:probeUiActions += $action
  try {
    $pattern = $null
    if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $action.method = 'UIA_Invoke'
      $pattern.Invoke()
    } elseif ($button.Current.Name -ceq '猜著' -and
              $button.Current.AutomationId -ceq 'analysis-tab-guess' -and
              $button.Current.ClassName -cmatch '(?:^|\s)inspector-tab(?:\s|$)' -and
              $button.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
      # AnalysisInspectorTabs uses aria-pressed. Chromium exposes this exact
      # source button as TogglePattern, not InvokePattern. Open the guessing
      # view without toggling an already selected view back to the coach.
      $action.method = 'UIA_Toggle'
      if ($pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) {
        $pattern.Toggle()
      } elseif ($pattern.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) {
        throw "Observed action '$Name' has an unsupported pressed state."
      }
      [void](Wait-Probe {
        $pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
      } "Observed action '$Name' did not become selected." 5)
    } elseif ($button.Current.Name -ceq '局面工具' -and
              $button.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
      # Source ToolbarMenu uses <details><summary>, whose native action is
      # expansion. Only this exact observed source-backed menu may use it.
      $action.method = 'UIA_ExpandCollapse'
      if ($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) {
        $pattern.Expand()
      } elseif ($pattern.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) {
        throw "Observed menu '$Name' is not a supported collapsed/expanded summary."
      }
      [void](Wait-Probe {
        $pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded
      } "Observed menu '$Name' did not become expanded." 5)
    } else {
      throw "Action '$Name' lacks a supported source-matched UIA action; see recorded control patterns."
    }
    $action.result = 'completed'
  } catch {
    $action.result = 'failed'; $action.failure = $_.Exception.Message
    throw
  }
}
function Set-ProbeInput([string]$Name, [string]$Value) {
  Assert-ProbeForeground
  $field = Wait-Probe {
    $matches = @(Get-ProbeControls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name -ceq $Name -and $_.Current.IsEnabled })
    if ($matches.Count -gt 1) { throw "Input '$Name' is ambiguous." }
    if ($matches.Count -eq 1) { return $matches[0] }
  } "Required input '$Name' is missing."
  $pattern = $null
  if (-not $field.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -or $pattern.Current.IsReadOnly) { throw "Input '$Name' is not editable through UIA." }
  $runtimeId = $field.GetRuntimeId() -join '.'
  $action = @{
    at = [DateTime]::UtcNow.ToString('o'); requestedName = $Name
    control = Get-ProbeControlDiagnostic $field; method = 'UIA_Value'; result = 'not_run'
  }
  $script:probeUiActions += $action
  $started = [DateTime]::UtcNow
  try {
    $pattern.SetValue($Value)
    $action.immediatelyMatched = $pattern.Current.Value -ceq $Value
    # Chromium's accessibility value may lag the displayed controlled input.
    # Reacquire the same element/pattern; do not retry input or accept another field.
    [void](Wait-Probe {
      foreach ($candidate in Get-ProbeControls) {
        $current = $candidate.Current
        if ($current.ControlType -ne [System.Windows.Automation.ControlType]::Edit -or $current.Name -cne $Name -or
            -not $current.IsEnabled -or ($candidate.GetRuntimeId() -join '.') -cne $runtimeId) { continue }
        $freshPattern = $null
        if ($candidate.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$freshPattern) -and
            -not $freshPattern.Current.IsReadOnly -and $freshPattern.Current.Value -ceq $Value) { return $true }
      }
      return $false
    } "Input '$Name' did not retain its entered value on the same control." 5)
    $action.result = 'completed'
  } catch {
    $action.result = 'failed'; $action.failure = $_.Exception.Message
    throw
  } finally { $action.verificationMs = [int]([DateTime]::UtcNow - $started).TotalMilliseconds }
}
function Confirm-ProbeRestart {
  [void](Wait-Probe { (Get-ProbeNames -join ' ') -match '更新已準備完成。現在要先保存資料，再重新啟動 Reckoning 完成更新嗎' } 'Normal restart confirmation did not appear.' 10)
  $ok = Find-ProbeAction 'OK'
  if (-not $ok) { $ok = Find-ProbeAction '確定' }
  if (-not $ok) { throw 'Recognized normal restart dialog has no enabled confirmation button.' }
  $pattern = $null
  if (-not $ok.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { throw 'Restart confirmation lacks UIA Invoke support.' }
  $pattern.Invoke()
}
function Open-ProbeSystemSettings {
  Invoke-ProbeAction '設定'
  Invoke-ProbeAction '資料與系統' -Prefix
  [void](Wait-Probe { (Get-ProbeNames -join ' ') -match '版本與自動更新' } 'System update settings did not appear.')
}
function Start-ProbeApplication {
  $script:probeFocusClicks = 0
  if (-not (Get-ProbeWindow)) { [void](Start-Process -FilePath $script:probeExe -ArgumentList '--force-renderer-accessibility' -WindowStyle Normal -PassThru) }
  [void](Wait-Probe { Find-ProbeAction '分析' } 'Reopened packaged workspace did not become ready.' 60)
  Assert-ProbeForeground
}
function Close-ProbeApplication {
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $script:probeExe -and $_.MainWindowHandle -ne 0 })) {
    [void]$process.CloseMainWindow()
  }
  [void](Wait-Probe { -not @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $script:probeExe }).Count } 'Normal application exit did not complete.' 30)
}
function Save-ProbeScreen([string]$Label) {
  $screen = [Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object Drawing.Bitmap($screen.Width, $screen.Height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $screen.Size)
    $path = [IO.Path]::ChangeExtension($script:probeOutputPath, $null) + "-$Label.png"
    $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    return [IO.Path]::GetFileName($path)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
