param([Parameter(Mandatory = $true)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$nodeArch = (& node -p 'process.arch').Trim()
$nodeExitCode = $LASTEXITCODE
$isClient = [int]$os.ProductType -eq 1 -and [int]$os.BuildNumber -ge 22000
$dataPath = Join-Path $env:APPDATA 'xiangqi-analyzer'
$cachePath = Join-Path $env:LOCALAPPDATA 'xiangqi-analyzer-updater'

# Query this process's window station only. No UI clicks, screenshots, elevation,
# Windows feature changes, user secrets, installer or AppData mutations.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReckoningWindowStation {
  [StructLayout(LayoutKind.Sequential)] public struct Flags {
    public int Inherit; public int Reserved; public int Value;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool GetUserObjectInformation(IntPtr handle, int index,
    out Flags flags, int length, out int needed);
}
'@
$flags = New-Object ReckoningWindowStation+Flags
$needed = 0
$stationQuery = [ReckoningWindowStation]::GetUserObjectInformation(
  [ReckoningWindowStation]::GetProcessWindowStation(), 1, [ref]$flags, 12, [ref]$needed)
$report = [ordered]@{
  capturedAtUtc = [DateTime]::UtcNow.ToString('o')
  sourceCommit = $env:GITHUB_SHA
  runId = $env:GITHUB_RUN_ID
  osCaption = [string]$os.Caption
  osVersion = [string]$os.Version
  osBuild = [int]$os.BuildNumber
  osProductType = [int]$os.ProductType
  nativeArchitecture = $env:PROCESSOR_ARCHITECTURE
  nodeArchitecture = $nodeArch
  x64ExecutionPassed = $nodeExitCode -eq 0 -and $nodeArch -eq 'x64'
  windows11Client = $isClient
  processSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  windowStationQuerySucceeded = $stationQuery
  visibleWindowStation = $stationQuery -and ($flags.Value -band 1) -ne 0
  existingAppData = Test-Path -LiteralPath $dataPath
  existingUpdaterCache = Test-Path -LiteralPath $cachePath
  environmentOnly = $true
  packagedAppAcceptance = 'not_run'
  updaterInstallationAcceptance = 'not_run'
  architectureDifference = 'ARM64 Windows client; x64 executables use Windows emulation. Does not prove native x64 hardware behavior.'
}
$report | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host "Windows client=$isClient; native=$($report.nativeArchitecture); node=$nodeArch; visible window station=$($report.visibleWindowStation)."
if (-not $isClient -or -not $report.x64ExecutionPassed) {
  throw 'A real Windows 11 client VM with x64 execution was not established.'
}
if ($report.existingAppData -or $report.existingUpdaterCache) {
  throw 'The runner is not a clean Reckoning acceptance environment.'
}
