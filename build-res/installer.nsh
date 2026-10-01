; Windows 安装程序的补充：开头加一页欢迎页（左边是 installerSidebar.bmp 那张竖图），文字按游戏里的说法写
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 弈"
  !define MUI_WELCOMEPAGE_TEXT "弈是一款围棋与五子棋游戏，可以和电脑下，也可以联机对战。$\r$\n$\r$\n点下一步继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend
