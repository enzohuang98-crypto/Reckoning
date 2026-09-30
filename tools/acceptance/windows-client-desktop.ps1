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

# Some hosted images expose the privacy wizard as an empty UIA tree. Use the
# built-in, offline Windows OCR API on this pristine VM only. Every click comes
# from a fresh screenshot of the exact privacy heading and is verified by a new
# screenshot; there are no fixed coordinates, registry skips or account actions.
function Wait-WinRt($Operation, [Type]$ResultType) {
  $method = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })
  if ($method.Count -ne 1) { throw 'Cannot identify the Windows Runtime async adapter.' }
  $task = $method[0].MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  if (-not $task.Wait(10000)) { throw 'Offline Windows OCR operation timed out.' }
  return $task.GetAwaiter().GetResult()
}
function Find-PrivacySwitches($Bitmap) {
  if (-not ('HostedPrivacyPixels' -as [Type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Collections.Generic;
public static class HostedPrivacyPixels {
  // Bounded to the blue pill switches in the actually captured hosted privacy
  // layout. Navigation buttons, text links and the illustration do not fit.
  public static Rectangle[] Find(Bitmap image) {
    var found = new List<Rectangle>();
    int left = (int)(image.Width * .45), right = (int)(image.Width * .65);
    int top = 250, bottom = (int)(image.Height * .8);
    var visited = new bool[image.Width * image.Height];
    for (int y = top; y < bottom; y++) for (int x = left; x < right; x++) {
      int start = y * image.Width + x;
      if (visited[start]) continue;
      var queue = new Queue<Point>(); queue.Enqueue(new Point(x, y));
      int minX = x, maxX = x, minY = y, maxY = y, count = 0;
      while (queue.Count > 0) {
        var p = queue.Dequeue(); int index = p.Y * image.Width + p.X;
        if (visited[index]) continue; visited[index] = true;
        var c = image.GetPixel(p.X, p.Y);
        if (c.R > 30 || c.G < 85 || c.G > 180 || c.B < 150) continue;
        count++; minX = Math.Min(minX, p.X); maxX = Math.Max(maxX, p.X);
        minY = Math.Min(minY, p.Y); maxY = Math.Max(maxY, p.Y);
        if (p.X > left) queue.Enqueue(new Point(p.X - 1, p.Y));
        if (p.X + 1 < right) queue.Enqueue(new Point(p.X + 1, p.Y));
        if (p.Y > top) queue.Enqueue(new Point(p.X, p.Y - 1));
        if (p.Y + 1 < bottom) queue.Enqueue(new Point(p.X, p.Y + 1));
      }
      int width = maxX - minX + 1, height = maxY - minY + 1;
      if (width >= 30 && width <= 60 && height >= 12 && height <= 30 &&
          count > width * height * .35 && count < width * height * .95)
        found.Add(new Rectangle(minX, minY, width, height));
    }
    return found.ToArray();
  }
}
'@ -ReferencedAssemblies System.Drawing
  }
  return @([HostedPrivacyPixels]::Find($Bitmap) | ForEach-Object {
    @{ text = 'privacy_toggle'; x = $_.X; y = $_.Y; width = $_.Width; height = $_.Height }
  })
}
function Read-PrivacyScreenshot([int]$Page, [string]$Step) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
  $screen = [Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object Drawing.Bitmap($screen.Width, $screen.Height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $path = [IO.Path]::GetFullPath(([IO.Path]::ChangeExtension($OutputPath, $null) + "-privacy-$Page-$Step.png"))
  $ocrPath = [IO.Path]::ChangeExtension($path, 'ocr.png')
  try {
    $graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $screen.Size)
    $enabledSwitches = @(Find-PrivacySwitches $bitmap)
    $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    if ($screen.Width * 2 -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or
        $screen.Height * 2 -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) {
      throw 'Observed privacy layout is too large for the verified offline OCR scale.'
    }
    $scaled = New-Object Drawing.Bitmap(($screen.Width * 2), ($screen.Height * 2))
    $resize = [Drawing.Graphics]::FromImage($scaled)
    try {
      $resize.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $resize.DrawImage($bitmap, 0, 0, $scaled.Width, $scaled.Height)
      $scaled.Save($ocrPath, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $resize.Dispose(); $scaled.Dispose() }
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
  $file = Wait-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ocrPath)) ([Windows.Storage.StorageFile])
  $stream = Wait-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $software = $null
  try {
    $decoder = Wait-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $software = Wait-WinRt ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { throw 'No offline Windows OCR language is installed.' }
    $result = Wait-WinRt ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
    $lines = @($result.Lines | ForEach-Object { $_.Text })
    $lineBounds = @($result.Lines | ForEach-Object {
      $rectangles = @($_.Words | ForEach-Object { $_.BoundingRect })
      if ($rectangles.Count -gt 0) {
        @{ text = $_.Text; x = ($rectangles | Measure-Object -Property X -Minimum).Minimum / 2;
           y = ($rectangles | Measure-Object -Property Y -Minimum).Minimum / 2;
           bottom = (@($rectangles | ForEach-Object { $_.Y + $_.Height }) | Measure-Object -Maximum).Maximum / 2 }
      }
    })
    $words = @($result.Lines | ForEach-Object { $_.Words } | ForEach-Object {
      @{ text = $_.Text; x = $_.BoundingRect.X / 2; y = $_.BoundingRect.Y / 2;
         width = $_.BoundingRect.Width / 2; height = $_.BoundingRect.Height / 2 }
    })
    $report.observations += @{ page = $Page; step = $Step; method = 'offline_windows_ocr';
      screenshot = [IO.Path]::GetFileName($path); ocrScale = 2; lines = $lines; lineBounds = $lineBounds; enabledSwitches = $enabledSwitches }
    return @{ screen = $screen; words = $words; text = ($lines -join ' '); lineBounds = $lineBounds; enabledSwitches = $enabledSwitches }
  } finally { if ($software) { $software.Dispose() }; $stream.Dispose() }
}
function Assert-PrivacyScreen($Snapshot) {
  if ($Snapshot.text -notmatch 'Choose privacy settings for your device') { return $false }
  if ($Snapshot.text -match '(?i)Microsoft account|sign in|password|user account control|licen[cs]e terms') {
    throw 'OCR observed a security/account/licence screen; no input is permitted.'
  }
  return $true
}
function Click-ObservedPrivacyWord($Snapshot, $Word) {
  if (-not (Assert-PrivacyScreen $Snapshot)) { throw 'Privacy heading is missing before input.' }
  if ($Word.text -cnotin @('privacy_toggle', 'Next', 'Accept')) { throw 'Unapproved observed privacy action.' }
  if ($Word.x -lt $Snapshot.screen.Width * 0.45 -or $Word.y -lt 250 -or
      $Word.width -le 0 -or $Word.height -le 0) { throw 'Privacy target is outside the observed options/navigation region.' }
  if (-not ('HostedPrivacyInput' -as [Type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HostedPrivacyInput {
  [StructLayout(LayoutKind.Sequential)] public struct Mouse {
    public int dx, dy; public uint data, flags, time; public UIntPtr extra;
  }
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
  }
  $x = [int]($Snapshot.screen.Left + $Word.x + $Word.width / 2)
  $y = [int]($Snapshot.screen.Top + $Word.y + $Word.height / 2)
  if (-not [HostedPrivacyInput]::Click($x, $y)) { throw 'Observed privacy input failed.' }
}
function Get-ObservedPrivacyOption($Snapshot, $Switch, [string]$OptionName = '') {
  # These are headings seen in actual hosted screenshots, not inferred account
  # actions. Description text changes height when a switch changes state, so an
  # option's fresh heading/next heading are the stable association, not old Y.
  $headings = @($Snapshot.lineBounds | Where-Object {
    $_.text -cin @('Location', 'Find my device', 'Inking & typing', 'Personalized offers') -and
      $_.x -ge $Snapshot.screen.Width * 0.45 -and $_.y -ge 250
  } | Sort-Object y)
  if ($OptionName) {
    $matching = @($headings | Where-Object { $_.text -ceq $OptionName })
  } else {
    $matching = @($headings | Where-Object { $_.bottom -lt $Switch.y } | Select-Object -Last 1)
  }
  if ($matching.Count -ne 1) { throw 'Cannot uniquely associate the observed privacy switch with its option heading.' }
  $heading = $matching[0]
  $next = @($headings | Where-Object { $_.y -gt $heading.y } | Select-Object -First 1)
  $bottom = if ($next.Count -eq 1) { $next[0].y } else { $Snapshot.screen.Height * 0.8 }
  return @{ name = $heading.text; top = $heading.bottom; bottom = $bottom }
}
function Test-ObservedPrivacyOff($Snapshot, $Option, $OriginalSwitch) {
  try { $current = Get-ObservedPrivacyOption $Snapshot $null $Option.name } catch { return $false }
  $enabled = @($Snapshot.enabledSwitches | Where-Object { $_.y -gt $current.top -and $_.y -lt $current.bottom })
  $no = @($Snapshot.words | Where-Object {
    $_.text -ceq 'No' -and $_.y -gt $current.top -and $_.y -lt $current.bottom -and
      $_.x -ge $OriginalSwitch.x + $OriginalSwitch.width -and $_.x -lt $OriginalSwitch.x + $OriginalSwitch.width + 25
  })
  return $enabled.Count -eq 0 -and $no.Count -eq 1
}
function Complete-OcrPrivacyPage([int]$Page) {
  $snapshot = Read-PrivacyScreenshot $Page 'before'
  if (-not (Assert-PrivacyScreen $snapshot)) { return $false }
  for ($toggle = 0; $toggle -lt 6; $toggle++) {
    $yes = @($snapshot.enabledSwitches)
    if ($yes.Count -eq 0) { break }
    $option = Get-ObservedPrivacyOption $snapshot $yes[0]
    Click-ObservedPrivacyWord $snapshot $yes[0]
    $verified = $false
    # Reobserve bounded render/OCR settling. Never click an uncertain state a
    # second time: that could switch an already-disabled privacy option back on.
    for ($observation = 0; $observation -lt 3; $observation++) {
      Start-Sleep -Milliseconds 500
      $after = Read-PrivacyScreenshot $Page "toggle-$toggle-observe-$observation"
      if (-not (Assert-PrivacyScreen $after)) { throw 'Privacy screen changed unexpectedly during optional toggle.' }
      $remaining = @($after.enabledSwitches)
      if ($remaining.Count -eq $yes.Count - 1 -and (Test-ObservedPrivacyOff $after $option $yes[0])) {
        $verified = $true
        break
      }
    }
    if (-not $verified) {
      throw 'Optional privacy toggle did not visibly change Yes to No; no navigation was performed.'
    }
    $report.actions += @{ page = $Page; control = 'observed_blue_privacy_switch'; action = 'optional_privacy_off';
      option = $option.name; bounds = $yes[0]; method = 'same_option_screenshot_switch_and_ocr_no' }
    $snapshot = $after
  }
  if (@($snapshot.enabledSwitches).Count -gt 0 -or
      @($snapshot.words | Where-Object { $_.text -ceq 'Yes' -and $_.y -ge 250 }).Count -gt 0) { throw 'Privacy toggle bound exceeded or unclassified Yes remains.' }
  $buttons = @($snapshot.words | Where-Object { $_.text -cin @('Next', 'Accept') -and $_.y -ge $snapshot.screen.Height * 0.6 })
  if ($buttons.Count -ne 1) { throw 'No unique observed privacy navigation button.' }
  Click-ObservedPrivacyWord $snapshot $buttons[0]
  $report.actions += @{ page = $Page; control = $buttons[0].text; action = 'invoke_privacy_navigation'; method = 'offline_windows_ocr' }
  Start-Sleep -Seconds 2
  return $true
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
      if (Complete-OcrPrivacyPage $page) { continue }
      $report.status = if ($page -eq 0) { 'privacy_wizard_not_observed' } else { 'privacy_wizard_dismissed' }
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
