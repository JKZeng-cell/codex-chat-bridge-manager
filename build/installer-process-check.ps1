param(
  [ValidateSet('check', 'close')][string]$Action = 'check',
  [string]$InstallDirectory,
  [string]$InstallerPath,
  [ValidateRange(1, 60)][int]$WaitSeconds = 20,
  [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'

function Select-BridgeInstallProcesses([object[]]$Processes, [string]$Directory) {
  $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/')
  $executable = [IO.Path]::Combine($root, 'CodexChatBridgeManager.exe')
  $tools = [IO.Path]::Combine($root, 'resources', 'tools') + [IO.Path]::DirectorySeparatorChar
  foreach ($process in $Processes) {
    $file = [string]$process.ExecutablePath
    if (-not $file) {
      if ($process.Name -eq 'CodexChatBridgeManager.exe') { throw 'Application process path is inaccessible.' }
      continue
    }
    if ([string]::Equals($file, $executable, [StringComparison]::OrdinalIgnoreCase) -or
        $file.StartsWith($tools, [StringComparison]::OrdinalIgnoreCase)) { $process }
  }
}

function Get-BridgeInstallProcesses([string]$Directory) {
  @(Select-BridgeInstallProcesses @(Get-CimInstance Win32_Process -ErrorAction Stop) $Directory)
}

function Test-BridgeInstallerSource([string]$Directory, [string]$Source) {
  if (-not $Source) { return $false }
  $prefix = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  [IO.Path]::GetFullPath($Source).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-BridgeTrayQuitSupport([string]$File) {
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($File)
  return $info.ProductName -eq 'Codex Chat Bridge Manager' -and
    [version]::new($info.ProductMajorPart, $info.ProductMinorPart, $info.ProductBuildPart) -ge [version]'1.0.4'
}

function Request-BridgeWindowClose([int]$ProcessId) {
  if (-not ('BridgeInstallerWindows' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BridgeInstallerWindows {
  private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
  [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static void RequestClose(int processId) {
    EnumWindows(delegate(IntPtr window, IntPtr unused) {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner != processId) return true;
      var name = new StringBuilder(256);
      GetClassName(window, name, name.Capacity);
      var value = name.ToString();
      if (value.StartsWith("Chrome_WidgetWin_", StringComparison.Ordinal) && (GetWindowLong(window, -16) & 0x00c00000) == 0x00c00000) {
        PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
      }
      return true;
    }, IntPtr.Zero);
  }
}
'@
  }
  [BridgeInstallerWindows]::RequestClose($ProcessId)
}

if ($LibraryOnly) { return }
try {
  if (-not $InstallDirectory -or -not [IO.Path]::IsPathRooted($InstallDirectory)) { throw 'Invalid installation directory.' }
  if (Test-BridgeInstallerSource $InstallDirectory $InstallerPath) { exit 30 }
  $processes = @(Get-BridgeInstallProcesses $InstallDirectory)
  if ($processes.Count -eq 0) { exit 0 }
  if ($Action -eq 'check') { exit 10 }
  # Tray apps treat WM_CLOSE as hide. Use their protected quit IPC instead.
  $main = [IO.Path]::Combine($InstallDirectory, 'CodexChatBridgeManager.exe')
  $quitRequested = $false
  foreach ($item in $processes) {
    if ([string]::Equals($item.ExecutablePath, $main, [StringComparison]::OrdinalIgnoreCase) -and (Test-BridgeTrayQuitSupport $main)) {
      if (-not $quitRequested) {
        Start-Process -FilePath $main -ArgumentList '--quit-for-update' -WorkingDirectory $InstallDirectory -WindowStyle Hidden | Out-Null
        $quitRequested = $true
      }
      continue
    }
    # Legacy versions and native probes still use a normal window close.
    $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if ($process) {
      if ($process.MainWindowHandle -ne [IntPtr]::Zero) { [void]$process.CloseMainWindow() }
      else { Request-BridgeWindowClose $item.ProcessId }
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
  do {
    Start-Sleep -Milliseconds 250
    if (@(Get-BridgeInstallProcesses $InstallDirectory).Count -eq 0) { exit 0 }
  } while ([DateTime]::UtcNow -lt $deadline)
  exit 10
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 20
}
