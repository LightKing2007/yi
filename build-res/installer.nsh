; Windows 安装程序的补充（打包时自动引入）：开头增设欢迎页，欢迎页、完成页、卸载页的文字按 docs/standards/09-text-and-i18n.md 书写。
; 欢迎页与完成页左侧为 installerSidebar.bmp 竖图。

!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "“弈”已成功安装至本计算机，并已在桌面创建快捷方式。$\r$\n$\r$\n单击“完成”退出安装向导。"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行“弈”"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用“弈”安装向导"
  !define MUI_WELCOMEPAGE_TEXT "本向导将引导您完成“弈”的安装。“弈”是一款围棋与五子棋游戏，支持人机对弈及联机对战。$\r$\n$\r$\n单击“下一步”继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载“弈”"
  !define MUI_WELCOMEPAGE_TEXT "本向导将从本计算机中卸载“弈”。您的段位及个人设置不受影响。$\r$\n$\r$\n单击“下一步”继续。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
