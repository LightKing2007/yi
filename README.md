# 弈 · 五子棋 & 围棋

TypeScript 编写的 **桌面游戏**（macOS / Windows / Linux 安装包，Electron）。开发时也可以直接在浏览器里运行调试。
棋盘和棋子不使用任何贴图，全部由 WebGL2 着色器实时绘制：

- **榧木棋盘**：多层噪声生成的直纹、细年轮与木纤维，清漆柔光、倒角与棋盘厚度，悬浮投影
- **黑子**：云子质感，窗形柔光反射，背光一侧边缘透出墨绿色的通透感
- **白子**：温润如玉，细微贝纹、次表面散射、边缘透光
- 落子下落动画与软阴影、提子淡出、合成的落子声与程序化生成的背景音乐、深 / 浅两套主题、五种光影

## 界面随屏幕自动缩放

界面按 1320×900 的设计稿排版，运行时按窗口大小等比缩放（`u = min(宽/1320, 高/900)`），文字与图形都按屏幕的实际像素清晰渲染。
所以在 4K、Retina 等高分辨率屏幕上界面不会缩成一小块；窗口拉大、全屏时界面跟着放大。
「设置 · 画面 · 界面大小」可以在自动缩放的基础上再调小 / 调大（小、标准、大、特大）。

## 功能

| 五子棋 | 围棋 |
|---|---|
| 15 路，五子（及以上）连珠为胜 | 9 / 13 / 19 路 |
| 黑棋禁手（三三、四四、长连，可关闭），禁手点标红叉 | 提子、禁自杀、打劫判定 |
| 双人对弈 / 人机对弈（简单 · 普通 · 困难，可执黑或执白） | 双方连续停一手后进入点目：点击棋块标记死子，数子法计分，贴 7.5 目 |
| 胜利时震屏、冲击波、其余棋子被炸飞（可倒放查看棋局） | 人机对弈（普通 · 困难为蒙特卡洛树搜索），点目时自动估出死子 |

- **多人游戏**：一页三栏，全部通过服务器（界面上不出现服务器，进入时自动连接）：
  - **匹配**：选好棋类点「开始匹配」，与同一队列里等得最久的弈者配对；配对后显示对手，双方 15 秒内「接受」即开局，对方拒绝或超时则自动继续匹配。不计段位。
  - **排位**：同样的配对流程，对手旁显示段位；胜负按 Elo 计分，段位从十级、一级、初段直到九段（新手四级起步），跟着这台设备（本地生成的匿名身份）。中途离开按输棋计。
  - **好友**：「开房间」得到四位房号，好友在「加入房间」输入房号即开局。
  - 对局中悔棋、求和须对方同意（每局各 3 次，20 秒不回应视为拒绝），可认输；掉线 60 秒内自动重连；围棋点目须双方确认；匹配与好友局终局后可再来一局，排位局可「继续排位」。每一手都由服务端用同一套规则代码校验。
- **设置**（修改后自动保存）：音乐 / 音效与音量；语言（文言 · 中文 · English）、主题、终局特效、屏幕震动、界面大小、光影；落子动画、预览跟随、坐标、最后一手、禁手、电脑难度、人机执子。
- **快捷键**：`U` / `Ctrl+Z` 悔棋（联机时为申请） · `P` 停一手 · `V` 查看被炸飞的棋局 · `N` 新局 · `C` 坐标 · `T` 深浅主题 · `Esc` 返回 / 离开 / 取消匹配 · `1` 五子棋 · `2` 围棋 · `F11` 全屏（桌面版）

## 开发

需要 Node.js 22.13 或更新版本（见 `.nvmrc`）。

```bash
npm install
npm run dev          # 浏览器打开 http://localhost:5173 ，改代码即时刷新
npm test             # 规则、禁手、人机、联机服务端的测试
npm run typecheck
```

桌面版调试：先 `npm run dev`，另开一个终端 `npm run app:dev`（Electron 窗口加载开发服务器）。

本机测试联机：`npm run build:node && npm run server` 起一个本地服务端（端口 7700），浏览器打开
`http://localhost:5173/?server=ws://127.0.0.1:7700`，开两个标签页即可互相匹配或开好友房间。
（两个标签页共用同一个匿名身份，排位不会让同一台设备自己和自己配对；测排位可以用两个不同的浏览器。）

## 打包发行

```bash
npm run dist:mac     # release/Yi-2.0.0-mac-arm64.dmg、Yi-2.0.0-mac-x64.dmg
npm run dist:win     # release/Yi-2.0.0-win-x64-setup.exe（在 Windows 上打包）
npm run dist:linux   # release/Yi-2.0.0-linux-x86_64.AppImage（在 Linux 上打包）
```

- 应用图标由 [public/icon.svg](public/icon.svg) 生成：改了图标后运行 `npm run icon`，得到 `build-res/icon.png`，打包时自动转换成各平台格式。
- **macOS 签名与公证**：默认做临时（ad-hoc）签名，本机与自己的电脑可以直接运行；发给别人时，从网上下载的未公证应用会被系统拦截。
  正式发行需要 Apple 开发者账号：在钥匙串里装好「Developer ID Application」证书，把 `package.json` 里 `build.mac.identity` 的 `"-"` 删掉（让 electron-builder 自动找证书），
  并设置环境变量 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 进行公证，详见 <https://www.electron.build/code-signing-mac>。
- **Windows**：未签名的安装包首次运行时 SmartScreen 会提示「未知发布者」，点「仍要运行」即可；有代码签名证书时按 <https://www.electron.build/code-signing-win> 配置。
- **在线服务器地址**在 [.env.production](.env.production) 的 `VITE_YI_SERVER`，打包时读取；换服务器（或改成 `wss://域名`）时只改这一处，然后重新打包。
  没有配置时用 [src/online/config.ts](src/online/config.ts) 里的默认地址。

## 联机服务端

服务端是一个单文件的 Node 程序，不需要 `npm install`：

```bash
npm run build:node                 # 生成 dist-server/server.cjs
node dist-server/server.cjs 7700   # 端口默认 7700
```

段位存在运行目录下的 `yi-ratings.json`（可用环境变量 `YI_DATA` 指定路径），只记匿名身份的散列、昵称与段位分，备份这一个文件即可。

部署到服务器：把 `dist-server/server.cjs` 拷过去，装好 Node.js 20+，用 systemd 常驻（`/etc/systemd/system/yi.service`）：

```ini
[Unit]
Description=Yi online server
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/yi/server.cjs 7700
WorkingDirectory=/opt/yi
Restart=always
User=yi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now yi
journalctl -u yi -f                # 查看日志：上线、建房、开局、结束……
```

记得在云服务器的安全组 / 防火墙里放行 TCP 7700。游戏连接的服务器地址见上文「打包发行」里的 `VITE_YI_SERVER`。
**注意**：2.0 的联机协议（WebSocket + JSON，协议版本 3）与 1.x 的 C 版服务端不兼容，服务器上要换成新的 `server.cjs`
（`User=yi` 需要先 `sudo useradd -r yi && sudo chown yi /opt/yi`，让服务端能写段位文件）。

需要 `wss://` 时，用 Nginx / Caddy 反向代理并配证书，例如 Caddy：`yi.example.com { reverse_proxy 127.0.0.1:7700 }`；
这时给服务端设环境变量 `HOST=127.0.0.1`（systemd 里加一行 `Environment=HOST=127.0.0.1`），让它只接受本机反向代理的连接，并在安全组里关掉 7700。

## 语言

界面文字有 **文言**（默认）、**中文**、**English** 三种。代码里照常写中文原文，显示时经 `T()` / `TF()`（[src/i18n/index.ts](src/i18n/index.ts)）换成当前语言；
译文都在 [src/i18n/table.ts](src/i18n/table.ts)，新增界面文字时在那里补一行（开发模式下缺译文会在控制台提示）。
服务端发来的提示也是中文原文，客户端照样翻译。

## 源码结构

```
src/
  main.tsx            入口：启动画面循环与界面
  core/               规则核心（不依赖画面，服务端也用）
    game.ts             对局状态、落子 / 提子 / 打劫 / 点目 / 悔棋 / 历史，以及发给应用层的事件
    renju.ts            五子棋禁手判定（三三、四四、长连）
    gomokuAI.ts         五子棋人机；goAI.ts 围棋人机（蒙特卡洛树搜索、估死子）
  app/                app（主循环、布局、输入）、stage（每帧的场景更新与绘制顺序）、controller（对局操作与快捷键）、
                      state（界面与对局状态）、settings（设置，存在本地存储）、ai.worker（电脑在后台线程思考）
  render/             gl（WebGL2 批量绘制）、shaders（全部着色器）、painter（绘制原语）、board、layout（自动缩放的布局）、theme
  fx/                 终局特效：gomokuWin、blow（炸飞与倒放）、goEnd、rewind、ghost（落子预览）、gather
  scene/              bowls（棋罐）、light（五种光影）、online（多人游戏页棋盘上的布置）
  audio/              合成音效与程序化背景音乐（在 Worker 里合成）
  online/config.ts    在线服务器地址（构建时从 VITE_YI_SERVER 读取）
  online/client.ts    联机会话：匹配 / 排位队列、配对确认、好友房间、对局中的各种请求；确认后的每一步交给本地规则执行
  shared/protocol.ts  联机协议（客户端与服务端共用）与段位表
  ui/                 Preact 界面：panels（菜单 / 对局 / 设置 / 更多）、online（多人游戏：匹配 · 排位 · 好友）、widgets、styles.css、info（“更多”的文字）
  i18n/               多语言
server/               rooms.ts 队列、配对、房间、对局与段位（与传输无关）、store.ts 段位存档、host.ts 接到 WebSocket、main.ts 入口
electron/             桌面版主进程（窗口、匹配成功时的任务栏提醒）与预加载
tests/                vitest：rules（规则与人机）、server（联机服务端）
scripts/              build-node（打包主进程与服务端）、make-icon（生成图标）
```

画面分四层：`#scene`（WebGL：背景、棋盘、棋子、棋罐、光影）、`#ui`（Preact 界面）、`#over`（飞过界面的碎子）、`#glow`（叠加的光）。

## 版权

Copyright 2026 LightKing All rights Reserved.

使用 [Preact](https://preactjs.com)、[Electron](https://www.electronjs.org)、[ws](https://github.com/websockets/ws)（均为 MIT 许可）。
