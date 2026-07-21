!include "LogicLib.nsh"

; electron-builder 的 assisted installer 有時會把 current-user 新安裝
; 誤標為 reinstall/upgrade。安裝模式頁建立前，以 App 專屬 registry
; 與實際主程式檔案共同判定，避免只因預設路徑而出現錯誤提示。
!macro customInstallMode
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "0"
  StrCpy $perMachineInstallationFolder ""
  StrCpy $perUserInstallationFolder ""

  ReadRegStr $perMachineInstallationFolder HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $perMachineInstallationFolder != ""
  ${AndIf} ${FileExists} "$perMachineInstallationFolder\${PRODUCT_FILENAME}.exe"
    StrCpy $hasPerMachineInstallation "1"
  ${EndIf}

  ReadRegStr $perUserInstallationFolder HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $perUserInstallationFolder != ""
  ${AndIf} ${FileExists} "$perUserInstallationFolder\${PRODUCT_FILENAME}.exe"
    StrCpy $hasPerUserInstallation "1"
  ${EndIf}
!macroend
