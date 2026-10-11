param([Parameter(Mandatory = $true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $InstallerPath
if ($item.PSIsContainer) { throw 'Installer must be a file.' }
$signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
@{ status = [string]$signature.Status; productVersion = ([string]$item.VersionInfo.ProductVersion).Trim() } | ConvertTo-Json -Compress
