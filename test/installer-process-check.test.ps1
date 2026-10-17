$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\build\installer-process-check.ps1" -LibraryOnly
$root = Join-Path ([IO.Path]::GetTempPath()) "Bridge App's test"
$fixtures = @(
  [pscustomobject]@{ProcessId=1;Name='CodexChatBridgeManager.exe';ExecutablePath="$root\CodexChatBridgeManager.exe"},
  [pscustomobject]@{ProcessId=2;Name='Setup.exe';ExecutablePath="$root\Setup.exe"},
  [pscustomobject]@{ProcessId=3;Name='codex.exe';ExecutablePath="$root\resources\tools\codex\bin\codex.exe"},
  [pscustomobject]@{ProcessId=4;Name='CodexChatBridgeManager.exe';ExecutablePath="$root-other\CodexChatBridgeManager.exe"},
  [pscustomobject]@{ProcessId=5;Name='CodexChatBridgeManager.exe';ExecutablePath="$root\downloads\CodexChatBridgeManager.exe"},
  [pscustomobject]@{ProcessId=6;Name='powershell.exe';ExecutablePath="$root\powershell.exe"},
  [pscustomobject]@{ProcessId=7;Name='elevate.exe';ExecutablePath="$root\resources\elevate.exe"},
  [pscustomobject]@{ProcessId=8;Name='other.exe';ExecutablePath=$null}
)
$selected = @(Select-BridgeInstallProcesses $fixtures $root)
if (($selected.ProcessId -join ',') -ne '1,3') { throw 'Installer process scope regression' }
$selected = @(Select-BridgeInstallProcesses $fixtures ($root.ToUpperInvariant() + '\'))
if (($selected.ProcessId -join ',') -ne '1,3') { throw 'Case or trailing separator regression' }
$threw = $false
try { Select-BridgeInstallProcesses @([pscustomobject]@{Name='CodexChatBridgeManager.exe';ExecutablePath=$null}) $root | Out-Null } catch { $threw = $true }
if (-not $threw) { throw 'Inaccessible app processes must fail closed' }
if (-not (Test-BridgeInstallerSource $root "$root\Setup.exe")) { throw 'Installer source guard missing' }
if (Test-BridgeInstallerSource $root "$root-other\Setup.exe") { throw 'Installer source guard must respect directory boundaries' }
if (Test-BridgeInstallerSource $root '') { throw 'Uninstaller should not inherit source restriction' }
Write-Output 'Installer scope verified: exact application and bundled tools only; installer, siblings and unrelated processes excluded.'
