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

; 在 Windows 實機驗收中，electron-builder 內建的 SHCTX 寫入曾完成檔案與
; 捷徑安裝，卻沒有留下 App 專屬安裝／解除安裝登錄。這裡以已選定的
; installMode 明確指定 HKCU 或 HKLM，寫入同一組冪等資訊並立即讀回驗證。
!macro writeReliableRegistration ROOT MODE_ARG
  WriteRegStr ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  WriteRegStr ${ROOT} "${INSTALL_REGISTRY_KEY}" KeepShortcuts "true"
  WriteRegStr ${ROOT} "${INSTALL_REGISTRY_KEY}" ShortcutName "${SHORTCUT_NAME}"
  !ifdef MENU_FILENAME
    WriteRegStr ${ROOT} "${INSTALL_REGISTRY_KEY}" MenuDirectory "${MENU_FILENAME}"
  !endif

  StrCpy $R8 "$INSTDIR\${UNINSTALL_FILENAME}"
  WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" DisplayName "${UNINSTALL_DISPLAY_NAME}"
  WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" UninstallString '$\"$R8$\" ${MODE_ARG}'
  WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '$\"$R8$\" ${MODE_ARG} /S'
  WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" DisplayVersion "${VERSION}"
  !ifdef UNINSTALLER_ICON
    WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "$INSTDIR\uninstallerIcon.ico"
  !else
    WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "$appExe,0"
  !endif
  !ifdef COMPANY_NAME
    WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" Publisher "${COMPANY_NAME}"
  !endif
  !ifdef APP_DESCRIPTION
    WriteRegStr ${ROOT} "${UNINSTALL_REGISTRY_KEY}" Comments "${APP_DESCRIPTION}"
  !endif
  WriteRegDWORD ${ROOT} "${UNINSTALL_REGISTRY_KEY}" NoModify 1
  WriteRegDWORD ${ROOT} "${UNINSTALL_REGISTRY_KEY}" NoRepair 1

  ReadRegStr $R7 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R6 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${If} $R7 != "$INSTDIR"
  ${OrIf} $R6 != "${VERSION}"
    ${IfNot} ${Silent}
      MessageBox MB_ICONSTOP "Unable to register the installation. Setup will stop instead of leaving an incomplete Windows installation."
    ${EndIf}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customInstall
  Push $R6
  Push $R7
  Push $R8
  ${If} $installMode == "all"
    !insertmacro writeReliableRegistration HKLM "/allusers"
  ${Else}
    !insertmacro writeReliableRegistration HKCU "/currentuser"
  ${EndIf}
  Pop $R8
  Pop $R7
  Pop $R6
!macroend

; 一般解除安裝沿用 electron-builder 的保留資料行為；只有明確傳入
; --delete-app-data 時，才一併清除 GitHub updater 留下的本機安裝快取。
!macro customUnInstall
  Push $R4
  Push $R5
  ClearErrors
  ${GetParameters} $R5
  ${GetOptions} $R5 "--delete-app-data" $R4
  ${IfNot} ${Errors}
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}
    RMDir /r "$LOCALAPPDATA\xiangqi-analyzer-updater"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
  Pop $R5
  Pop $R4
!macroend
