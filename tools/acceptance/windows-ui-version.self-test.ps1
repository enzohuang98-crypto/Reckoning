param([string]$SourcePath = (Join-Path $PSScriptRoot 'windows-packaged-ui.ps1'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Source parse failed'}
foreach($name in @('Get-ProbeUiVersionObservation','Assert-ProbeUiVersion')){
 $function=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if(-not $function){throw "Source missing $name"};Invoke-Expression $function.Extent.Text
}
function Assert-ProbeForeground {$script:foregroundChecks++}
function Get-ProbeControls {
 $script:reads++
 if($script:delayed -and $script:reads -lt 3){return ,$script:heading}
 return $script:controls
}
function Wait-Probe([scriptblock]$Condition,[string]$Message,[int]$Seconds=30){
 $script:seconds=$Seconds;for($i=0;$i -lt 4;$i++){$result=& $Condition;if($result){return $result}};throw $Message
}
function New-Control([string]$Name,[string]$Class='',[string]$Type='Text',[bool]$Offscreen=$false,[string]$PatternText=''){
 $control=[pscustomobject]@{Current=[pscustomobject]@{Name=$Name;ClassName=$Class;ControlType=[System.Windows.Automation.ControlType]::$Type;IsOffscreen=$Offscreen};PatternText=$PatternText;Bound=$null}
 $range=[pscustomobject]@{Owner=$control}
 $range|Add-Member ScriptMethod GetText {param($limit)$this.Owner.Bound=$limit;return $this.Owner.PatternText.Substring(0,[Math]::Min($limit,$this.Owner.PatternText.Length))}
 $control|Add-Member NoteProperty Pattern ([pscustomobject]@{DocumentRange=$range})
 $control|Add-Member ScriptMethod TryGetCurrentPattern {param($id,$target)if($this.PatternText -and $id -eq [System.Windows.Automation.TextPattern]::Pattern){$target.Value=$this.Pattern;return $true};$target.Value=$null;return $false}
 return $control
}
$script:title=[string]([char]0x7248)+[char]0x672C+[char]0x8207+[char]0x81EA+[char]0x52D5+[char]0x66F4+[char]0x65B0
$script:heading=New-Control $script:title
function Reset-Case($Controls,[bool]$Delayed=$false){$script:controls=@($Controls);$script:delayed=$Delayed;$script:reads=0;$script:foregroundChecks=0;$script:probeUiActions=@()}
function Assert-Pass {Assert-ProbeUiVersion '0.4.14' 'fixture';if($script:probeUiActions[-1].result -ne 'completed' -or $script:seconds -ne 10 -or $script:foregroundChecks -ne 1){throw 'Guard/deadline/result missing'}}
function Assert-Fail {
 $failure=$null;try{Assert-ProbeUiVersion '0.4.14' 'fixture'}catch{$failure=$_.Exception.Message}
 if(-not $failure -or $script:probeUiActions[-1].result -ne 'failed'){throw 'Invalid version incorrectly accepted'}
}
Reset-Case @($script:heading,(New-Control 'v0.4.14'));Assert-Pass;Write-Output 'PASS exact static text with update heading'
Reset-Case @((New-Control ('APPLICATION UPDATE '+$script:title+' v0.4.14') 'section-heading' 'Group'));Assert-Pass;Write-Output 'PASS exact source heading merged with version'
Reset-Case @($script:heading,(New-Control '' 'badge plain' 'Text' $false 'v0.4.14'));Assert-Pass
if($script:controls[1].Bound -ne 128){throw 'Text range was not bounded'};Write-Output 'PASS source badge bounded read-only TextPattern'
Reset-Case @($script:heading,(New-Control 'v0.4.14')) $true;Assert-Pass
if($script:reads -lt 3){throw 'Did not actually observe delayed version'};Write-Output 'PASS delayed UI text waits for exact version'
Reset-Case @($script:heading,(New-Control 'v0.4.140'));Assert-Fail;Write-Output 'PASS v0.4.140 prefix mismatch rejected'
Reset-Case @($script:heading,(New-Control 'v0.4.15'));Assert-Fail;Write-Output 'PASS different version rejected'
Reset-Case @($script:heading,(New-Control 'A paragraph mentions v0.4.14'));Assert-Fail;Write-Output 'PASS arbitrary prose containing expected version rejected'
Reset-Case @($script:heading,(New-Control 'v0.4.14'),(New-Control 'v0.4.15'));Assert-Fail;Write-Output 'PASS ambiguous two distinct versions rejected'
Reset-Case @((New-Control 'v0.4.14'));Assert-Fail;Write-Output 'PASS version without known update section rejected'
Reset-Case @($script:heading,(New-Control 'v0.4.14' '' 'Text' $true));Assert-Fail;Write-Output 'PASS offscreen-only version rejected'
Reset-Case @($script:heading,(New-Control 'v0.4.14-preview'));Assert-Fail;Write-Output 'PASS suffix version rejected'
Reset-Case @($script:heading,(New-Control 'v0.4.14' 'arbitrary-group' 'Group'));Assert-Fail;Write-Output 'PASS unrelated group name rejected'
Reset-Case @($script:heading,(New-Control '' 'not-the-version-badge' 'Text' $false 'v0.4.14'));Assert-Fail
if($script:controls[1].Bound -ne $null){throw 'Read an arbitrary TextPattern'};Write-Output 'PASS arbitrary TextPattern not read or accepted'
Reset-Case @($script:heading,(New-Control '' 'badge plain' 'Text' $false 'v0.4.14 must be treated as a sentence'));Assert-Fail;Write-Output 'PASS source badge prose does not qualify as version'
$currentVersionLabel = [string]([char]0x76EE)+[char]0x524D+[char]0x7248+[char]0x672C+' '
foreach($type in @('Text','Group','Pane','StatusBar')) {
 Reset-Case @($script:heading,(New-Control ($currentVersionLabel+'v0.4.14') '' $type));Assert-Pass;Write-Output "PASS exact accessible version label in $type"
}
Reset-Case @($script:heading,(New-Control ($currentVersionLabel+'v0.4.140') '' 'StatusBar'));Assert-Fail;Write-Output 'PASS accessible version prefix mismatch rejected'
Reset-Case @($script:heading,(New-Control ($currentVersionLabel+'v0.4.14 extra') '' 'StatusBar'));Assert-Fail;Write-Output 'PASS accessible version with trailing prose rejected'
Reset-Case @($script:heading,(New-Control ($currentVersionLabel+'v0.4.14') '' 'Edit'));Assert-Fail;Write-Output 'PASS input field cannot prove installed version'
Write-Output '21/21 offline UI version cases passed; no real UI, host input, or release acceptance executed.'
