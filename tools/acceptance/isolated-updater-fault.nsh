; Included only by an unpublished hosted-VM candidate, after the production
; installer include. The real NSIS executable consumes one run-specific fault.
!ifndef RECKONING_PROBE_RUN_ID
  !error "An explicit isolated run identity is required"
!endif
!macro customInit
  ${If} ${FileExists} "$TEMP\reckoning-updater-probe-${RECKONING_PROBE_RUN_ID}\install-fail-next"
    Delete "$TEMP\reckoning-updater-probe-${RECKONING_PROBE_RUN_ID}\install-fail-next"
    System::Call 'kernel32::GetCurrentProcessId() i.R9'
    FileOpen $R8 "$TEMP\reckoning-updater-probe-${RECKONING_PROBE_RUN_ID}\install-failed.json" w
    ; This declares the fault, not its result. The VM separately observes the
    ; matching PID's actual Win32_ProcessStopTrace ExitStatus before retrying.
    FileWrite $R8 '{"configuredExitCode":73,"failureKind":"one-shot-customInit","processId":$R9}'
    FileClose $R8
    SetErrorLevel 73
    Quit
  ${EndIf}
!macroend
