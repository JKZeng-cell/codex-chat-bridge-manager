Unicode true
!include LogicLib.nsh
!include "${BRIDGE_PROJECT}\node_modules\app-builder-lib\templates\nsis\include\StdUtils.nsh"
!addplugindir /x86-unicode "${BRIDGE_PLUGIN_DIR}"
!define APP_GUID "codex-bridge-native-installer-test"
!include "${BRIDGE_PROJECT}\build\installer-temp.nsh"
Name "Bridge installer fixture"
OutFile "${BRIDGE_OUTPUT}"
InstallDir "${BRIDGE_INSTALL_DIR}"
RequestExecutionLevel user
SilentInstall silent
Function .onInit
  !insertmacro bridgePrepareTemp
FunctionEnd
Section
  InitPluginsDir
  FileOpen $0 "${BRIDGE_REPORT}" w
  FileWrite $0 "$TEMP$\r$\n$PLUGINSDIR$\r$\n$INSTDIR"
  FileClose $0
SectionEnd
