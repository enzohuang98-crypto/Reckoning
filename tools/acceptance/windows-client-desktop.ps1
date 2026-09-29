param([Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Desktop preparation is restricted to the ephemeral hosted VM.'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$report = [ordered]@{
  capturedAtUtc = [DateTime]::UtcNow.ToString('o'); runId = $env:GITHUB_RUN_ID
  sourceCommit = (git rev-parse HEAD).Trim(); status = 'not_run'; observations = @(); actions = @()
}
try {
  # This is the privacy wizard actually captured on run 36322875290. Never
  # operate an account, licence, UAC, sign-in, or other first-run screen.
  for ($page = 0; $page -lt 6; $page++) {
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $windows = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $privacyWindow = $null
    $privacyControls = @()
    foreach ($candidate in $windows) {
      $controls = @($candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
      $names = @($controls | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
      $report.observations += @{
        page = $page; title = $candidate.Current.Name
        controls = @($controls | Select-Object -First 180 | ForEach-Object { @{ name = $_.Current.Name; type = $_.Current.ControlType.ProgrammaticName; automationId = $_.Current.AutomationId } })
      }
      if (@($names | Where-Object { $_ -eq 'Choose privacy settings for your device' }).Count -gt 0 -or $candidate.Current.Name -eq 'Choose privacy settings for your device') {
        $privacyWindow = $candidate; $privacyControls = $controls
      }
    }
    if (-not $privacyWindow) {
      $report.status = if ($page -eq 0) { 'privacy_wizard_not_present' } else { 'privacy_wizard_dismissed' }
      break
    }
    $changes = 0
    foreach ($control in $privacyControls) {
      # Only optional privacy switches exposed by the identified privacy page.
      # Unsupported custom controls are recorded, never clicked by guesswork.
      $toggle = $null
      if ($control.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$toggle)) {
        if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) {
          $toggle.Toggle()
          if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::Off) { throw 'Privacy switch did not settle to Off.' }
          $report.actions += @{ page = $page; control = $control.Current.Name; action = 'optional_privacy_off' }
          $changes++
        }
      } elseif ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton -and $control.Current.Name -eq 'No') {
        $selection = $null
        if ($control.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)) {
          $selection.Select()
          if (-not $selection.Current.IsSelected) { throw 'Privacy No option was not selected.' }
          $report.actions += @{ page = $page; control = 'No'; action = 'optional_privacy_no' }
          $changes++
        }
      }
    }
    $next = @($privacyControls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -eq 'Next' })
    $accept = @($privacyControls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -eq 'Accept' })
    $button = if ($next.Count -eq 1) { $next[0] } elseif ($accept.Count -eq 1) { $accept[0] } else { $null }
    if (-not $button) { throw 'Identified privacy wizard has no unique Next or Accept button; inspect captured controls.' }
    # Do not accept unmodified enabled privacy controls which expose no supported
    # UIA pattern. A visible Yes option must be handled explicitly before action.
    $remainingYes = @($privacyControls | Where-Object {
      if ($_.Current.Name -ne 'Yes' -or $_.Current.IsOffscreen) { return $false }
      $selected = $null
      if ($_.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selected)) {
        return $selected.Current.IsSelected
      }
      return $true
    })
    if ($remainingYes.Count -gt 0) { throw 'Privacy Yes controls remain enabled or unclassified; inspect recorded controls before accepting.' }
    $invoke = $null
    if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { throw 'Privacy navigation does not expose InvokePattern.' }
    $report.actions += @{ page = $page; control = $button.Current.Name; action = 'invoke_privacy_navigation' }
    $invoke.Invoke()
    Start-Sleep -Seconds 2
  }
  if ($report.status -eq 'not_run') { throw 'Privacy wizard did not finish within six bounded pages.' }
} catch {
  $report.status = 'failed'; $report.failure = $_.Exception.Message
  throw
} finally {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen = [Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object Drawing.Bitmap($screen.Width, $screen.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $screen.Size)
      $screenshotPath = [IO.Path]::ChangeExtension($OutputPath, '.png')
      $bitmap.Save($screenshotPath, [Drawing.Imaging.ImageFormat]::Png)
      $report.desktopScreenshot = [IO.Path]::GetFileName($screenshotPath)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  } catch { $report.screenshotFailure = $_.Exception.Message }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}
