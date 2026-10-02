# 弈 · 五子棋 & 围棋

“弈”是一款围棋与五子棋桌面游戏，支持人机对弈及联机对战。游戏以 TypeScript 编写，通过 Electron 提供 macOS、Windows 及 Linux 平台的安装程序；开发期间亦可在浏览器中运行调试。

本文档说明项目的功能、开发方法、打包发行、联机服务端部署及源码结构。项目的工程规范、操作规程、计划与审计报告见 [docs/README.md](docs/README.md)。

## 1 概述

### 1.1 画面

棋盘与棋子不使用任何贴图，全部由 WebGL2 着色器实时绘制：

- **榧木棋盘**：以多层噪声生成直纹、细年轮及木纤维，具有清漆柔光、倒角、棋盘厚度及悬浮投影；
- **黑子**：云子质感，带窗形柔光反射，背光一侧边缘透出墨绿色；
- **白子**：质感温润，带细微贝纹、次表面散射及边缘透光；
- **其他**：落子下落动画与软阴影、提子淡出、合成的落子声及程序生成的背景音乐、浅色与深色两套主题、五种光影效果。

### 1.2 界面缩放

界面按 1320×900 的设计尺寸排版，运行时按窗口大小等比缩放（缩放系数 `u = min(宽/1320, 高/900)`），文字与图形均按屏幕实际像素渲染。因此在 4K、Retina 等高分辨率屏幕上，界面尺寸正常；窗口放大或全屏时，界面随之放大。玩家可在“设置”的“画面”页中，于自动缩放的基础上选择小、标准、大、特大四种界面大小。

## 2 功能

### 2.1 棋类规则

| 五子棋 | 围棋 |
|---|---|
| 15 路棋盘，连成五子（含）以上者胜 | 9 路、13 路、19 路棋盘 |
| 黑方禁手：三三、四四、长连（可关闭），禁手点以红色小叉标示 | 提子、禁着点及打劫判定 |
| 双人对弈及人机对弈（简单、普通、困难；可执黑或执白） | 双方连续停一手后进入点目阶段：点击棋块标记死子，按数子法计分，贴 7.5 目 |
| 获胜时屏幕震动，冲击波击散其余棋子（可倒放查看棋局） | 人机对弈（普通及困难等级采用蒙特卡洛树搜索），点目时自动估算死子 |

### 2.2 联机对战

联机对战页面分为三栏，全部经由服务器进行。界面中不显示服务器地址，进入页面时自动连接。

| 模式 | 说明 |
|---|---|
| 匹配 | 选定棋类后点击“开始匹配”，系统与同一队列中等待时间最长的玩家配对；配对后显示对手，双方须在 15 秒内点击“接受”方可开局，对方拒绝或超时则自动继续匹配。不计段位。 |
| 排位 | 配对流程与匹配相同，对手名称旁显示段位。胜负按 Elo 等级分计算，段位自十级、一级、初段直至九段（新玩家自四级起始），与本机生成的匿名身份绑定。中途离开按负局计。 |
| 好友 | 点击“开房间”获得四位房号，好友在“加入房间”中输入房号即可开局。 |

对局规则如下：

- 悔棋、求和须经对方同意，每局每方各限 3 次，20 秒内未回应视为拒绝；玩家可随时认输；
- 围棋点目结果须经双方确认；
- 匹配及好友对局结束后可再来一局，排位对局结束后可“继续排位”；
- 每一手棋均由服务端以同一套规则代码校验。

断线处理如下：

- 网络断开（含 25 秒内未收到任何消息的静默断开）后，客户端自动重连，60 秒内恢复连接可继续对局；
- 任一方掉线期间，双方均暂停计时；
- 断线期间对局已结束的，恢复连接后显示结果及段位变化；
- 服务器已重启或掉线时间过长、对局无法恢复时，客户端明确提示，并返回联机对战页面。

其他限制如下：

- 同一台计算机同时只能进行一局排位对局；
- 服务器发布新版本时，开始菜单及联机对战页面提示下载。

### 2.3 设置与快捷键

设置修改后自动保存，包括：

- 音乐、音效及音量；
- 语言（文言、中文、English）、主题、终局特效、屏幕震动、界面大小、光影；
- 落子动画、预览跟随、坐标、最后一手标记、禁手、电脑难度、人机执子。

| 按键 | 功能 |
|---|---|
| `U`、`Ctrl+Z` | 悔棋（联机时为申请悔棋） |
| `P` | 停一手 |
| `V` | 查看击散前的棋局 |
| `N` | 新局 |
| `C` | 显示或隐藏坐标 |
| `T` | 切换浅色或深色主题 |
| `Esc` | 返回、离开对局或取消匹配 |
| `1`、`2` | 切换至五子棋、围棋 |
| `F11` | 全屏（桌面版） |

## 3 开发

### 3.1 环境

开发环境应使用 Node.js 22.13 或更高版本（见 `.nvmrc`）。

```bash
npm install          # 安装依赖，并启用 .githooks 中的 Git 钩子
npm run dev          # 启动开发服务器，浏览器打开 http://localhost:5173，修改代码后即时刷新
npm test             # 运行全部测试
npm run typecheck    # 类型检查
```

### 3.2 画面回归检查

修改画面或规则代码前后，宜进行画面回归检查：

1. 运行 `npm run shots -- base`，在不显示的窗口中执行全部场景脚本（[src/app/scenarios.ts](src/app/scenarios.ts)），将各特效关键时刻的截图保存至 `.shots/base/`；
2. 修改代码后运行 `npm run shots`，再截取一组；
3. 运行 `node scripts/compare-shots.mjs` 逐像素对比，存在差异的部分在 `.shots/diff/` 中以红色标出。

开发期间亦可在浏览器中打开 `http://localhost:5173/?scenario=gomoku-win&hold=1`，直接查看指定场景。

### 3.3 桌面版调试

先运行 `npm run dev`，再在另一终端运行 `npm run app:dev`，Electron 窗口将加载开发服务器。

### 3.4 本机联机测试

1. 运行 `npm run build:node && npm run server`，在本机启动服务端（端口 8443）；
2. 在浏览器中打开 `http://localhost:5173/?server=ws://127.0.0.1:8443`；
3. 打开两个标签页，即可互相匹配或创建好友房间。

同一浏览器的两个标签页共用同一匿名身份，排位模式不会使同一设备与自身配对；测试排位模式时应使用两个不同的浏览器。

## 4 打包与发行

### 4.1 本机打包

```bash
npm run dist:mac     # release/Yi-<版本>-mac-arm64.dmg、Yi-<版本>-mac-x64.dmg
npm run dist:win     # release/Yi-<版本>-win-x64-setup.exe（宜在 Windows 上打包）
npm run dist:linux   # release/Yi-<版本>-linux-x86_64.AppImage（宜在 Linux 上打包）
```

正式发行不在本机打包，而是按 [开发与发布规程](docs/procedures/release.md) 由 GitHub Actions 自动完成。面向玩家的下载地址统一为下载页面 <http://47.108.181.240:8443/>；本仓库公开，GitHub Release 中的附件与下载页面上的安装程序相同。

### 4.2 版本号

版本号仅在 `package.json` 的 `version` 中定义，游戏内显示的版本号及服务端的版本号均在构建时由此读取。版本号规则见 VER-002（[docs/standards/08-versioning.md](docs/standards/08-versioning.md)）。

### 4.3 错误日志

桌面版将错误信息写入用户数据目录下的 `logs/yi.log`，文件超过 1 MB 时更名为 `yi.old.log`。“更多”中的“关于”页面提供“打开日志文件夹”功能。日志仅保存于本机，不上传。

### 4.4 内置字体

`src/ui/assets/fonts/` 中为思源黑体、思源宋体（SIL 开放字体许可证）仅含游戏用字的子集，合计约 1.4 MB。系统中安装有中文字体时优先使用系统字体（macOS 不受影响）；未安装中文字体的 Linux 系统使用内置字体；Windows 平台的标题亦使用内置字体，以替代经程序加粗的宋体。

修改界面文字后，应运行 `node scripts/make-fonts.mjs` 重新生成子集。原始字体的下载地址见该脚本开头，原始文件存放于不纳入版本控制的 `.fonts-src/` 目录。

### 4.5 图像资源

| 资源 | 文件 | 说明 |
|---|---|---|
| 开始菜单标题 | `src/ui/assets/title-yi.png` | 行楷“弈”字（macOS 的 Xingkai SC，与宣传片片名一致）预先渲染的图像；系统字体不得随程序分发，故程序仅附带该图像 |
| 应用程序图标 | `build-res/icon.png`、`public/icon.png` | 暖白圆角方块，中央为墨色行楷“弈”，右下角为红色“棋”字印章；前者为 1024×1024，打包时转换为各平台格式，后者为窗口图标 |
| Windows 安装程序插图 | `build-res/installerSidebar.bmp`、`build-res/installerHeader.bmp` | 前者为欢迎页及完成页左侧竖图，后者为其他页面右上角图像 |
| Windows 安装程序文字 | `build-res/installer.nsh` | 欢迎页、完成页及卸载页的文字 |

### 4.6 代码签名

**macOS**：默认采用临时签名（ad-hoc），可在本机直接运行。从网络下载的未经公证的应用程序会被系统拦截，首次打开时须在“访达”中按住 Control 键点按该应用程序并选择“打开”，或在“系统设置”的“隐私与安全性”中点按“仍要打开”。

正式发行须具备 Apple 开发者账号，步骤如下：

1. 在钥匙串中安装“Developer ID Application”证书；
2. 删除 `package.json` 中 `build.mac.identity` 的值 `"-"`，使 electron-builder 自动查找证书；
3. 设置环境变量 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 及 `APPLE_TEAM_ID` 以进行公证。

详见 <https://www.electron.build/code-signing-mac>。

**Windows**：未签名的安装程序首次运行时，SmartScreen 将提示“Windows 已保护你的电脑”，点击“更多信息”后再点击“仍要运行”即可。具备代码签名证书时，按 <https://www.electron.build/code-signing-win> 配置。

### 4.7 在线服务器地址

在线服务器地址由 [.env.production](.env.production) 中的 `VITE_YI_SERVER` 定义，打包时读取。更换服务器或改用 `wss://` 域名时，仅需修改此处并重新打包。未定义时使用 [src/online/config.ts](src/online/config.ts) 中的默认地址。

## 5 联机服务端

### 5.1 构建与运行

服务端为单文件 Node.js 程序，运行时无须安装依赖：

```bash
npm run build:node                 # 生成 dist-server/server.cjs
node dist-server/server.cjs 8443   # 默认端口为 8443
node dist-server/server.cjs --version
```

段位数据保存于运行目录下的 `yi-ratings.json`（可由环境变量 `YI_DATA` 指定路径），仅记录匿名身份的散列值、昵称及段位分。备份时仅需备份该文件。存档的读写规则如下（DAT-050 至 DAT-054）：

- 每次写盘前，上一版存档保留为同目录下的 `yi-ratings.json.prev`；
- 存档存在但无法解析时，服务端拒绝启动并以退出码 65 退出（无法读取时为 74），原文件保持不动，须由维护者从 `.prev` 或备份恢复；
- 个别记录损坏时，这些玩家按新玩家处理，原文件另存为 `yi-ratings.json.corrupt`；
- 写盘失败时，数据保留在内存中，按 1 秒、2 秒、4 秒……的间隔重试，间隔最长 60 秒；退出前仍无法写盘时，数据转储到同目录下的 `emergency-时间.json`。

### 5.2 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | 端口，亦可在命令行参数中指定，默认为 8443 |
| `EXTRA_PORTS` | 同时监听的其他端口，以逗号分隔；用于更换端口的过渡期，使旧版客户端仍可连接，例如 `7700` |
| `HOST` | 监听地址，默认为全部网卡；置于反向代理之后时应设为 `127.0.0.1` |
| `YI_DATA` | 段位数据文件的路径 |
| `YI_LATEST` | 最新客户端版本号，例如 `2.0.2`；客户端版本较旧时，开始菜单及联机对战页面提示有新版本 |
| `YI_DOWNLOAD` | 新版本的下载地址（`http://` 或 `https://`），提示可点击打开 |
| `YI_FILES` | 安装程序所在目录。设置后，服务端在同一端口提供下载页面 `http://地址:端口/`，列出各平台最新的 `Yi-版本-平台` 安装程序，支持断点续传；每个 IP 同时最多 2 个下载，全服最多 8 个 |

同一 IP 同时最多建立 8 条连接；同一连接在一分钟内加入房间失败 5 次后，暂时不得再次尝试。

### 5.3 线上部署

线上服务器为 47.108.181.240（Ubuntu 24.04），部署结构如下：

| 位置 | 内容 |
|---|---|
| `/opt/node/` | Node.js 24 官方二进制包（自 npmmirror 下载并校验后解压，不改动系统软件包） |
| `/opt/yi/server.cjs` | 服务端（属主为 root，只读）；上一版本保留为 `server.cjs.prev` |
| `/opt/yi/download/` | 下载页面上的安装程序（属主为 root，服务端只读），发版时由 `npm run deploy` 更新 |
| `/var/lib/yi/` | 段位数据，属主为系统用户 `yi`（`useradd --system --no-create-home --shell /usr/sbin/nologin yi`） |
| `/etc/systemd/system/yi.service` | 常驻服务，开机自启，异常退出后 3 秒自动重启；因段位存档损坏退出（退出码 65、74）时不重启 |
| `/etc/ssh/sshd_config.d/00-yi-hardening.conf` | SSH 仅允许 Ed25519 密钥登录，禁止口令登录（SEC-040）；原配置备份为 `/etc/ssh/sshd_config.bak-20261002` |
| UFW | 主机防火墙，默认拒绝入站，仅放行 TCP 22、8443（SEC-041） |
| `/etc/fail2ban/jail.local` | SSH 10 分钟内失败 5 次封禁 1 小时（SEC-042）。Ubuntu 24.04 的 SSH 单元名为 `ssh.service`，须以 `journalmatch = _SYSTEMD_UNIT=ssh.service + _COMM=sshd` 指明，否则 fail2ban 读不到任何日志 |
| `/var/lib/yi/deploy.log` | 上线、回滚及配置修改的记录，每次操作追加一行（OPS-048） |
| `/opt/yi/backup.sh`、`/etc/systemd/system/yi-backup.{service,timer}` | 每日本地备份，每天北京时间 04:30 前后运行（DAT-060、DAT-061），源文件为仓库中的 `scripts/server/`，由 `npm run deploy -- install-backup` 安装 |
| `/var/lib/yi/backup/` | 段位存档的备份 `yi-ratings-UTC时间.json` 及其 `.sha256` 校验和，保留最近 7 份（DAT-064） |

`yi.service` 的内容如下，其中 `YI_LATEST` 由 `npm run deploy` 维护：

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
Environment=YI_LATEST=2.0.2
Environment=YI_FILES=/opt/yi/download
Environment=YI_DOWNLOAD=http://47.108.181.240:8443/
Restart=always
RestartSec=3
RestartPreventExitStatus=65 74
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/yi

[Install]
WantedBy=multi-user.target
```

### 5.4 更新与运维

- **更新**：服务端随发版一同更新，由 `npm run deploy -- 版本号` 部署对应 Release 中的 `yi-server-版本.cjs`；`npm run deploy -- rollback` 可回退至上一版本。详见 [开发与发布规程](docs/procedures/release.md) 第 6 章。
- **查看日志**：`ssh root@47.108.181.240 journalctl -u yi -f`。日志首行记录服务端的版本号及提交号。
- **修改服务配置**：修改 `yi.service` 后，执行 `systemctl daemon-reload && systemctl restart yi`。
- **防火墙**：阿里云安全组与主机防火墙 UFW 均仅放行 TCP 22、8443 端口，两者须保持一致（SEC-041）。
- **重启**：重启服务端将中断正在进行的对局，应在无人对局时进行。
- **备份**：备份在 `/var/lib/yi/backup/`。立即备份一次：`systemctl start yi-backup`；查看结果：`journalctl -u yi-backup -n 5`，失败记录为 error 级，可用 `journalctl -u yi-backup -p err` 筛出。异地备份见整改项 P1-13。
- **从备份恢复**：恢复会丢失备份时刻之后的段位变化，并须重启服务端，应在无人对局时进行：
  1. `systemctl stop yi`；
  2. 核对备份：`cd /var/lib/yi/backup && sha256sum -c yi-ratings-时间.json.sha256`；
  3. 先留存现有存档（DAT-066）：`cp -p /var/lib/yi/yi-ratings.json /var/lib/yi/yi-ratings.json.before-restore`；
  4. `install -o yi -g yi -m 600 /var/lib/yi/backup/yi-ratings-时间.json /var/lib/yi/yi-ratings.json`；
  5. `systemctl start yi`，以 `journalctl -u yi -n 1` 确认已启动，并在 `/var/lib/yi/deploy.log` 中追加一行记录。
- **旧版服务端**：1.x 版本的 C 语言服务端（端口 7700）已停用并清理，1.x 客户端不再支持联机。

### 5.5 域名与 TLS

域名 `yi.lightking.com.cn` 已解析至该服务器。ICP 备案通过前，阿里云拦截未备案域名在 80、443 端口上的访问，因此 `wss://` 将在备案通过后配置，步骤如下：

1. 使用 Caddy 作为反向代理，并自动申请证书：`yi.lightking.com.cn { reverse_proxy 127.0.0.1:8443 }`；
2. 在 `yi.service` 中增加 `Environment=HOST=127.0.0.1`，使服务端仅接受本机反向代理的连接；
3. 在安全组与 UFW 中关闭 8443 端口，改为放行 80、443 端口，其中 80 端口仅供 Caddy 申请证书及跳转至 HTTPS；
4. 将 `YI_DOWNLOAD` 改为 `https://yi.lightking.com.cn/`。

## 6 多语言

界面文字提供文言（默认）、中文及 English 三种语言：

- 代码中以中文书写原文，显示时经 [src/i18n/index.ts](src/i18n/index.ts) 中的 `T()`、`TF()` 转换为当前语言；
- 译文统一维护于 [src/i18n/table.ts](src/i18n/table.ts)，新增界面文字时应在其中补充译文，开发模式下缺少译文时控制台给出提示；
- 服务端发送的提示同样为中文原文，由客户端翻译；
- 各语言的写法见 [docs/standards/09-text-and-i18n.md](docs/standards/09-text-and-i18n.md)。

## 7 源码结构

```
src/
  main.tsx            入口：启动画面循环与界面
  core/               规则核心（不依赖画面，服务端共用）
    rules/index.ts      规则：纯函数，给定局面与一手棋，返回新局面或不合法的原因（错误码）；点目
    move.ts、config.ts  着法、错误码、对局结果；一局的规则设置
    record.ts           棋谱与回放
    game.ts             对局：历史、棋谱、点目标记、胜负，通过 listener 通知画面层
    renju.ts            五子棋禁手判定（三三、四四、长连）
    gomokuAI.ts         五子棋人机；goAI.ts 围棋人机（蒙特卡洛树搜索、估算死子）
  app/                app（主循环、布局、输入）、stage（每帧的场景更新与绘制顺序）、controller（对局操作与快捷键）、
                      state（界面与对局状态）、settings（设置，保存于本地存储）、native（桌面版的系统功能与错误日志）、scenarios（开发用场景脚本）
  session/            对局会话：session（三种模式下的落子方、悔棋步数）、seats（人、电脑、联机的一方）、
                      think 与 computer.worker（电脑在后台线程中计算着法、估算死子，可随时取消）
  presentation/       boardView（棋盘的动画状态：落子、提子、悔棋倒放、换棋盘、胜负动画、提示）
  render/             gl（WebGL2 批量绘制）、shaders（全部着色器）、painter（绘制原语）、board、layout（自动缩放的布局）、theme
  fx/                 终局特效：gomokuWin、blow（击散与倒放）、goEnd、rewind、ghost（落子预览）、gather
  scene/              bowls（棋罐）、light（五种光影）、online（联机对战页面棋盘上的布置）
  audio/              合成音效与程序生成的背景音乐（在 Worker 中合成）
  online/config.ts    在线服务器地址（构建时由 VITE_YI_SERVER 读取）
  online/client.ts    联机会话：匹配及排位队列、配对确认、好友房间、对局中的各类请求；确认后的每一步交由本地规则执行
  shared/protocol.ts  联机协议（客户端与服务端共用）、段位表及昵称清洗；parse.ts 入站消息的集中校验；reject.ts 不合法着法的提示文字
  ui/                 Preact 界面：panels（菜单、对局、设置、更多）、online（联机对战）、widgets、styles.css、info（“更多”页面的文字）
  i18n/               多语言
server/               rooms.ts 队列、配对、房间、对局与段位（与传输无关）；store.ts 段位存档；host.ts 接入 WebSocket（可同时监听多个端口）；
                      files.ts 同一端口上的下载页面；main.ts 入口
electron/             桌面版主进程（窗口、单实例、匹配成功时的任务栏提醒、错误日志）及预加载脚本
tests/                vitest：rules（规则与人机）、record（规则层与棋谱）、session（会话与座位）、protocol（消息校验与昵称清洗）、server（联机服务端）、
                      client（联机客户端：断线、重连、服务器重启）、layers（依赖方向）、text（说明文字的译文、标点与更新日志）
scripts/              build-node（打包主进程与服务端）、make-fonts（生成内置字体子集）、changelog（读取更新日志、生成发布说明）、
                      release（发版）、deploy.sh（上线）、shots.cjs 与 compare-shots.mjs（场景截图与逐像素对比）
docs/                 standards/（工程规范）、procedures/（操作规程）、plan/（改造与整改计划）、audits/（审计报告），索引见 docs/README.md
```

画面分为四层：`#scene`（WebGL：背景、棋盘、棋子、棋罐、光影）、`#ui`（Preact 界面）、`#over`（飞越界面的碎子）、`#glow`（叠加的光效）。

## 8 路线图

后续改造计划（数据库与对局记录、账号系统、排位反作弊等）见 [docs/plan/roadmap.md](docs/plan/roadmap.md)。

## 9 版权与许可

Copyright © 2026 LightKing. All rights reserved.

本项目使用 [Preact](https://preactjs.com)、[Electron](https://www.electronjs.org) 及 [ws](https://github.com/websockets/ws)（均为 MIT 许可证），并附带[思源黑体、思源宋体](https://github.com/notofonts/noto-cjk)的子集（SIL Open Font License 1.1）。
