!macro AGENTBOX_STOP_SIDECAR
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "agentbox-sidecar.exe"
  !else
    nsis_tauri_utils::KillProcess "agentbox-sidecar.exe"
  !endif
  Pop $R0
  Sleep 800
!macroend

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping AgentBox sidecar..."
  !insertmacro AGENTBOX_STOP_SIDECAR
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping AgentBox sidecar..."
  !insertmacro AGENTBOX_STOP_SIDECAR
!macroend
