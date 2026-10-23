$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\build\installer-process-check.ps1" -LibraryOnly
$root = Join-Path ([IO.Path]::GetTempPath()) ('bridge-permissions-' + [Guid]::NewGuid().ToString('N'))
$helper = Join-Path $PSScriptRoot '..\build\installer-process-check.ps1'
$original = $null
try {
  New-Item -ItemType Directory -Path $root | Out-Null
  Assert-BridgeInstallWritable $root
  Assert-BridgeInstallWritable (Join-Path $root 'new\installation')
  if (@(Get-ChildItem -LiteralPath $root -Force).Count -ne 0) { throw 'Permission probes left files behind.' }

  $original = [IO.Directory]::GetAccessControl($root)
  $denied = [IO.Directory]::GetAccessControl($root)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'Write', 'Deny')
  $denied.AddAccessRule($rule)
  [IO.Directory]::SetAccessControl($root, $denied)
  $failed = $false
  try { Assert-BridgeInstallWritable $root } catch {
    $failed = $_.Exception.GetBaseException() -is [UnauthorizedAccessException]
  }
  if (-not $failed) { throw 'Protected folder must fail the write preflight.' }
  $ErrorActionPreference = 'Continue'
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Action permissions -InstallDirectory $root 2>$null
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 40) { throw "Permission failure returned $LASTEXITCODE instead of 40." }
} finally {
  if ($original) { [IO.Directory]::SetAccessControl($root, $original) }
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root }
}
Write-Output 'Installer permission preflight verified: writable/new paths accepted, denied access returns 40, no leftover files.'
