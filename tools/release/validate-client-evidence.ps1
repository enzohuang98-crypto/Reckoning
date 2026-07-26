param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$ExpectedSha256,
  [Parameter(Mandatory)]
  [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
  [string]$ExpectedRepository,
  [Parameter(Mandatory)]
  [ValidatePattern('^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
  [string]$ExpectedReleaseTag,
  [Parameter(Mandatory)]
  [ValidatePattern('^[A-Fa-f0-9]{40}$')]
  [string]$ExpectedCommitSha,
  [Parameter(Mandatory)]
  [ValidatePattern('^[1-9][0-9]*$')]
  [string]$ExpectedWorkflowRunId,
  [Parameter(Mandatory)]
  [ValidatePattern('^https://')]
  [string]$Windows10EvidenceUrl,
  [Parameter(Mandatory)]
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$Windows10EvidenceSha256,
  [Parameter(Mandatory)]
  [ValidatePattern('^https://')]
  [string]$Windows11EvidenceUrl,
  [Parameter(Mandatory)]
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$Windows11EvidenceSha256,
  [ValidateRange(1, 72)]
  [int]$EvidenceMaxAgeHours = 24
)

$ErrorActionPreference = 'Stop'
$expectedInstallerHash = $ExpectedSha256.ToUpperInvariant()
$expectedCommit = $ExpectedCommitSha.ToLowerInvariant()
$maximumEvidenceBytes = 128KB

if ($Windows10EvidenceUrl -eq $Windows11EvidenceUrl) {
  throw 'Windows 10 and Windows 11 must have separate evidence documents.'
}
if ($Windows10EvidenceSha256 -eq $Windows11EvidenceSha256) {
  throw 'Windows 10 and Windows 11 must have separate evidence digests.'
}

function Read-ClientEvidence(
  [string]$Url,
  [string]$ExpectedDocumentSha256,
  [string]$ExpectedFamily
) {
  $temporary = New-TemporaryFile
  try {
    try {
      Invoke-WebRequest `
        -Uri $Url `
        -OutFile $temporary.FullName `
        -TimeoutSec 20 `
        -MaximumRedirection 0
    } catch {
      throw "Could not download $ExpectedFamily evidence JSON from its approved URL."
    }
    if (
      (Get-Item -LiteralPath $temporary.FullName).Length -gt
        $maximumEvidenceBytes
    ) {
      throw "$ExpectedFamily evidence exceeds the 128 KiB limit."
    }
    $actualDocumentHash = (
      Get-FileHash -Algorithm SHA256 -LiteralPath $temporary.FullName
    ).Hash
    if (
      $actualDocumentHash -ne
        $ExpectedDocumentSha256.ToUpperInvariant()
    ) {
      throw "$ExpectedFamily evidence bytes do not match the protected SHA-256."
    }
    try {
      $evidence = Get-Content `
        -Raw `
        -Encoding UTF8 `
        -LiteralPath $temporary.FullName |
        ConvertFrom-Json
    } catch {
      throw "$ExpectedFamily evidence is not valid UTF-8 JSON."
    }
  } finally {
    Remove-Item -LiteralPath $temporary.FullName -Force -ErrorAction SilentlyContinue
  }

  if ($evidence.schemaVersion -ne 1 -or $evidence.result -ne 'pass') {
    throw "$ExpectedFamily evidence must use schemaVersion 1 and result pass."
  }
  if (
    $evidence.repository -ne $ExpectedRepository -or
    $evidence.releaseTag -ne $ExpectedReleaseTag -or
    ([string]$evidence.commitSha).ToLowerInvariant() -ne $expectedCommit -or
    [string]$evidence.workflowRunId -ne $ExpectedWorkflowRunId
  ) {
    throw "$ExpectedFamily evidence is not bound to this repository, tag, commit, and workflow run."
  }
  if (
    $evidence.installerSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or
    $evidence.installerSha256.ToUpperInvariant() -ne $expectedInstallerHash
  ) {
    throw "$ExpectedFamily evidence does not match the exact installer SHA-256."
  }
  if (
    $evidence.os.family -ne $ExpectedFamily -or
    $evidence.os.productType -ne 'client' -or
    $evidence.os.architecture -ne 'x64'
  ) {
    throw "$ExpectedFamily evidence must come from an x64 consumer client OS."
  }
  if ($evidence.os.build -notmatch '^[0-9]+(?:\.[0-9]+)*$') {
    throw "$ExpectedFamily evidence must record a numeric OS build."
  }
  $buildNumber = [int]([string]$evidence.os.build -split '\.')[0]
  if ($ExpectedFamily -eq 'Windows 10') {
    if ($evidence.os.displayVersion -ne '22H2' -or $buildNumber -ne 19045) {
      throw 'Windows 10 evidence must be from Windows 10 22H2 build 19045.'
    }
  } elseif ($buildNumber -lt 22000) {
    throw 'Windows 11 evidence must report a Windows 11 client build.'
  }
  if (
    $evidence.testRunId -notmatch
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) {
    throw "$ExpectedFamily evidence must include a UUID testRunId."
  }
  $installerUri = $null
  if (
    -not [Uri]::TryCreate(
      [string]$evidence.installerUrl,
      [UriKind]::Absolute,
      [ref]$installerUri
    ) -or
    $installerUri.Scheme -ne 'https' -or
    $installerUri.Host -ne 'github.com' -or
    $installerUri.AbsolutePath -notmatch
      "^/$([regex]::Escape($ExpectedRepository))/releases/download/$([regex]::Escape($ExpectedReleaseTag))/"
  ) {
    throw "$ExpectedFamily evidence must use this tag's public GitHub Release installer URL."
  }

  $requiredPasses = @(
    'cleanSnapshot',
    'downloadedInBrowser',
    'markOfTheWebPresent',
    'installed',
    'launched',
    'pikafishUciReady',
    'pikafishSearchCompleted',
    'shortcutsCreated',
    'uninstalled',
    'timestampValid'
  )
  foreach ($field in $requiredPasses) {
    if ($evidence.$field -ne $true) {
      throw "$ExpectedFamily evidence is missing required pass: $field."
    }
  }
  if ($evidence.preexistingInstallation -ne $false) {
    throw "$ExpectedFamily evidence must start without a pre-existing installation."
  }
  if ($evidence.authenticodeStatus -ne 'Valid') {
    throw "$ExpectedFamily evidence must report a Valid Authenticode signature."
  }
  $testedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse([string]$evidence.testedAt, [ref]$testedAt)) {
    throw "$ExpectedFamily evidence must include a valid testedAt timestamp."
  }
  $now = [DateTimeOffset]::UtcNow
  if (
    $testedAt -gt $now.AddMinutes(5) -or
    $testedAt -lt $now.AddHours(-$EvidenceMaxAgeHours)
  ) {
    throw "$ExpectedFamily evidence is outside the approved freshness window."
  }
  return $evidence
}

$win10 = Read-ClientEvidence `
  $Windows10EvidenceUrl `
  $Windows10EvidenceSha256 `
  'Windows 10'
$win11 = Read-ClientEvidence `
  $Windows11EvidenceUrl `
  $Windows11EvidenceSha256 `
  'Windows 11'
if ($win10.testRunId -eq $win11.testRunId) {
  throw 'Windows 10 and Windows 11 evidence must come from separate test runs.'
}

Write-Host "Exact installer SHA-256: $expectedInstallerHash"
Write-Host "Release source: $ExpectedRepository $ExpectedReleaseTag $expectedCommit run $ExpectedWorkflowRunId"
Write-Host "Windows 10: $($win10.os.edition) $($win10.os.displayVersion), build $($win10.os.build)"
Write-Host "Windows 11: $($win11.os.edition) $($win11.os.displayVersion), build $($win11.os.build)"
