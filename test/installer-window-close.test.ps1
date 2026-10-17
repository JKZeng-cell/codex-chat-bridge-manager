$ErrorActionPreference = 'Stop'
$temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$root = Join-Path $temporary ('bridge-window-test-' + [guid]::NewGuid().ToString('N'))
$process = $null
try {
  New-Item -ItemType Directory -Path $root | Out-Null
  $file = Join-Path $root 'CodexChatBridgeManager.exe'
  Add-Type -Path "$PSScriptRoot\fixtures\installer-native-probe.cs" -OutputAssembly $file -OutputType WindowsApplication
  Set-Content -LiteralPath "$root\busy" -Value 'simulated job'
  $process = Start-Process -FilePath $file -ArgumentList ('"' + $root + '"') -WindowStyle Hidden -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path -LiteralPath "$root\ready")) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Hidden window startup timeout' }
    Start-Sleep -Milliseconds 100
  }
  $helper = "$PSScriptRoot\..\build\installer-process-check.ps1"
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Action close -InstallDirectory $root -WaitSeconds 1
  if ($LASTEXITCODE -ne 10 -or $process.HasExited -or -not (Test-Path -LiteralPath "$root\blocked")) { throw 'A busy hidden application must be preserved' }
  Remove-Item -LiteralPath "$root\busy"
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Action close -InstallDirectory $root -WaitSeconds 5
  if ($LASTEXITCODE -ne 0 -or -not $process.WaitForExit(5000) -or -not (Test-Path -LiteralPath "$root\closed")) { throw 'An idle hidden application must receive a normal close' }
  Write-Output 'Hidden-window busy protection and graceful close verified.'
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  $resolved = [IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith($temporary + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolved)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
