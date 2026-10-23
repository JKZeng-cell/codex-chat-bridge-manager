!include FileFunc.nsh
!define /ifndef BRIDGE_MIN_TEMP_BYTES 2147483648

!macro bridgePrepareTemp
  Var /GLOBAL bridgeSetupTemp
  Var /GLOBAL bridgeSetupParams
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  # A cross-volume legacy uninstall and extraction both need temporary space.
  System::Call 'kernel32::GetDiskFreeSpaceExW(w "$TEMP", *l .R0, p 0, p 0)i.R1'
  ${If} $R1 == 0
    Goto bridge_temp_failed
  ${EndIf}
  System::Int64Op $R0 >= ${BRIDGE_MIN_TEMP_BYTES}
  Pop $R1
  ${If} $R1 == 1
    Goto bridge_temp_ready
  ${EndIf}
  ReadEnvStr $R1 BRIDGE_SETUP_RELAUNCHED
  ${If} $R1 == "1"
    Goto bridge_temp_failed
  ${EndIf}

  SetRegView 64
  ReadRegStr $R2 HKCU "Software\${APP_GUID}" InstallLocation
  ${If} $R2 == ""
    ReadRegStr $R2 HKLM "Software\${APP_GUID}" InstallLocation
  ${EndIf}
  ${If} $R2 == ""
    StrCpy $R2 $INSTDIR
  ${EndIf}
  ${GetParent} "$R2" $R2
  ${IfNot} ${FileExists} "$R2\*.*"
    StrCpy $R2 $EXEDIR
  ${EndIf}
  System::Call 'kernel32::GetDiskFreeSpaceExW(w R2, *l .R0, p 0, p 0)i.R1'
  ${If} $R1 == 0
    Goto bridge_temp_failed
  ${EndIf}
  System::Int64Op $R0 >= ${BRIDGE_MIN_TEMP_BYTES}
  Pop $R1
  ${If} $R1 != 1
    Goto bridge_temp_failed
  ${EndIf}

  # Create a unique, restricted staging directory before writing executable code.
  System::Call 'ole32::CoCreateGuid(g .R3)i.R0'
  ${If} $R0 != 0
    Goto bridge_temp_failed
  ${EndIf}
  StrCpy $bridgeSetupTemp "$R2\CodexBridgeSetup-$R3"
  System::Call 'advapi32::ConvertStringSecurityDescriptorToSecurityDescriptorW(w "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)", i 1, *p .R4, p 0)i.R0'
  ${If} $R0 == 0
    Goto bridge_temp_failed
  ${EndIf}
  System::Call '*(i 12, p R4, i 0)p.R5'
  System::Call 'kernel32::CreateDirectoryW(w "$bridgeSetupTemp", p R5)i.R6'
  System::Free $R5
  System::Call 'kernel32::LocalFree(p R4)'
  ${If} $R6 == 0
    Goto bridge_temp_failed
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "$bridgeSetupTemp")i.R0'
  StrCpy $R7 $R0
  System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "$bridgeSetupTemp")i.R0'
  IntOp $R7 $R7 & $R0
  System::Call 'kernel32::SetEnvironmentVariableW(w "BRIDGE_SETUP_RELAUNCHED", w "1")i.R0'
  IntOp $R7 $R7 & $R0
  ${If} $R7 == 0
    RMDir "$bridgeSetupTemp"
    Goto bridge_temp_failed
  ${EndIf}
  ${StdUtils.GetAllParameters} $bridgeSetupParams "0"
  ClearErrors
  ExecWait '"$EXEPATH" $bridgeSetupParams' $R7
  ${If} ${Errors}
    StrCpy $R7 50
  ${EndIf}
  # Only remove this invocation's GUID directory, never the selected parent.
  RMDir /r "$bridgeSetupTemp"
  SetErrorLevel $R7
  Quit

  bridge_temp_failed:
    MessageBox MB_OK|MB_ICONSTOP "安装临时空间不足或不可写。请在临时目录或安装包所在磁盘预留至少 2 GB，再重新安装。尚未卸载旧版或更改配置。$\r$\nSetup needs at least 2 GB of writable temporary space. No previous installation or user data has been removed." /SD IDOK
    SetErrorLevel 50
    Quit
  bridge_temp_ready:
    Pop $R7
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
!macroend
