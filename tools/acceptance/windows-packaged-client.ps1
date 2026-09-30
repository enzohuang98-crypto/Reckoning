param([Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
# Deliberately refuse the user's workstation, even if accidentally invoked there.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This installer probe may run only in an ephemeral GitHub-hosted Windows client VM.'
}
$os = Get-CimInstance Win32_OperatingSystem
if ([int]$os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000) { throw 'Windows 11 client required.' }
$report = [ordered]@{
  capturedAtUtc = [DateTime]::UtcNow.ToString('o'); sourceCommit = (git rev-parse HEAD).Trim()
  runId = $env:GITHUB_RUN_ID; osCaption = [string]$os.Caption
  nativeArchitecture = $env:PROCESSOR_ARCHITECTURE
  architectureDifference = 'ARM64 client with x64 emulation; not native AMD64 hardware acceptance.'
  installer = 'not_run'; installedLaunch = 'not_run'; accessibleControls = @()
  observations = @(); launchProcessExited = $false
  settingsPersistence = 'not_run'; candidateBinaryAcceptance = 'not_run'
  realProviderAcceptance = 'not_run'; updaterInstallationAcceptance = 'not_run'
  unsignedSmartScreenLimitation = 'Unsigned test package; SmartScreen trust is not established.'
}
$launched = $null
try {
  $manifest = Get-Content -Raw -Encoding UTF8 release/isolated-package-manifest.json | ConvertFrom-Json
  if ($manifest.sourceCommit -ne $report.sourceCommit -or $manifest.productionRelease -ne $false -or $manifest.signature -ne 'NotSigned') {
    throw 'Artifact provenance does not match this isolated source checkout.'
  }
  foreach ($artifact in $manifest.artifacts) {
    if ([string]::IsNullOrWhiteSpace($artifact.name) -or [IO.Path]::GetFileName($artifact.name) -ne $artifact.name -or $artifact.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid artifact filename or SHA-256.' }
    $item = Get-Item -LiteralPath (Join-Path 'release' $artifact.name)
    if ($item.Length -ne $artifact.size -or (Get-FileHash $item.FullName -Algorithm SHA256).Hash -ne $artifact.sha256) {
      throw 'Downloaded artifact hash or size mismatch.'
    }
  }
  $setupName = "xiangqi-analyzer-$($manifest.version)-setup.exe"
  $setup = @($manifest.artifacts | Where-Object name -eq $setupName)
  if ($setup.Count -ne 1) { throw 'Missing unique installer manifest entry.' }
  # Existing installer checks include pristine data, exact version, registry,
  # real bundled engine/NNUE, unsigned status and both shortcut targets.
  # The existing smoke script is UTF-8 without BOM. PowerShell 7 preserves its
  # Chinese executable paths; Windows PowerShell 5 would decode those as ANSI.
  & pwsh.exe -NoProfile -ExecutionPolicy Bypass -File tools/release/smoke-installer.ps1 -Phase Install -AllowUnsigned -ExpectedSha256 ($setup[0].sha256)
  if ($LASTEXITCODE -ne 0) { throw 'Actual installer acceptance failed.' }
  $report.installer = 'passed'
  $report.installerSha256 = $setup[0].sha256
  $exe = Join-Path $env:LOCALAPPDATA 'Programs\xiangqi-analyzer\象棋AI分析講解.exe'
  $report.installedVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  $report.installedPath = $exe
  $feed = Get-Content -Raw -LiteralPath (Join-Path (Split-Path $exe) 'resources\app-update.yml')
  if ($feed -notmatch '(?m)^provider:\s*generic\s*$' -or $feed -notmatch 'http://127\.0\.0\.1:18765/') {
    throw 'Installed test package is not isolated from the production updater feed.'
  }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  # This is the interactive application under UI test, not a background helper.
  # SW_HIDE can suppress its first ShowWindow call and invalidate UI discovery.
  $launched = Start-Process -FilePath $exe -ArgumentList '--force-renderer-accessibility' -WindowStyle Normal -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $window = $null
  $uiPassed = $false
  $nextObservation = [DateTime]::MinValue
  do {
    $launched.Refresh()
    $report.launchProcessExited = $launched.HasExited
    if ($launched.HasExited) { $report.launchProcessExitCode = $launched.ExitCode }
    # NSIS may already have launched the single-instance application. Associate
    # windows with verified executable paths, not only Start-Process's PID.
    $appProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
    $observedWindows = @()
    foreach ($appProcess in $appProcesses) {
      $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $appProcess.Id)
      $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
      foreach ($candidate in $windows) {
        $controls = $candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $names = @($controls | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Unique -First 150)
        $observedWindows += @{ processId = $appProcess.Id; title = $candidate.Current.Name; className = $candidate.Current.ClassName; names = $names }
        $report.accessibleControls = @($report.accessibleControls + $names | Select-Object -Unique -First 150)
        # A crash dialog or empty Chromium frame cannot satisfy UI acceptance.
        $hasAnalysis = @($names | Where-Object { $_ -match '分析' }).Count -gt 0
        $hasSettings = @($names | Where-Object { $_ -match '設定' }).Count -gt 0
        $hasStartupFailure = @($names | Where-Object { $_ -match '啟動失敗|無法啟動' }).Count -gt 0
        if ($hasAnalysis -and $hasSettings -and -not $hasStartupFailure) {
          $window = $candidate; $uiPassed = $true; $report.windowProcessId = $appProcess.Id
        }
      }
    }
    if ([DateTime]::UtcNow -ge $nextObservation -or $uiPassed) {
      $report.observations += @{
        capturedAtUtc = [DateTime]::UtcNow.ToString('o')
        processes = @($appProcesses | ForEach-Object { @{ id = $_.Id; path = $_.Path; mainWindowHandle = $_.MainWindowHandle.ToInt64(); mainWindowTitle = $_.MainWindowTitle; sessionId = $_.SessionId } })
        windows = $observedWindows
      }
      $nextObservation = [DateTime]::UtcNow.AddSeconds(5)
    }
    if ($uiPassed) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not $uiPassed) { throw 'Installed native UI did not expose analysis and settings controls within 45 seconds; see recorded process/window observations.' }
  $report.installedLaunch = 'passed'
  $report.nativeAccessibilityTree = 'passed'
  # Control discovery is recorded first; do not invent a settings click or count
  # a process start as model switching, persistence, AI, or updater acceptance.
} catch {
  $report.failure = $_.Exception.Message
  throw
} finally {
  # Fresh ephemeral VM only; no user credentials or data exist on this desktop.
  # Capture once before closing the app, including failed startup evidence.
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
  if ($launched -and -not $launched.HasExited) {
    [void]$launched.CloseMainWindow()
    if (-not $launched.WaitForExit(10000)) { Stop-Process -Id $launched.Id -Force }
  }
}
