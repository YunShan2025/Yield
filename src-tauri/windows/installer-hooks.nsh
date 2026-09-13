; 有秋 NSIS 安装器钩子。
; Tauri 模板按 ${PRODUCTNAME}（Yield）命名快捷方式，而主程序名是「有秋」，
; 导致桌面出现 Yield.lnk、开始菜单为 有秋\Yield.lnk 的命名不一致。
; 这里在安装完成后统一改名为主程序名；卸载前补删重命名版——
; 模板卸载逻辑只认 ${PRODUCTNAME}.lnk 这个名字，不处理会留残留。
; 保持本文件纯 ASCII：中文一律经 ${MAINBINARYNAME} / ${PRODUCTNAME} 定义注入。

!macro NSIS_HOOK_POSTINSTALL
  ; 桌面：删 PRODUCTNAME 命名的快捷方式，建 MAINBINARYNAME 命名的（重名则覆盖）
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  CreateShortcut "$DESKTOP\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${MAINBINARYNAME}.lnk"

  ; 开始菜单：沿用安装器记住的文件夹（startMenuFolder 配置），统一命名
  Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${If} $AppStartMenuFolder == ""
    CreateShortcut "$SMPROGRAMS\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${MAINBINARYNAME}.lnk"
  ${Else}
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 与 POSTINSTALL 对称：模板卸载只删 ${PRODUCTNAME}.lnk，这里补删改名版
  !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
  !insertmacro UnpinShortcut "$DESKTOP\${MAINBINARYNAME}.lnk"
  Delete "$DESKTOP\${MAINBINARYNAME}.lnk"
  !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk"
  RMDir "$SMPROGRAMS\$AppStartMenuFolder"
  !insertmacro UnpinShortcut "$SMPROGRAMS\${MAINBINARYNAME}.lnk"
  Delete "$SMPROGRAMS\${MAINBINARYNAME}.lnk"
!macroend
