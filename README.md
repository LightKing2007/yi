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

- **联机对战**：一页三栏，全部通过服务器（界面上不出现服务器，进入时自动连接）：
  - **匹配**：选好棋类点「开始匹配」，与同一队列里等得最久的弈者配对；配对后显示对手，双方 15 秒内「接受」即开局，对方拒绝或超时则自动继续匹配。不计段位。
  - **排位**：同样的配对流程，对手旁显示段位；胜负按 Elo 计分，段位从十级、一级、初段直到九段（新手四级起步），跟着这台设备（本地生成的匿名身份）。中途离开按输棋计。
  - **好友**：「开房间」得到四位房号，好友在「加入房间」输入房号即开局。
  - 对局中悔棋、求和须对方同意（每局各 3 次，20 秒不回应视为拒绝），可认输；围棋点目须双方确认；匹配与好友局终局后可再来一局，排位局可「继续排位」。每一手都由服务端用同一套规则代码校验。
  - **断线**：网络断开（包括 25 秒收不到任何消息的静默断开）后自动重连，60 秒内回来接着下；有人掉线期间双方都不计时。断线期间对局已经结束的，回来后看到结果与段位变化；服务器重启过或掉线太久、对局已无法恢复时，直接提示并回到多人游戏页。
  - 同一台电脑同时只能进行一局排位；服务器有新版本时，开始菜单与联机对战页会提示下载。
- **设置**（修改后自动保存）：音乐 / 音效与音量；语言（文言 · 中文 · English）、主题、终局特效、屏幕震动、界面大小、光影；落子动画、预览跟随、坐标、最后一手、禁手、电脑难度、人机执子。
- **快捷键**：`U` / `Ctrl+Z` 悔棋（联机时为申请） · `P` 停一手 · `V` 查看被炸飞的棋局 · `N` 新局 · `C` 坐标 · `T` 深浅主题 · `Esc` 返回 / 离开 / 取消匹配 · `1` 五子棋 · `2` 围棋 · `F11` 全屏（桌面版）

## 开发

需要 Node.js 22.13 或更新版本（见 `.nvmrc`）。

```bash
npm install
npm run dev          # 浏览器打开 http://localhost:5173 ，改代码即时刷新
npm test             # 规则、禁手、人机、联机服务端与联机客户端的测试
npm run typecheck
```

**画面回归检查**（改动画面或规则代码前后用）：`npm run shots -- base` 在不显示的窗口里跑完全部场景脚本（[src/app/scenarios.ts](src/app/scenarios.ts)），
把各特效关键时刻的截图存到 `.shots/base/`；改完代码后 `npm run shots` 再截一组，`node scripts/compare-shots.mjs` 逐像素对比，有差异的在 `.shots/diff/` 里标红。
开发时也可以在浏览器里打开 `http://localhost:5173/?scenario=gomoku-win&hold=1` 直接看某个场景。

桌面版调试：先 `npm run dev`，另开一个终端 `npm run app:dev`（Electron 窗口加载开发服务器）。

本机测试联机：`npm run build:node && npm run server` 起一个本地服务端（端口 8443），浏览器打开
`http://localhost:5173/?server=ws://127.0.0.1:8443`，开两个标签页即可互相匹配或开好友房间。
（两个标签页共用同一个匿名身份，排位不会让同一台设备自己和自己配对；测排位可以用两个不同的浏览器。）

## 打包发行

```bash
npm run dist:mac     # release/Yi-<版本>-mac-arm64.dmg、Yi-<版本>-mac-x64.dmg
npm run dist:win     # release/Yi-<版本>-win-x64-setup.exe（在 Windows 上打包）
npm run dist:linux   # release/Yi-<版本>-linux-x86_64.AppImage（在 Linux 上打包）
```

- **版本号**只写在 `package.json` 的 `version` 一处，游戏里显示的版本号在构建时从这里取。
- **发版**（在 GitHub 上自动打三个平台的安装包）：改好 `package.json` 的版本号并提交，然后
  `git tag v<版本> && git push origin v<版本>`。Actions 里的 Release 会在 macOS、Windows、Linux 上分别打包，
  建一个草稿 Release 附上全部安装包，在网页上确认后点发布。最后把服务端的 `YI_LATEST` 改成新版本号，提示大家更新。
  不打标签时也可以在 Actions 页面手动运行 Release，只打包、作为附件下载。私有仓库里 macOS 机器按 10 倍计分钟数，所以平时不自动跑。
- **各平台的界面截图**：在 Actions 页面手动运行“UI 截图”，会在 Windows、Linux 上截开始菜单、对局、设置、更多、联机对战（中文与文言），
  用来检查字体与排版；本机也可以 `npx electron scripts/ui-shots.cjs 输出目录`。
- **错误日志**：桌面版把出错信息写到用户数据目录下的 `logs/yi.log`（超过 1 MB 时换成 `yi.old.log`），「更多 · 关于」里有「打开日志文件夹」。只在本机，不上传。

- **附带的字体**：`src/ui/assets/fonts/` 里是思源黑体、思源宋体（SIL OFL 许可）只含游戏用字的子集，约 1.4 MB。
  系统里有中文字体时优先用系统的（macOS 完全不受影响），没有中文字体的 Linux 用它们，Windows 上的标题也用它而不用强行加粗的宋体。
  改了界面文字之后运行 `node scripts/make-fonts.mjs` 重新生成（原始字体的下载地址写在脚本开头，放在不进仓库的 `.fonts-src/`）。
- 开始菜单的大字「弈」是宣传片片名同款的行楷（macOS 的 Xingkai SC），预先渲染成 `src/ui/assets/title-yi.png`，程序里只带这张图、不带字体文件（系统字体不能随程序分发）。要重新生成：在 Mac 上运行 `npm run title-art`（行楷若未下载，先在「字体册」里下载）。
- 应用图标是暖白圆角方块正中一个墨色行楷「弈」，由 [scripts/make-icon.swift](scripts/make-icon.swift) 画出：在 Mac 上运行 `npm run icon`（也可 `npm run icon -- seal` 加上红色「棋」印，或 `-- ink` 用深色底），得到 `build-res/icon.png`（打包时自动转换成各平台格式）与 `public/icon.png`（窗口图标）。
- **macOS 签名与公证**：默认做临时（ad-hoc）签名，本机与自己的电脑可以直接运行；发给别人时，从网上下载的未公证应用会被系统拦截，
  对方第一次打开要在 Finder 里右键「打开」，或到「系统设置 · 隐私与安全性」里点「仍要打开」。
  正式发行需要 Apple 开发者账号：在钥匙串里装好「Developer ID Application」证书，把 `package.json` 里 `build.mac.identity` 的 `"-"` 删掉（让 electron-builder 自动找证书），
  并设置环境变量 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 进行公证，详见 <https://www.electron.build/code-signing-mac>。
- **Windows**：未签名的安装包首次运行时 SmartScreen 会提示「未知发布者」，点「仍要运行」即可；有代码签名证书时按 <https://www.electron.build/code-signing-win> 配置。
- **在线服务器地址**在 [.env.production](.env.production) 的 `VITE_YI_SERVER`，打包时读取；换服务器（或改成 `wss://域名`）时只改这一处，然后重新打包。
  没有配置时用 [src/online/config.ts](src/online/config.ts) 里的默认地址。

## 联机服务端

服务端是一个单文件的 Node 程序，不需要 `npm install`：

```bash
npm run build:node                 # 生成 dist-server/server.cjs
node dist-server/server.cjs 8443   # 端口默认 8443
```

线上服务器的部署与更新方法见下文。段位存在运行目录下的 `yi-ratings.json`（可用环境变量 `YI_DATA` 指定路径），只记匿名身份的散列、昵称与段位分，备份这一个文件即可。

服务端的环境变量：

| 变量 | 作用 |
|---|---|
| `PORT` | 端口（也可以写在命令行参数里），默认 8443 |
| `EXTRA_PORTS` | 另外同时监听的端口，逗号分隔。换端口的过渡期让老版本客户端照常连上，例如 `7700` |
| `HOST` | 监听地址，默认所有网卡；放在反向代理后面时设为 `127.0.0.1` |
| `YI_DATA` | 段位存档的路径 |
| `YI_LATEST` | 最新的客户端版本号，例如 `2.0.1`。客户端版本较旧时，开始菜单和联机对战页会提示有新版本 |
| `YI_DOWNLOAD` | 新版本的下载地址（`https://`），提示可以点开 |

同一个 IP 最多同时 8 条连接；同一条连接一分钟内加入房间失败 5 次后，暂时不能再试。

部署（线上服务器 47.108.181.240，Ubuntu 24.04，已按下面的方式配好）：

| 位置 | 内容 |
|---|---|
| `/opt/node/` | Node 24 官方二进制包（从 npmmirror 下载、校验后解压，不动系统软件包） |
| `/opt/yi/server.cjs` | 服务端（root 所有，只读） |
| `/var/lib/yi/` | 段位存档，归系统用户 `yi` 所有（`useradd --system --no-create-home --shell /usr/sbin/nologin yi`） |
| `/etc/systemd/system/yi.service` | 常驻服务，开机自启，崩溃后 3 秒自动重启 |

```ini
[Unit]
Description=Yi online server (Gomoku & Go)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=yi
Group=yi
WorkingDirectory=/var/lib/yi
ExecStart=/opt/node/bin/node /opt/yi/server.cjs 8443
Environment=NODE_ENV=production
Environment=YI_DATA=/var/lib/yi/yi-ratings.json
Environment=YI_LATEST=2.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/yi

[Install]
WantedBy=multi-user.target
```

更新服务端（在本机项目目录里）：

```bash
npm run build:node && scp dist-server/server.cjs root@47.108.181.240:/opt/yi/server.cjs && ssh root@47.108.181.240 'systemctl restart yi && journalctl -u yi -n 3 --no-pager'
```

查看日志：`ssh root@47.108.181.240 journalctl -u yi -f`（上线、建房、开局、结束……）。改了 service 文件后执行 `systemctl daemon-reload && systemctl restart yi`。
阿里云安全组要放行 TCP 8443。重启服务端会中断正在进行的对局，尽量挑没人下棋的时候。
1.x 的 C 版服务端（端口 7700）已经停用并清理，1.x 客户端不能再联机。

域名 `yi.lightking.com.cn` 已解析到这台服务器，等 ICP 备案通过后再配 `wss://`（备案前阿里云会拦截未备案域名在 80 / 443 上的访问）。
到时用 Caddy 反向代理并自动申请证书：`yi.lightking.com.cn { reverse_proxy 127.0.0.1:8443 }`；
这时给服务端设环境变量 `HOST=127.0.0.1`（systemd 里加一行 `Environment=HOST=127.0.0.1`），让它只接受本机反向代理的连接，并在安全组里关掉 8443，只开放 443。

## 语言

界面文字有 **文言**（默认）、**中文**、**English** 三种。代码里照常写中文原文，显示时经 `T()` / `TF()`（[src/i18n/index.ts](src/i18n/index.ts)）换成当前语言；
译文都在 [src/i18n/table.ts](src/i18n/table.ts)，新增界面文字时在那里补一行（开发模式下缺译文会在控制台提示）。
服务端发来的提示也是中文原文，客户端照样翻译。

## 源码结构

```
src/
  main.tsx            入口：启动画面循环与界面
  core/               规则核心（不依赖画面，服务端也用）
    rules/index.ts      规则：纯函数，给定局面与一手棋返回新局面或不合法的原因（错误码）；点目
    move.ts、config.ts  着法、错误码、对局结果；一局的规则设置
    record.ts           棋谱与回放
    game.ts             对局：历史、棋谱、点目标记、胜负，通过 listener 通知画面层
    renju.ts            五子棋禁手判定（三三、四四、长连）
    gomokuAI.ts         五子棋人机；goAI.ts 围棋人机（蒙特卡洛树搜索、估死子）
  app/                app（主循环、布局、输入）、stage（每帧的场景更新与绘制顺序）、controller（对局操作与快捷键）、
                      state（界面与对局状态）、settings（设置，存在本地存储）、native（桌面版的系统功能与错误日志）、scenarios（开发用的场景脚本）
  session/            对局会话：session（三种模式下谁来落子、悔棋退几手）、seats（人、电脑、联机的一方）、
                      think 与 computer.worker（电脑在后台线程里想棋、估死子，可以随时取消）
  presentation/       boardView（棋盘的动画状态：落子、提子、悔棋倒放、换棋盘、胜负动画、提示）
  render/             gl（WebGL2 批量绘制）、shaders（全部着色器）、painter（绘制原语）、board、layout（自动缩放的布局）、theme
  fx/                 终局特效：gomokuWin、blow（炸飞与倒放）、goEnd、rewind、ghost（落子预览）、gather
  scene/              bowls（棋罐）、light（五种光影）、online（联机对战页棋盘上的布置）
  audio/              合成音效与程序化背景音乐（在 Worker 里合成）
  online/config.ts    在线服务器地址（构建时从 VITE_YI_SERVER 读取）
  online/client.ts    联机会话：匹配 / 排位队列、配对确认、好友房间、对局中的各种请求；确认后的每一步交给本地规则执行
  shared/protocol.ts  联机协议（客户端与服务端共用）与段位表；reject.ts 不合法着法的提示文字
  ui/                 Preact 界面：panels（菜单 / 对局 / 设置 / 更多）、online（联机对战：匹配 · 排位 · 好友）、widgets、styles.css、info（“更多”的文字）
  i18n/               多语言
server/               rooms.ts 队列、配对、房间、对局与段位（与传输无关）、store.ts 段位存档、host.ts 接到 WebSocket（可同时监听几个端口）、main.ts 入口
electron/             桌面版主进程（窗口、只允许一个实例、匹配成功时的任务栏提醒、错误日志）与预加载
tests/                vitest：rules（规则与人机）、record（规则层与棋谱）、session（会话与座位）、server（联机服务端）、client（联机客户端：断线、重连、服务器重启）、
                      layers（依赖方向：模块之间没有互相引用，各层只朝允许的方向依赖）
scripts/              build-node（打包主进程与服务端）、make-icon.swift（生成图标）、make-title.swift（生成开始菜单的标题字）、
                      shots.cjs 与 compare-shots.mjs（场景截图与逐像素对比）
```

画面分四层：`#scene`（WebGL：背景、棋盘、棋子、棋罐、光影）、`#ui`（Preact 界面）、`#over`（飞过界面的碎子）、`#glow`（叠加的光）。

## 路线图

后续的改造计划（规则层重构、数据库与对局记录、账号与排位反作弊、三平台自动出包等）见 [docs/PLAN.md](docs/PLAN.md)。

## 版权

Copyright 2026 LightKing All rights Reserved.

使用 [Preact](https://preactjs.com)、[Electron](https://www.electronjs.org)、[ws](https://github.com/websockets/ws)（均为 MIT 许可），
附带[思源黑体、思源宋体](https://github.com/notofonts/noto-cjk)的子集（SIL Open Font License 1.1）。
