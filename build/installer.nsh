; Shell installer: relaunch after a silent install/update.
;
; electron-builder's assisted installer opens `MUI_PAGE_FINISH`, whose "run app"
; checkbox is what normally starts the shell. `/S` skips that page, so the shell's
; online updater would install a new version and leave the user with no window and no
; tray. `customInstall` runs after the files and shortcuts are written, so starting the
; app here gives the silent path the same outcome as clicking Finish.
!macro customInstall
  ${if} ${Silent}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${endif}
!macroend
