; 有秋 NSIS 安装器钩子。
; Tauri 模板按 ${PRODUCTNAME}（Yield）命名快捷方式，而主程序名是「有秋」，需要对创建结果统一改名。
; 模板创建快捷方式共三处，时机各不相同：
;   1) 开始菜单：主安装段内、本钩子之前创建 → 钩子直接改名；
;   2) 桌面（静默/被动安装）：也在主安装段内、钩子之前创建 → 钩子直接改名；
;   3) 桌面（GUI 安装）：完成页「创建桌面快捷方式」勾选后、点击「完成」时才创建，
;      晚于一切安装钩子 → 用 .onGUIEnd（模板未定义该回调）在安装器窗口关闭时改名。
; 另：MUI2 开始菜单页的「不要创建快捷方式」勾选后，$AppStartMenuFolder 会带 ">"
; 前缀（MUI2 约定，模板不检查），模板会误建 ">有秋" 文件夹——钩子负责清理并尊重该选择。
; 卸载前补删改名版——模板卸载逻辑只认 ${PRODUCTNAME}.lnk 名字，不处理会留残留。
; ⚠ 本文件必须是 UTF-8 with BOM：.onGUIEnd 函数体在模板 define 之前编译，
;   无法用 ${PRODUCTNAME}/${MAINBINARYNAME}（会留成字面量），只能写字面量文件名。
;   若更改 productName / mainBinaryName，必须同步修改 .onGUIEnd 中的两处文件名。

!macro NSIS_HOOK_POSTINSTALL
  ; 桌面：清理指向本程序但叫 ${PRODUCTNAME}.lnk 的旧快捷方式（旧版安装残留）。
  ; GUI 安装时完成页尚未执行，桌面快捷方式是否创建由完成页勾选决定，.onGUIEnd 负责改名。
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}

  ; 静默/被动安装跳过完成页，模板已在钩子前创建桌面快捷方式，这里统一命名
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    CreateShortcut "$DESKTOP\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${MAINBINARYNAME}.lnk"
  ${EndIf}

  ; 开始菜单：统一命名；勾选「不要创建快捷方式」时（">" 前缀）清理模板误建项且不创建
  StrCpy $R9 "$AppStartMenuFolder" 1
  ${If} $R9 == ">"
    Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${ElseIf} $AppStartMenuFolder == ""
    CreateShortcut "$SMPROGRAMS\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${MAINBINARYNAME}.lnk"
  ${Else}
    Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk"
  ${EndIf}
!macroend

; GUI 安装：完成页勾选「创建桌面快捷方式」后创建的是 Yield.lnk（= productName）。
; 安装器窗口关闭时统一改名为「有秋」；若改名版已存在（升级重装/被动模式重复创建）则删除多余的。
; 此处只可用 NSIS 内置指令（$PLUGINSDIR 已清空，插件宏不可用），名字见文件头同步说明。
Function .onGUIEnd
  ${If} ${FileExists} "$DESKTOP\Yield.lnk"
    ${If} ${FileExists} "$DESKTOP\有秋.lnk"
      Delete "$DESKTOP\Yield.lnk"
    ${Else}
      Rename "$DESKTOP\Yield.lnk" "$DESKTOP\有秋.lnk"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_PREUNINSTALL
  ; 与安装侧对称：模板卸载只删 ${PRODUCTNAME}.lnk，这里补删改名版
  !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
  !insertmacro UnpinShortcut "$DESKTOP\${MAINBINARYNAME}.lnk"
  Delete "$DESKTOP\${MAINBINARYNAME}.lnk"
  !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk"
  Delete "$SMPROGRAMS\$AppStartMenuFolder\${MAINBINARYNAME}.lnk"
  RMDir "$SMPROGRAMS\$AppStartMenuFolder"
  !insertmacro UnpinShortcut "$SMPROGRAMS\${MAINBINARYNAME}.lnk"
  Delete "$SMPROGRAMS\${MAINBINARYNAME}.lnk"
!macroend
