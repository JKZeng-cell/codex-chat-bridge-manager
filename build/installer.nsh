!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    !define /ifndef BRIDGE_SOURCE_ARG ""
  !else
    !define /ifndef BRIDGE_SOURCE_ARG '-InstallerPath "$EXEPATH"'
  !endif
  InitPluginsDir
  File /oname=$PLUGINSDIR\bridge-process-check.ps1 "${BUILD_RESOURCES_DIR}\installer-process-check.ps1"
  Push $R0
  Push $R1
  bridge_check:
    nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\bridge-process-check.ps1" -Action check -InstallDirectory "$INSTDIR" ${BRIDGE_SOURCE_ARG}'
    Pop $R0
    Pop $R1
    ${If} $R0 == 0
      Goto bridge_done
    ${EndIf}
    ${If} $R0 == 30
      MessageBox MB_OK|MB_ICONINFORMATION "请将安装包移动到下载目录后重新运行，不要从正在更新的应用目录中运行安装包。$\r$\nMove this installer to Downloads and run it again. Do not run it from the application installation directory." /SD IDOK
      Pop $R1
      Pop $R0
      SetErrorLevel 30
      Quit
    ${EndIf}
    ${If} $R0 == 10
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "请先完成正在执行的任务。继续安装将请求应用正常退出，不会强制结束任务。$\r$\nSetup will request a normal exit without force-stopping jobs." /SD IDOK IDOK bridge_close
      Goto bridge_cancel
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法检查应用进程。请检查权限、手动退出应用后重试。未强制结束任何进程。$\r$\nCannot inspect application processes. Check permissions and retry." /SD IDCANCEL IDRETRY bridge_check
    Goto bridge_cancel
  bridge_close:
    nsExec::ExecToStack /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\bridge-process-check.ps1" -Action close -InstallDirectory "$INSTDIR"'
    Pop $R0
    Pop $R1
    ${If} $R0 == 0
      Goto bridge_done
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "应用仍有任务或待确认窗口。请等待任务完成、退出应用后重试；配置与历史会保留。$\r$\nFinish active tasks and exit the app, then retry. Your configuration and history are preserved." /SD IDCANCEL IDRETRY bridge_check
  bridge_cancel:
    Pop $R1
    Pop $R0
    SetErrorLevel 10
    Quit
  bridge_done:
    Pop $R1
    Pop $R0
!macroend
