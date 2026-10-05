param([string]$SourcePath = (Join-Path $PSScriptRoot 'windows-packaged-updater.ps1'))
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath $SourcePath
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Source parse failed.' }
$reader = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ProbeShortcutObservation' }, $true)
if ($reader) { Invoke-Expression $reader.Extent.Text }
$start = $source.IndexOf("  `$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop'))")
if ($start -lt 0) { throw 'Shortcut gate start is missing.' }
$start = $source.IndexOf("`n", $start) + 1
$end = $source.IndexOf('  $installNetwork = Read-Feed', $start)
if ($end -le $start) { throw 'Shortcut gate end is missing.' }
$gate = [scriptblock]::Create($source.Substring($start, $end - $start))

# Real, temporary Windows shell links with inert targets. No target is run,
# no installed application or Desktop is touched, and no native UI is used.
# IShellLinkW matches the Unicode link format written by the installer.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
public static class ShortcutFixture {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  private class ShellLink { }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  private interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr data, uint flags);
    void GetIDList(out IntPtr pidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetHotkey(out short value);
    void SetHotkey(short value);
    void GetShowCmd(out int value);
    void SetShowCmd(int value);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int size, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value, uint reserved);
    void Resolve(IntPtr window, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
  }
  public static void Create(string linkPath, string targetPath) {
    var link = (IShellLinkW)new ShellLink();
    try { link.SetPath(targetPath); ((IPersistFile)link).Save(linkPath, true); }
    finally { Marshal.FinalReleaseComObject(link); }
  }
}
'@
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('reckoning-shortcut-fixture-' + [guid]::NewGuid().ToString('N'))
$fixtureRoot = [IO.Path]::GetFullPath($fixtureRoot)
[void][IO.Directory]::CreateDirectory($fixtureRoot)
$target = Join-Path $fixtureRoot '象棋AI分析講解.exe'
$otherTarget = Join-Path $fixtureRoot 'different-target.exe'
$unicodeLink = Join-Path $fixtureRoot '象棋AI分析講解.lnk'
$asciiLink = Join-Path $fixtureRoot 'normal.lnk'
$wrongLink = Join-Path $fixtureRoot 'wrong-target.lnk'
$danglingLink = Join-Path $fixtureRoot 'dangling-target.lnk'
$danglingTarget = Join-Path $fixtureRoot 'missing-target.exe'
$blankLink = Join-Path $fixtureRoot 'invalid.lnk'
$missingLink = Join-Path $fixtureRoot 'missing.lnk'
try {
  [IO.File]::WriteAllText($target, 'inert fixture - never execute')
  [IO.File]::WriteAllText($otherTarget, 'inert fixture - never execute')
  [ShortcutFixture]::Create($unicodeLink, $target)
  [ShortcutFixture]::Create($asciiLink, $otherTarget)
  [ShortcutFixture]::Create($wrongLink, $otherTarget)
  [ShortcutFixture]::Create($danglingLink, $danglingTarget)
  [IO.File]::WriteAllText($blankLink, 'not a shell link')
  foreach ($case in @(@{ link = $asciiLink; expected = $otherTarget }, @{ link = $unicodeLink; expected = $target })) {
    $shortcut = $case.link; $script:probeExe = $case.expected; $report = @{}
    & $gate
    if ($report.desktopShortcutTarget -cne $case.expected) { throw 'Shortcut target was not the real observed exact target.' }
    if ($reader -and ($report.desktopShortcutObservation.path -cne $shortcut -or
        $report.desktopShortcutObservation.reader -cne 'Shell.Application:System.Link.TargetParsingPath' -or
        $report.desktopShortcutObservation.exists -ne $true -or
        $report.desktopShortcutObservation.target -cne $case.expected)) { throw 'Shortcut evidence was incomplete.' }
    Write-Output ('PASS real COM shortcut: ' + [IO.Path]::GetFileName($shortcut))
  }
  foreach ($case in @(@{ link = $wrongLink; expected = $target }, @{ link = $missingLink; expected = $target }, @{ link = $blankLink; expected = $target }, @{ link = $danglingLink; expected = $danglingTarget })) {
    $shortcut = $case.link; $script:probeExe = $case.expected; $report = @{}; $failure = $null
    try { & $gate } catch { $failure = $_.Exception.Message }
    if (-not $failure -or -not $report.desktopShortcutObservation -or $report.desktopShortcutTarget) { throw 'Wrong, missing or unreadable shortcut was accepted or its evidence was lost.' }
    if ($shortcut -eq $wrongLink -and $report.desktopShortcutObservation.target -cne $otherTarget) { throw 'Actual wrong target was not retained in failure evidence.' }
    if ($shortcut -eq $missingLink -and $report.desktopShortcutObservation.exists -ne $false) { throw 'Missing link was not recorded.' }
    if ($shortcut -eq $danglingLink -and ($report.desktopShortcutObservation.target -cne $danglingTarget -or $report.desktopShortcutObservation.targetExists -ne $false)) { throw 'Missing executable target was not recorded.' }
    Write-Output ('PASS rejected shortcut with diagnostics: ' + [IO.Path]::GetFileName($shortcut))
  }
  Write-Output '6/6 isolated real-COM shortcut cases passed; packaged updater VM rerun remains required.'
} finally {
  # Delete only the fixed fixture files, then the empty directory; no recursive
  # deletion and no paths obtained from COM or the link target are used here.
  foreach ($path in @($unicodeLink, $asciiLink, $wrongLink, $danglingLink, $blankLink, $target, $otherTarget)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
  }
  Remove-Item -LiteralPath $fixtureRoot
}
