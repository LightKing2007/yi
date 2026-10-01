; Windows 安装程序的补充（打包时自动引入）：开头加一页欢迎页，欢迎页、完成页、卸载页的文字按游戏里的说法写。
; 欢迎页与完成页左边是 installerSidebar.bmp 那张竖图。

!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "弈已经装好了，桌面上有它的快捷方式。$\r$\n$\r$\n点完成关闭这个窗口。"
!define MUI_FINISHPAGE_RUN_TEXT "现在就打开弈"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 弈"
  !define MUI_WELCOMEPAGE_TEXT "弈是一款围棋与五子棋游戏，可以和电脑下，也可以联机对战。$\r$\n$\r$\n点下一步继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载 弈"
  !define MUI_WELCOMEPAGE_TEXT "将从这台电脑上卸载弈。$\r$\n$\r$\n点下一步继续。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
