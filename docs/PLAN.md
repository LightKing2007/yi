# 弈 · 架构改造计划

| 项目 | 内容 |
|---|---|
| 文档版本 | 第 2 版 |
| 修订日期 | 2026-10-02 |
| 状态 | 执行中：阶段 0、0.5、1、2、3′、R 已完成；下一阶段为阶段 5 |
| 相关文档 | [RELEASE.md](RELEASE.md)（开发与发布流程）、[STYLE.md](STYLE.md)（文字规范） |

本文档规定“弈”的架构改造目标、原则、阶段划分及各阶段的具体内容。

第 2 版在第 1 版的基础上，经完整通读全部源码（约 8100 行）后补入线上已存在的联机缺陷、桌面端稳定性问题及发布与运维方面的隐患，并据此调整了实施顺序：

- 先发布 2.0.1 稳定版，修复玩家可能遇到的问题；
- 强制更新合并为两次（2.0.1、3.0）；
- 缩小阶段 3 的范围；
- 提前实施安全项。

每一阶段均可单独交付、单独验收；任一阶段完成后，游戏均应照常可用。问题编号（A1、B9 等）见第 3 章，各阶段按编号引用。

---

## 0 现状、目标与原则

### 0.1 现状（2.0.0）

```
主线程（requestAnimationFrame 帧循环）                 后台线程
  输入 → controller ──┐                                 ai.worker    电脑思考（五子棋 α-β / 围棋 MCTS）
  online/client ──────┼─> game（全局唯一的 Game）         synth.worker 合成全部音效与两段音乐
  Stage.update/draw ──┘        ▲
  ├ #scene  WebGL：背景、棋盘、棋子、棋罐、光影
  ├ #ui     Preact 面板（靠 bump() / uiTick 手动触发重绘）
  ├ #over   WebGL：飞起的棋子、粒子
  └ #glow   WebGL：发光层

服务端（单进程、全在内存）：host.ts(ws) → RoomServer（队列、配对、房间、Elo）→ 每房间 new Game() → yi-ratings.json
```

优点：规则代码客户端与服务端共用、服务端逐手校验；画面与音频全部程序生成、效果精致；AI 与音频在后台线程。
主要问题：`Game` 同时装着规则与动画；三种对局模式靠 `if` 拼接；联机客户端状态机无测试，断线重连有多处 bug；玩家身份只是本地随机 uid；发布全靠手动。

### 0.2 目标

1. 规则层做成纯函数、确定性，客户端与服务端共用，便于测试、回放、存档。
2. 单机双人、人机、联机、观战统一成“一场对局 + 两个座位”。
3. 玩家数据（账号、段位、战绩、每一局棋谱）存在服务器数据库里，能查、能复盘、能回滚。
4. 排位赛需要登录；有一套可执行的反作弊规则和管理工具。
5. **联机稳定可靠**：断网、服务器重启、对局中途结束等情况都有明确结果，不会卡死。
6. **发布流程自动化**：三平台安装程序自动构建，玩家可收到新版本提示。

### 0.3 原则

- **逐步替换，不推倒重写**：每一阶段结束，测试全部通过，游戏行为不变（除非该阶段就是要改行为）。
- **强制更新只有两次**：2.0.1（换端口 + 稳定性，并带上“新版本提示”）与 3.0（账号 + 协议 v4 + 域名）。其余版本服务端向下兼容。
- **服务端继续是单文件、免 `npm install`**：数据库用 Node 内置的 `node:sqlite`。
- **本机不做全局安装**：开发工具都放在项目依赖里；服务器上的软件（Node、Caddy）只装在服务器上。
- 新增界面文字都在 `src/i18n/table.ts` 补齐文言、中文、English。
- 提交说明带 `Co-Authored-By: Claude` 署名。

---

## 1 决策记录

| # | 事项 | 状态 / 默认方案 | 备选 |
|---|---|---|---|
| D1 | 域名 | **已定**：`lightking.com.cn`（已购），游戏服务用 `yi.lightking.com.cn` | — |
| D2 | 登录方式 | 待定，默认：邮箱 + 密码，邮箱验证码 | 手机短信（要费用和资质）；微信 / QQ 登录（要申请开放平台） |
| D3 | 发邮件 | 待定，默认：阿里云邮件推送（DirectMail），**SMTP 走 465 端口** | QQ 邮箱 / 163 的 SMTP（有发信上限） |
| D4 | 游客能玩什么 | 待定，默认：匹配和好友房不用登录；排位必须登录并验证邮箱 | 全部必须登录 |
| D5 | 昵称是否唯一 | 待定，默认：会员昵称全服唯一；游客昵称不限，显示“游客”标记 | 都不唯一 |
| D6 | 服务器与端口 | **已定**：继续用阿里云大陆服务器；ICP 备案已提交（2026-10-01）。服务端端口统一为 **8443**；备案通过后对外走 443，由 Caddy 转到本机 8443 | 备案被驳回时换香港服务器 |
| D7 | 公开运营范围 | 自己与朋友圈小范围 | 面向大陆公众运营时，还要评估网络游戏实名认证与防沉迷要求 |
| D8 | 发行平台 | **已定：只做桌面版**（macOS / Windows / Linux） | — |
| D9 | 是否先出 2.0.1 稳定版 | 待定，**建议做**（修 A1–A8 等线上问题） | 直接进入阶段 1 |
| D10 | Windows / Linux 实机测试 | 待定：需要一台 Windows 电脑（或虚拟机）验证字体与渲染 | 只看 CI 出的包，风险自担 |
| D11 | 玩家规模 | 待定：影响 A6、A7 等安全项的紧迫程度 | — |
| D12 | 禁手下黑棋无处可下 | 待定，默认：**判和棋**（`reason: 'full'`） | 判黑负 |

---

## 2 路线图

### 2.1 版本与阶段

| 顺序 | 版本 | 阶段 | 内容 | 约（天） | 强制更新 |
|---|---|---|---|---|---|
| ✅ | — | 0 | 工程基础：git、CI、地址配置化、端口 8443 | 已完成 | — |
| ✅ | **2.0.1** | 0.5 | **稳定版**：联机 bug、WebGL 恢复、单实例、错误日志、版本号统一、新版本提示、双端口过渡（已发布） | 3 | **是（换端口）** |
| ✅ | 2.1 | 1 | 规则层纯化（含画面回归用的场景脚本） | 3.5 | 否 |
| ✅ | 2.1 | 2 | 对局会话 Match / Seat；电脑可取消思考 | 3 | 否 |
| ✅ | 2.1 | 3′ | 只解开循环依赖（其余推到 3.0 之后） | 0.5 | 否 |
| ✅ | 2.1 | R | 发布工程：CI 三平台出包、Releases、附带字体、服务器上的下载页 | 2 | 否 |
| 6 | 2.2 | 5 | 数据库与对局记录；安全项（限流、连接上限）；维护模式 | 3.5 | 否（仅服务端） |
| 7 | **3.0** | 4 + 6 + 7 | 域名与 TLS（等备案）、账号系统、协议 v4 | 7.5 | **是** |
| 8 | 3.0 | 8 | 反作弊与管理工具 | 4 | — |
| 9 | 3.x | 9 | 新功能（复盘、战绩、自动更新、对局中设置等） | 按需 | 否 |
| | | | **合计（至 3.0）** | **约 27** | |

### 2.2 时间线

```
现在 ─► 2.0.1 稳定版（3 天）─► 阶段 1、2、3′、R（约 9 天）─► 发布 2.1
          │
          └── 备案审核（1–3 周）同时进行
                              ▼
                  阶段 5 ─► 发布 2.2（仅服务端）
                              ▼
               备案通过 ─► 阶段 4 + 6 + 7 ─► 阶段 8 ─► 发布 3.0 ─► 阶段 9
```

**关键路径**：阶段 1（棋谱格式）→ 阶段 5（对局记录入库）→ 阶段 6、7（账号与协议）。阶段 3 的大部分内容不在关键路径上，所以推后。

---

## 3 问题清单

本章问题经通读源码后整理。**A 类为玩家当前即可能遇到的问题**，优先级最高。

### A. 联机

| # | 问题 | 位置 | 修复阶段 |
|---|---|---|---|
| A1 | **重连失败后卡在“幽灵对局”**：服务器重启过，或掉线超过 60 秒后，客户端带旧令牌重连，服务端认不出，按新玩家发 `welcome`；客户端只提示“已重新连上”，仍停在对局界面，之后落子被静默忽略 | [client.ts:262](../src/online/client.ts) `case 'welcome'` | 0.5 |
| A2 | **最常见的断网场景连不回来**：Wi-Fi 闪断时服务端还没发现旧连接已死，客户端重连时查找条件 `!o.conn` 不成立，找不到原来的玩家，落进 A1 | [rooms.ts:412](../server/rooms.ts) | 0.5 |
| A3 | **客户端察觉不到静默断线**：协议定义了 `IDLE_SECS`，客户端没用；只发心跳、不检查回应，网络默默断掉时会对着不动的棋盘等几分钟 | [client.ts](../src/online/client.ts) `update()` | 0.5 |
| A4 | **断线期间对局结束，重连后看不到结果**：`resync` 对已结束的房间不补发 `over`，客户端以为还在下，段位变化也看不到 | [rooms.ts:400](../server/rooms.ts) | 0.5 |
| A5 | **60 秒掉线宽限实际只有 30 秒**：一方掉线后对手照常落子，`startTurn` 给掉线的一方重新开始计时，五子棋 30 秒就判超时 | [rooms.ts:297](../server/rooms.ts) | 0.5 |
| A6 | **好友房号可以被遍历闯入**：房号 4 位（9000 种），加入不限次数 | [rooms.ts:474](../server/rooms.ts) | 0.5（按连接限次）、5（按 IP） |
| A7 | **单个 IP 就能占满服务器**：总上限 2048 条连接，不限单 IP | [rooms.ts:27](../server/rooms.ts)、[host.ts](../server/host.ts) | 0.5 |
| A8 | **同一设备开两个窗口同时排位，段位互相覆盖**：两个会话各自读了一份段位，后写的覆盖先写的 | [rooms.ts:435](../server/rooms.ts) | 0.5（临时）、6（单账号单会话） |

测试缺口：服务端重连用例都是“先正常断开再重连”，没覆盖半开连接和服务端重启；470 行的联机客户端状态机**没有任何测试**。

### B. 桌面端稳定性与体验

| # | 问题 | 修复阶段 |
|---|---|---|
| B9 | **WebGL 上下文丢失后永久黑屏**：三张画布都没处理 `webglcontextlost`，Windows 睡眠唤醒、驱动更新时可能触发 | 0.5 |
| B10 | **没有单实例锁**：双击两次开两个进程，共用本地存储，设置与身份可能互相覆盖 | 0.5 |
| B11 | **出错时没有任何日志**：没有全局错误捕获，朋友那边出问题时拿不到线索 | 0.5 |
| B12 | **对局中不能打开设置**：想调音量得回菜单，回菜单会清空棋局 | 9 |
| B13 | **跨平台字体**：标题等用 `Songti SC` 加粗 900，Windows 上退回宋体并由系统强行加粗，精简版 Linux 可能没有中文字体（显示成方块）；从未在 Windows / Linux 实测 | R |
| B14 | **电脑思考不能取消**：围棋困难想 3 秒，期间点“新局”，新一局要排队等；五子棋困难没有时间上限（CI 上一步 2.2 秒）；围棋点目估死子在主线程上跑，19 路棋盘上会出现短暂卡顿（[controller.ts:129](../src/app/controller.ts)） | 2 |
| B15 | **禁手下黑棋可能无处可下**：五子棋不能停着，单机会卡住，电脑一方每帧重复发起思考请求 | 1（规则，见 D12）、2（会话） |
| B16 | **静止时也全速渲染**：画面不变时仍每秒 60 帧，笔记本耗电 | 9 |

### C. 工程与发布

| # | 问题 | 修复阶段 |
|---|---|---|
| C17 | 版本号散落三处：`package.json`、[state.ts:8](../src/app/state.ts)、README | 0.5 |
| C18 | 每次改地址或协议都要朋友手动重装，而自动更新排在最后 → 2.0.1 先加“新版本提示” | 0.5、9 |
| C19 | 切到 8443 会让 2.0.0 老客户端立即失联 → 服务端过渡期同时监听 7700 与 8443 | 0.5 |
| C20 | Windows 安装包只能在 Windows 上打 → CI 三平台出包（私有仓库 macOS 机器按 10 倍计分钟数） | R |
| C21 | 过时内容：更新日志写着“也可以直接在浏览器里玩”；译文表里 74 条 1.x 局域网时代的废弃条目；“联机”页写“段位跟着这台设备” | 0.5（前两项）、6（第三项） |
| C22 | 画面效果没有任何回归手段，重构时特效坏了发现不了 | 1（场景脚本） |

### D. 对原计划的修正（已并入各阶段）

- 阿里云默认封禁 25 端口，SMTP 必须走 465（SSL）；邮件推送要求在域名上配 SPF、DKIM（阶段 6）。
- **游戏内置的困难 AI 本身就是最容易拿到的外挂**（开两个窗口即可），所以“与内置 AI 首选点的重合率”对五子棋有实际意义（阶段 8）。
- 服务端重启会中断所有对局 → 维护模式：先停止开新局，等现有对局下完再重启（阶段 5）。
- 阶段 1 细节：连珠五子的位置、围棋死子与地属于规则结果，留在规则层；只有动画时间、纹理种子、粒子才移到 `BoardView`。禁手缓存拆成“规则计算 + 画面缓存”。
- 注册时要有勾选同意《隐私说明》的步骤，不能只放一个说明页（阶段 6）。

---

## 4 阶段 0：工程基础（已完成）

| 改动 | 结果 |
|---|---|
| git 仓库 | 基线提交并打 tag `v2.0.0`；推到 GitHub 私有仓库 `LightKing2007/yi` |
| 只提交源码 | 忽略 `node_modules/`、`release/`、`trailer/`、`dist*/`、`.claude/`、数据库与段位存档 |
| CI | GitHub Actions：类型检查、测试、两个构建（actions v5）；困难 AI 用时上限在 CI 上放宽到 4 秒 |
| 服务器地址 | 从 `shared/protocol.ts` 移到 [src/online/config.ts](../src/online/config.ts)，打包时读 `.env.production` 的 `VITE_YI_SERVER` |
| 服务端 | 新增 `HOST` 环境变量（放在反向代理后面时设为 `127.0.0.1`） |
| 端口 | 统一为 **8443**（服务端默认、客户端默认、`.env.production`、README） |
| Node | `.nvmrc`（24）、`engines >=22.13`；服务端构建目标暂留 node20，阶段 5 再升 |
| 其他 | 新图标与开始菜单的行楷标题 |

---

## 5 阶段 0.5：2.0.1 稳定版（已完成，约 3 天）

目标：修掉玩家现在就会遇到的问题，并为之后的更新铺路。**协议仍是 v3**，只做向下兼容的增量。

### 5.1 联机修复

| # | 做法 |
|---|---|
| A1 | 服务端：`hello` 带了令牌但找不到对应玩家时，除 `welcome` 外再发 `{ t: 'resumeFailed' }`（新消息，老客户端会忽略）。客户端：收到后结束“重连中”，退出对局回到多人游戏页，提示“对局已结束或服务器已重启，无法恢复”。另外，客户端在 `welcome` 之后若 3 秒内没收到 `start`，也按重连失败处理（兼容没升级的服务端） |
| A2 | 服务端：令牌匹配的玩家即使 `conn` 还在（旧连接未被发现已断），也关闭旧连接、由新连接接管 |
| A3 | 客户端：记录最后一次收到任何消息的时刻；超过 25 秒（心跳 10 秒的两倍多）没收到，就主动关闭连接并进入重连 |
| A4 | 服务端 `resync`：房间已结束时补发 `over`，排位局再补发该玩家的 `rated`（需要在房间里记下结算结果） |
| A5 | 服务端：轮到的一方不在线时不开始计时（`deadline = 0`，记为暂停），其回来后才开始计时；掉线宽限只由 `GRACE_SECS` 决定 |
| A6 | 服务端：每条连接 1 分钟内加入失败超过 5 次，之后 1 分钟内的加入一律拒绝 |
| A7 | 服务端：每个 IP 同时最多 8 条连接（直连时取 `socket.remoteAddress`；阶段 4 之后取可信的 `X-Forwarded-For`） |
| A8 | 服务端：同一设备（同一 `key`）已有会话在排位队列或排位对局中时，另一个会话不能进入排位（提示“这台设备已在排位中”） |

### 5.2 桌面端

| # | 做法 |
|---|---|
| B9 | 三张画布监听 `webglcontextlost`（`preventDefault`）与 `webglcontextrestored`；恢复时重建 `Gfx`、`Painter`、各着色器程序与离屏贴图（棋盘木纹、棋罐、光影会自动重新烘焙）。对局状态不受影响 |
| B10 | `electron/main.ts` 调用 `app.requestSingleInstanceLock()`；第二次启动时把已有窗口调到前台并退出新进程 |
| B11 | 渲染进程捕获 `error` 与 `unhandledrejection`，经 preload 新增的 `yiNative.log()` 交给主进程，写到 `userData/logs/yi.log`（超过 1 MB 轮转一次）；“更多 · 关于”加一个“打开日志文件夹”按钮 |

### 5.3 版本与更新提示

| # | 做法 |
|---|---|
| C17 | 版本号只保留 `package.json` 一处：Vite 用 `define` 注入 `__APP_VERSION__`，替换 [state.ts](../src/app/state.ts) 里的常量；README 的安装包文件名改为 `Yi-<版本>-…` 的写法 |
| C18 | 服务端读环境变量 `YI_LATEST`（最新版本号）、`YI_DOWNLOAD`（下载地址），在 `welcome` 里附带 `{ latest, url }`（新增的可选字段）。客户端版本较旧时，在开始菜单和多人游戏页显示“有新版本 x.y.z”，点击用系统浏览器打开下载地址 |
| C19 | 服务端支持同时监听多个端口：`PORT=8443`，`EXTRA_PORTS=7700`（逗号分隔）。过渡期两个端口都开，2.0.0 老客户端照常能玩，老客户端基本换完后再关 7700 |

### 5.4 清理

- C21：更新日志改为“提供 macOS、Windows、Linux 的安装包”；删除译文表里 74 条已不使用的条目（先用脚本列出，逐条确认没有被拼接使用，例如“禁手：黑棋不能下三三”这类由代码拼出来的要保留）。
- 更新日志新增 2.0.1 一节。

### 5.5 测试

- 新增 `tests/client.test.ts`：用一个假的 `WebSocket` 类，把 [client.ts](../src/online/client.ts) 直接接到进程内的 `RoomServer` 上（假时钟），覆盖：正常对局、半开连接后重连（A2）、服务端重启后重连（A1）、静默断线检测（A3）、断线期间对局结束（A4）、掉线方计时（A5）。
- `tests/server.test.ts` 补充 A5–A8 的用例。

### 5.6 发布步骤

1. 先升级服务端：同时监听 7700 与 8443，设置 `YI_LATEST=2.0.1`、`YI_DOWNLOAD=<GitHub Releases 或网盘链接>`；安全组放行 8443。
2. 打包 2.0.1 三平台安装包，发给朋友。
3. 观察一段时间，老客户端基本没有了再关闭 7700。

**验收**：新测试全部通过；手动演练：断开 Wi-Fi 十几秒再连上能回到原对局；重启服务端后客户端给出明确提示；让 GPU 上下文丢失（开发工具里用 `WEBGL_lose_context` 扩展模拟）后画面自动恢复；第二次双击应用只会激活已有窗口。

---

## 6 阶段 1：规则层纯化（已完成，约 3.5 天，最重要）

> 完成情况：规则层 `src/core/rules/index.ts`（五子棋与围棋放在一个文件里，约 200 行）、`move.ts`、`config.ts`、`record.ts`；
> 不合法原因改为错误码，文字在 `src/shared/reject.ts`；动画状态全部移到 `src/presentation/boardView.ts`（`Game` 通过 `GameListener` 通知它），
> 服务端的 `Game` 不再带任何动画状态、不再读提示文字。场景脚本 `npm run shots` 在不显示的 Electron 窗口里跑，重构前后 105 张截图逐像素一致。
> 与原计划的出入：棋子纹理种子仍用随机数（放在画面层，保证截图基准不变）；`snap.ts` 的删除、AI 入参改为 `Pos + GameConfig` 放到阶段 2；
> `zobrist.ts` 放到阶段 7，`sgf.ts` 放到阶段 9；禁手点的整盘缓存暂时留在 `Game.forbiddenAt`（只是查询辅助，服务端不调用）。

### 6.1 问题

`src/core/game.ts` 的 `Game` 同时装着规则状态和画面状态，规则里调用 `now()`、`Math.random()`。服务端也 `new Game()`，并从 `g.msg.key`（中文文案）里读非法落子的原因。

### 6.2 先做：画面回归用的场景脚本（C22，0.5 天）

开发模式下支持 `?scenario=<名字>`：直接摆出预设局面并触发特效，用于重构前后逐个对比画面。
至少包括：`gomoku-win`（连五、炸飞、查看棋局）、`gomoku-forfeit`、`go-score`（点目、揭晓动画）、`go-capture`、`undo-rewind`、`board-switch`、`online-found`（多人游戏页的配对画面）。
重构前先把每个场景截图留底。只用应用内置的浏览器或 Electron 手动查看，不引入需要全局安装浏览器的测试框架。

### 6.3 新的 core 结构

```
src/core/
  types.ts        保留：Pos、Board、常量、Rng（去掉 clamp01 / smooth01 / easeOut / lerp，挪到 src/render/math.ts）
  config.ts       新：GameConfig
  move.ts         新：Move、Reject、Result
  rules/
    index.ts      新：Rules 接口与 rulesFor(cfg)
    gomoku.ts     新：由 game.ts 的五子棋部分与 gomokuCheckWin 迁来，调用 renju.ts
    go.ts         新：由 game.ts 的围棋部分、group、computeScore 迁来
  record.ts       新：GameRecord、replay()、undo 计算
  zobrist.ts      新：局面散列（联机校验、超级劫、AI 置换表共用）
  sgf.ts          新：SGF 导入导出（阶段 9 使用，可以先留空）
  renju.ts        保留
  gomokuAI.ts     保留，入参改为 Pos + GameConfig
  goAI.ts         保留，同上
  snap.ts         删除（快照直接取 Pos）
  clock.ts        保留（只给 app / server 用，core 不再引用）
  game.ts         过渡期保留为外观类，阶段 2 结束后删除
```

### 6.4 类型

```ts
// config.ts
export interface GameConfig {
  type: GameType;          // Gomoku | Go
  size: 9 | 13 | 15 | 19;
  renju: boolean;          // 五子棋黑棋禁手
  komi: number;            // 围棋贴目，默认 7.5
  koRule: 'simple' | 'superko';   // 默认 simple，与现在一致
}

// move.ts
export type Move =
  | { k: 'play'; x: number; y: number }
  | { k: 'pass' };
export type Reject =
  | 'over' | 'scoring' | 'off-board' | 'occupied'
  | 'suicide' | 'ko' | 'superko'
  | 'renju-overline' | 'renju-44' | 'renju-33'
  | 'pass-not-allowed';                 // 五子棋不能停着
export type EndReason = 'five' | 'full' | 'score' | 'resign' | 'timeout' | 'disconnect' | 'draw' | 'left';
export interface Result { winner: 0 | 1 | 2 | 3; reason: EndReason; scoreB?: number; scoreW?: number }

// rules/index.ts
export interface Applied {
  pos: Pos;
  captured: { x: number; y: number }[];
  line?: { x: number; y: number }[];   // 五子连珠的那几颗（规则结果，画面层据此放胜利动画）
  result?: Result;                      // 这一手结束了对局（连五、满盘、黑棋无处可下）
  scoring?: boolean;                    // 双方连续停着，进入点目
}
export interface Rules {
  init(cfg: GameConfig): Pos;
  apply(pos: Pos, m: Move, history: ReadonlyArray<Pos>): { ok: true; v: Applied } | { ok: false; why: Reject };
  forbidden?(pos: Pos, x: number, y: number): Reject | null;   // 五子棋禁手预判（悬停提示用）
  hasLegalMove?(pos: Pos): boolean;                            // B15：五子棋判断轮到的一方是否还有可下之处
  score?(pos: Pos, dead: Uint8Array, komi: number): { b: number; w: number; terr: Uint8Array };
  autoDead?(pos: Pos, komi: number, rng: Rng): { x: number; y: number }[];
}

// record.ts
export interface MoveRec { m: Move; ms?: number }       // ms：这一手用了多少毫秒（联机时由服务端写入）
export interface GameRecord {
  cfg: GameConfig;
  moves: MoveRec[];
  dead?: { x: number; y: number }[];                   // 点目确认时的死子
  result?: Result;
}
/** 从头回放，返回每一手之后的局面（history[0] 为空盘） */
export function replay(rec: GameRecord): { history: Pos[]; last: Applied | null };
```

要点：

- `Pos` 继续用 `Uint8Array` 一维数组，性能不变。`apply` 返回新的 `Pos`，不修改传入的局面。
- 规则层**不含**任何时间、随机数、文字。错误原因改为 `Reject` 码，`src/i18n` 新增 `rejectText(why)` 映射到现有中文原文（如 `'ko' → '劫争：此处暂不可提，请先在别处落子'`），界面照旧显示。
- 悔棋就是 `moves.pop()`，局面由缓存的 `history` 取。去掉 `HISTMAX = 1024` 的上限（现在超过 1024 手后悔棋和劫的判断都会出错）。
- “人机时悔两手”的逻辑从规则层挪到会话层（阶段 2）。
- **规则结果留在规则层**：连珠五子（`line`）、围棋死子（`dead`）、地（`terr`）与得分，服务端也要用。
- **禁手**：`forbidden()` 是纯计算；“按局面缓存整盘禁手点”（现在的 `forbidCache`，每次查询都对整盘算一遍散列）改由画面层按局面散列缓存。
- 棋子纹理种子 `seed` 由画面层用 `hash(x, y, 手数)` 算出，悔棋、重放后保持一致。
- B15：五子棋落子后若轮到的一方已无任何合法落点，按 D12 结束对局（默认和棋）。

### 6.5 过渡：`Game` 变成外观类

阶段 1 先不动调用方。`Game` 内部改为持有 `GameRecord + Rules + history`，对外保留原有字段和方法（`play`、`pass`、`undo`、`toggleDead`、`confirmScore` 等），把画面字段转给新的 `BoardView`（见 6.6）。这样 `app/`、`fx/`、`online/`、`server/` 在这一步都不用改，测试也不用改。

### 6.6 画面状态搬到 `BoardView`

新建 `src/presentation/boardView.ts`，把以下字段从 `Game` 移过去：

| 字段 | 用途 | 现在谁在读 |
|---|---|---|
| `placeT`、`appearT`、`seed` | 落子下落、淡入、棋子纹理 | render/board、fx/rewind、fx/blow、fx/gather |
| `fades` | 提子淡出 | render/board |
| `rw` | 悔棋时的倒放 | fx/rewind |
| `switch`、`SWITCH_T` | 切换棋盘的过渡 | fx/rewind、render/board |
| `winT`、`winBurst`、`forfeit` | 胜利动画的时刻与进度（连珠位置本身来自规则的 `line`） | fx/fx、fx/gomokuWin、fx/blow |
| `review`、`blowView`、`undoPending` | 炸飞、查看棋局 | fx/blow、app/stage |
| `goEndT`、`goBurst` | 围棋终局揭晓 | fx/goEnd |
| `animK` | 动画速度倍率 | 多处 |
| `msg`、`msgAt` | 屏幕上方的提示 | ui/panels、ui/online |
| 禁手点缓存 | 悬停与红叉 | render/board、app/app |
| `aiAt` | 电脑落子前的停顿 | app/controller（阶段 2 移到 AISeat） |

`BoardView` 提供 `onApplied(applied, t)`、`onUndo(prev, cur, t)`、`onReset(cfg, t)`、`onEnd(result, t)`，以及 `silent` 开关（重连、复盘时整局重建不播动画，替代现在的 `eventMark / eventRewind`）。服务端不创建 `BoardView`。

### 6.7 服务端同步修改

`server/rooms.ts` 的 `move` 分支不再读 `g.msg`，改为拿 `apply()` 返回的 `Reject` 码；发给客户端的 `info` 文字由 `rejectText()` 生成（v3 协议仍发中文原文，保证老客户端兼容）。

### 6.8 测试

- `tests/rules.test.ts`：现有用例全部保留（通过外观类跑）。新增：每种 `Reject`；`apply` 不修改传入的局面；同一份 `GameRecord` 回放两次结果逐字节相同；超过 1024 手的长局悔棋正确；黑棋无处可下（B15）。
- 新增 `tests/record.test.ts`：回放、悔棋、点目死子。

**验收**：`npm test` 全部通过；`grep -rn "now()\|Math.random" src/core/rules src/core/record.ts` 为空；服务端不再引用 `g.msg`；6.2 的每个场景与重构前截图一致。

---

## 7 阶段 2：对局会话 Match 与座位 Seat（已完成，约 3 天）

> 完成情况：新增 `src/session/`：`session.ts`（三种模式 local / computer / online，决定谁来落子、悔棋退几手、电脑是否在想）、
> `seats.ts`（HumanSeat、ComputerSeat、RemoteSeat）、`think.ts` 与 `computer.worker.ts`（后台线程，取消时直接结束线程）。
> `Game` 去掉 vsAI、aiColor、aiToMove，`undo(steps)` 由会话决定步数；新增 `ver` 计数，电脑用它认局面（修复了悔棋后旧结果被用在新局面上的问题）。
> 困难五子棋逐层加深、限时 1.2 秒；点目估死子移到后台线程。控制器里的 `online.inGame()` 分支全部改为问会话。
> 与原计划的出入：没有把 `Game` 改名为 `Match` 再挪进 session（`Game` 已经是纯对局状态，改名只带来大量无意义的改动），
> 会话持有 `game` 与两个座位；服务端仍用 `Act[]` 同步（协议 v3 需要），等协议 v4 再换成棋谱；`snap.ts` 保留给电脑与场景脚本用。
> 测试 76 → 84（`tests/session.test.ts`）；场景截图 105 张逐像素一致；真实后台线程下的人机对弈与悔棋取消用 `film-ai` 场景验证。

### 7.1 新结构

```
src/session/
  match.ts        Match：GameRecord + Rules + 当前局面 + 点目状态 + 事件
  seats.ts        Seat 接口与 LocalSeat
  aiSeat.ts       AISeat：由 app/controller 的“电脑”部分迁来，管理 ai.worker
  remoteSeat.ts   RemoteSeat：联机时对方（以及“自己”）的落子都等服务端确认
  policy.ts       悔棋步数等随对局类型变化的规则
```

```ts
export type MatchEvent =
  | { t: 'applied'; move: Move; v: Applied; by: Color }
  | { t: 'rejected'; why: Reject; by: Color }
  | { t: 'undone'; n: number; prev: Pos; cur: Pos }
  | { t: 'scoring' } | { t: 'dead'; x: number; y: number; dead: boolean }
  | { t: 'resumed' }
  | { t: 'ended'; result: Result }
  | { t: 'reset'; cfg: GameConfig };

export class Match {
  readonly cfg: GameConfig;
  record: GameRecord;
  pos: Pos;                    // 当前局面
  history: Pos[];
  scoring: boolean; dead: Uint8Array; score: { b: number; w: number } | null;
  result: Result | null;
  seats: [Seat, Seat];         // [黑, 白]
  on(fn: (e: MatchEvent) => void): () => void;
  submit(by: Color, m: Move): boolean;      // 本地提交（单机、人机）
  apply(m: Move): void;                     // 服务端已确认，照做（联机）
  undo(n: number): void;
  toggleDead(x: number, y: number): void;
  confirmScore(): void;
  resume(): void;
  end(result: Result): void;               // 认输、超时、掉线等非落子结束
  static fromRecord(rec: GameRecord): Match;
}

export interface Seat {
  readonly kind: 'local' | 'ai' | 'remote';
  attach(match: Match, color: Color): void;
  onTurn(): void;              // 轮到这个座位
  wantsInput(): boolean;       // 棋盘点击是否交给这个座位
  dispose(): void;             // AISeat：取消正在进行的思考
}
```

| 模式 | 黑 | 白 |
|---|---|---|
| 单机双人 | LocalSeat | LocalSeat |
| 人机 | LocalSeat / AISeat | AISeat / LocalSeat |
| 联机 | RemoteSeat（自己，点击后发给服务端） | RemoteSeat（对方） |
| 以后：观战 | RemoteSeat（只读） | RemoteSeat（只读） |
| 以后：AI 演示 | AISeat | AISeat |

悔棋步数由 `policy.ts` 决定：人机时退到玩家的回合；单机退一手；联机由服务端下发 `n`。

### 7.2 电脑思考（B14、B15）

- **可取消**：Worker 收到新请求或 `cancel` 时，中止当前思考（围棋 MCTS 已有 `cancelled` 回调，每批迭代检查一次；五子棋搜索在每个根候选点之间检查）。`AISeat.dispose()` 与新局都会取消。
- **五子棋困难加时间上限**：按时间做逐层加深（先 2 层、再 4 层、再 6 层），超过 1.5 秒就用已完成的最深一层结果，慢电脑上也不会一步想好几秒。
- **点目估死子挪到 Worker**：`autoDead` 在 Worker 里跑，结果回来再标记，主线程不卡。
- 电脑一方无处可下时不再反复请求（规则层已结束对局，见 6.4）。

### 7.3 调用方修改

| 文件 | 改动 |
|---|---|
| `src/app/controller.ts` | `boardClick`、`boardHover` 只问“当前该谁落子、他 `wantsInput()` 吗”，然后调用 `seat.click(x, y)`；删掉所有 `online.inGame()` 分支。“电脑”那一段整体搬到 `aiSeat.ts`。快捷键按“当前模式允许哪些操作”生成，不再写两套 |
| `src/app/state.ts` | `game` 单例换成 `session`：`{ match: Match; view: BoardView }`，新局时整体替换 |
| `src/online/client.ts` | `onStart` 创建 `Match` 和两个 `RemoteSeat`；`moved`、`undone`、`marked` 等调用 `match.apply()` 等方法；重连同步改为 `Match.fromRecord()` + `BoardView.silent` |
| `src/ui/online.tsx` | 多人游戏页预览用的棋盘改为独立的展示用 `Match`，不再改动单机对局 |
| `server/rooms.ts` | `Room.g: Game` 换成 `Room.match: Match`（服务端的 Match 不挂 Seat），`acts: Act[]` 换成 `record: GameRecord`。v3 协议的 `sync` 仍需要 `Act[]`，由 `record` 转换生成 |
| `src/core/game.ts` | 删除 |

### 7.4 测试

新增 `tests/match.test.ts`：三种座位组合下的落子、悔棋、点目、终局事件顺序；AISeat 用同步的假 Worker；取消思考后不会落下过时的一手。

**验收**：三种模式手动走查（落子、提子、禁手、悔棋、炸飞后悔棋、点目、认输、断线重连）；6.2 的场景截图一致；测试全部通过；`src/core/game.ts` 已删除。

---

## 8 阶段 3′：解开循环依赖（已完成，约 0.5 天）

> 完成情况：实际只有两处互相引用。`fx/blow` 与 `fx/gomokuWin`：`winIndex` 挪到 `fx/fx.ts`；
> `online/client` 与 `app/controller`：联机模块重绘界面直接改 `uiTick`，切换界面由控制器加载时注册（`bindNavigation`）。
> 主循环不再直接调用联机模块，改为 `onFrame()` 注册，由入口 `main.tsx` 把 `online.update` 挂上。
> 新增 `tests/layers.test.ts`：没有环、各层只朝允许的方向依赖、规则层与服务端不碰客户端代码（故意加一条反向引用验证过会失败）。

只做对后续阶段有直接帮助的部分：

| 改动 | 说明 |
|---|---|
| 解开循环依赖 | `online/client.ts` 不再 import `app/controller`（现在用了 `bump`、`goScreen`），改为调用一个小的 `router.go()` 并更新 `netTick`；`app/app.ts` 不再 import `online`，改为 `main.tsx` 把 `online.update` 注册到帧循环 |
| 依赖方向检查 | 一条测试：`core` 不得 import 其他层；`session` 只能 import `core`；`fx/render` 不得 import `online` |

**推迟到 3.0 之后（并入阶段 9）**：用 signals 自动重绘替换 `uiKey` / `bump()`；完整的界面路由状态机；fx / render 全部改为参数传入 `BoardView`（阶段 2 后它们读的已是 `session.view`，功能上已经解耦）。

---

## 9 阶段 R：发布工程（已完成，约 2 天）

| # | 做法 |
|---|---|
| C20 | 新增 `.github/workflows/release.yml`：推送 `v*` 标签时，在 macOS、Windows、Ubuntu 三种机器上分别 `npm ci && npm run dist:*`，把安装包上传到该版本的 GitHub Release。注意私有仓库 macOS 机器按 10 倍计分钟数（每月免费 2000 分钟），只在打标签时运行 |
| B13 | 字体：在 Windows 与 Linux 上检查所有界面。标题、段位、房号等处，如果系统宋体效果不好，改为**随程序附带一个只含所需汉字的衬线字体子集**（思源宋体 / Noto Serif SC，SIL OFL 许可，可随程序分发），体积控制在几百 KB；正文字体保持系统字体 |
| — | Windows 实测（D10）：安装、首次运行的 SmartScreen 提示、字体、WebGL 画面、音频、联机、窗口尺寸记忆、高分屏缩放 |
| — | Linux：AppImage 在 Ubuntu 上运行一次；窗口图标（`BrowserWindow` 的 `icon` 选项，Linux 需要） |
| — | macOS：继续 ad-hoc 签名；在分发说明里写清楚首次打开的方法（右键“打开”，或“系统设置 · 隐私与安全性 · 仍要打开”） |
| — | README：发版流程（改 `package.json` 版本 → 打标签 → 推送 → 自动出包 → 更新服务端 `YI_LATEST`） |

**验收**：推一个测试标签，Release 页面自动出现三个平台的安装包；Windows 实测清单全部通过。

**结果**：v2.0.1 标签自动打出四个安装包（macOS 两个芯片各一个）。思源黑体、宋体子集随程序附带，在 Windows、Linux 上截图检查过界面与安装程序。
私有仓库的 Release 附件不对外公开，因此服务端在 8443 端口上同时提供下载页面（`YI_FILES`），发版后以 `npm run deploy` 上线，客户端的新版本提示直接打开该页面。
之后把开发与发版流程规范化，写在 [RELEASE.md](RELEASE.md)。

---

## 10 阶段 5：数据库、对局记录与服务端加固（约 3.5 天）

### 10.1 选型

- `node:sqlite`（Node 22.13+ 无需参数；服务器上推荐 Node 24 LTS，先确认系统 glibc ≥ 2.28）。同步 API（`DatabaseSync`），适合单进程服务端。
- 打开时设置 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;`。
- 文件位置：环境变量 `YI_DB`，默认 `./yi.db`。
- 服务端仍打包成单文件 `server.cjs`，`scripts/build-node.mjs` 的服务端构建目标升到 `node22`。

### 10.2 表结构（完整 DDL，放在 `server/db/schema.sql`，以迁移脚本方式执行）

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);         -- schema_version 等

-- 用户：游客和会员都在这里，kind 区分
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('guest','member')),
  name          TEXT NOT NULL,
  name_lower    TEXT,                                   -- 会员昵称唯一（D5）
  email         TEXT,                                   -- 小写保存
  email_ok      INTEGER NOT NULL DEFAULT 0,
  pass_hash     TEXT,                                   -- scrypt$N$r$p$salt$hash
  status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','muted','ranked_ban','banned')),
  status_until  INTEGER,                                -- 处罚到期（unix 秒），NULL 为永久
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  consent_at    INTEGER,                                -- 同意隐私说明的时刻（注册时勾选）
  merged_into   INTEGER REFERENCES users(id)            -- 游客并入会员后指向会员
);
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_name  ON users(name_lower) WHERE name_lower IS NOT NULL;

-- 设备：客户端本地生成的 uid 的散列（沿用现在的 sha256('yi:'+uid) 前 32 位），用于发现小号
CREATE TABLE devices (
  uid_hash   TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  last_ip    TEXT,
  PRIMARY KEY (uid_hash, user_id)
);
CREATE INDEX devices_user ON devices(user_id);

-- 登录会话：只存令牌的 sha256
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  uid_hash   TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_ip    TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- 邮箱验证码
CREATE TABLE email_codes (
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register','reset','change')),
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_codes_email ON email_codes(email, purpose);

-- 段位（每人每种棋一行）
CREATE TABLE ratings (
  user_id   INTEGER NOT NULL REFERENCES users(id),
  game_type INTEGER NOT NULL,                         -- 0 五子棋 1 围棋
  points    INTEGER NOT NULL DEFAULT 1200,
  win INTEGER NOT NULL DEFAULT 0, loss INTEGER NOT NULL DEFAULT 0, draw INTEGER NOT NULL DEFAULT 0,
  games     INTEGER NOT NULL DEFAULT 0,               -- 排位局数（定级期判断）
  abandons  INTEGER NOT NULL DEFAULT 0,               -- 逃跑次数
  PRIMARY KEY (user_id, game_type)
);

-- 每一局
CREATE TABLE games (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('match','ranked','friend')),
  game_type   INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  black_id    INTEGER REFERENCES users(id),
  white_id    INTEGER REFERENCES users(id),
  record      TEXT NOT NULL,                          -- GameRecord 的 JSON（含每手用时）
  moves       INTEGER NOT NULL,
  winner      INTEGER,                                -- 1 黑 2 白 3 和
  reason      TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  black_ip    TEXT, white_ip TEXT,                    -- 180 天后清空（见 17.2）
  black_dev   TEXT, white_dev TEXT,                   -- uid_hash
  flags       TEXT                                    -- 反作弊自动标记，逗号分隔
);
CREATE INDEX games_black ON games(black_id, ended_at);
CREATE INDEX games_white ON games(white_id, ended_at);
CREATE INDEX games_ended ON games(ended_at);

-- 段位变化明细：可以精确回滚
CREATE TABLE rating_changes (
  id        INTEGER PRIMARY KEY,
  game_id   INTEGER REFERENCES games(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  game_type INTEGER NOT NULL,
  before    INTEGER NOT NULL,
  after     INTEGER NOT NULL,
  cause     TEXT NOT NULL DEFAULT 'game' CHECK (cause IN ('game','rollback','admin','import')),
  at        INTEGER NOT NULL
);
CREATE INDEX rating_changes_user ON rating_changes(user_id, at);
CREATE INDEX rating_changes_game ON rating_changes(game_id);

-- 举报
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_id   INTEGER NOT NULL REFERENCES users(id),
  game_id     INTEGER REFERENCES games(id),
  reason      TEXT NOT NULL CHECK (reason IN ('engine','farming','abuse','name','other')),
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','valid','invalid')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER, resolved_by TEXT
);
CREATE INDEX reports_target ON reports(target_id, created_at);
CREATE UNIQUE INDEX reports_once ON reports(reporter_id, game_id);   -- 同一局只能举报一次

-- 处罚记录
CREATE TABLE sanctions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('mute','ranked_ban','ban','unban','rollback','rename')),
  reason     TEXT NOT NULL,
  until      INTEGER,
  by_admin   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 管理操作日志
CREATE TABLE audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, who TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
```

### 10.3 服务端代码结构

`rooms.ts` 现在 581 行，拆成：

```
server/
  main.ts               入口：读环境变量、打开数据库、启动 http + ws、优雅退出
  config.ts             新：所有环境变量集中解析（PORT、EXTRA_PORTS、HOST、YI_DB、YI_LATEST、YI_DOWNLOAD、SMTP_*、ADMIN_TOKEN、TRUST_PROXY 等）
  http.ts               新：node:http 服务器，/api/* 路由（阶段 6），/ws 升级给 ws
  host.ts               改：从“自己开端口”改为挂到 http 服务器的 upgrade 上
  hub.ts                新：连接与玩家（Player、hello、重连、心跳、tick 的连接部分）
  matchmaking.ts        新：队列、配对、确认（enqueue / unqueue / dropMatch / confirm）
  room.ts               新：一个房间的对局流程（申请、点目、计时、终局），持有 Match
  rating.ts             新：Elo 计算、定级期、K 值（纯函数，便于测试）
  anticheat.ts          新：配对限制、逃跑率、自动标记（阶段 8）
  ratelimit.ts          新：令牌桶（按连接、按 IP、按接口）
  maintenance.ts        新：维护模式
  db/
    index.ts            新：打开数据库、执行迁移
    schema.sql          新：10.2 的 DDL
    migrations/         新：001_init.sql、002_...（按 meta.schema_version 顺序执行）
    repo.ts             新：所有 SQL 语句集中在这里（prepare 一次、复用）
    importLegacy.ts     新：导入 yi-ratings.json（见 10.6）
  store.ts              删除（被 db/repo.ts 取代；测试用 ':memory:' 数据库）
  admin/                阶段 8：命令行管理工具
```

`RoomServer` 保持“与传输无关、时钟可注入”的特点，方便测试。

### 10.4 这一阶段写入数据库的内容（仍是协议 v3，还没有账号）

- 每个连上来的 uid 建一个 `kind='guest'` 的用户，写入 `devices`，段位从 `ratings` 表读。
- 每局开始 `INSERT games`（基本信息），结束时 `UPDATE` 写入 `record`、结果、每手用时。**对局记录从这一刻开始积累**，以后反作弊有据可查。
- 排位结算写 `ratings` 和 `rating_changes`，包在一个事务里；**结算前从数据库重新读取段位**，不再用登录时缓存的那份（彻底解决 A8 的覆盖问题）。
- 每手用时：服务端在 `startTurn` 记开始时刻，收到 `move` 时算出毫秒数写进 `MoveRec.ms`。

### 10.5 服务端加固（从阶段 8 提前）

| 项 | 做法 |
|---|---|
| 消息频率 | 每条连接每秒最多 20 条消息，超出丢弃，持续超出断开 |
| 按 IP 限流 | 加入房间失败次数（A6）、新建连接频率按 IP 统计；IP 取法见阶段 4 |
| 维护模式 | `node server.cjs admin maintenance on`：不再接受新的匹配和开房间，向在线玩家提示“服务器即将维护”；等所有对局结束（或到达设定的最长等待时间）后退出，由 systemd 重启新版本 |

### 10.6 老数据迁移

`yi-ratings.json` 的结构是 `{ [uid_hash]: { name, ratings } }`。首次启动时，如果数据库为空并且找到这个文件：

1. 每一项建一个 `guest` 用户，名字沿用，`devices` 写入这个 `uid_hash`；
2. 写入 `ratings`，同时写一条 `rating_changes(cause='import')`；
3. 把原文件改名为 `yi-ratings.json.imported`，不删除。

### 10.7 备份

- systemd timer 每天执行一次 `node server.cjs backup`，内部用 `VACUUM INTO '/opt/yi/backup/yi-YYYYMMDD.db'` 生成一致的快照，保留最近 14 份。
- README 补一节“备份与恢复”。

**验收**：打满一局匹配和一局排位，数据库里有 `games`、`ratings`、`rating_changes` 记录；重启服务端后段位不丢；导入老 JSON 的测试通过；维护模式演练一次；`tests/server.test.ts` 改用 `:memory:` 数据库后全部通过。

---

## 11 阶段 4：域名与 TLS（约 0.5 天，**备案通过后**，随 3.0 发布）

备案期间游戏直连 `ws://IP:8443`，域名不对外提供任何服务。备案通过后：对外走标准 443，Caddy 用 HTTP 验证自动签发证书，再转到本机 8443。**客户端地址的切换放在 3.0 里一起发**，不单独强制更新。

| 改动 | 说明 |
|---|---|
| 域名 | `yi.lightking.com.cn`，A 记录指向服务器 |
| Caddy | 安装 Caddy，自动申请并续期证书：`yi.lightking.com.cn { reverse_proxy 127.0.0.1:8443 }` |
| 服务端只监听本机 | 3.0 服务端设 `HOST=127.0.0.1`；安全组开放 80、443。过渡期若还要服务 2.x 老客户端，可另开一个对外端口，直到强制更新完成 |
| 客户端地址 | `.env.production`：`VITE_YI_SERVER=wss://yi.lightking.com.cn/ws`，HTTP 接口为 `https://yi.lightking.com.cn/api` |
| CSP | `index.html` 的 `connect-src` 现在是 `'self' ws: wss:`，改为只允许 `wss://yi.lightking.com.cn https://yi.lightking.com.cn`；开发时由 Vite 注入本机地址 |
| 真实 IP | 服务端取客户端 IP 时读 `X-Forwarded-For`（只信任来自 127.0.0.1 的这个头），限流和反作弊要用 |

**验收**：`curl -I https://yi.lightking.com.cn` 证书有效；桌面版用新地址可以联机；`ss -lnt` 看到 8443 只监听 127.0.0.1。

---

## 12 阶段 6：账号系统（约 4 天，需要 D2–D5）

### 12.1 HTTP 接口（`/api/*`，JSON，只走 HTTPS）

| 方法 | 路径 | 入参 | 说明 |
|---|---|---|---|
| POST | `/api/code` | `email, purpose` | 发邮箱验证码（注册、找回密码） |
| POST | `/api/register` | `email, code, password, name, uid, consent` | 注册并登录（`consent` 必须为真）；把这台设备的游客档案并入（12.4） |
| POST | `/api/login` | `email, password, uid` | 登录，返回 `{ token, user, ratings }` |
| POST | `/api/logout` | — | 注销当前令牌 |
| POST | `/api/password/reset` | `email, code, password` | 找回密码，同时注销该账号的所有会话 |
| POST | `/api/password/change` | `old, password` | 改密码 |
| GET | `/api/me` | — | 当前用户、段位、状态 |
| POST | `/api/me/name` | `name` | 改昵称（每 30 天一次） |
| DELETE | `/api/me` | `password` | 注销账号（个人信息清空，对局记录匿名化保留） |
| GET | `/api/users/:id` | — | 公开资料：昵称、段位、战绩统计 |
| GET | `/api/users/:id/games` | `?type&before&limit` | 战绩列表 |
| GET | `/api/games/:id` | — | 单局：双方、结果、`GameRecord`（用于复盘） |
| GET | `/api/leaderboard` | `?type` | 排行榜前 100（只含会员、非定级期、状态正常） |
| POST | `/api/report` | `gameId, reason, note` | 举报对手 |

鉴权：请求头 `Authorization: Bearer <token>`。错误统一返回 `{ error: '<code>' }`，客户端翻译成文字。

### 12.2 安全细节

| 项 | 做法 |
|---|---|
| 密码散列 | `crypto.scrypt`，N=2^15、r=8、p=1、16 字节盐、64 字节输出，存成 `scrypt$32768$8$1$<salt>$<hash>`；比较用 `timingSafeEqual` |
| 密码要求 | 至少 8 位；不能与邮箱相同 |
| 会话令牌 | 32 字节随机数，base64url；数据库只存 sha256；有效期 90 天，每次使用后顺延 |
| 验证码 | 6 位数字，10 分钟有效，最多试 5 次，存散列。同一邮箱 60 秒内只能发一次，每天最多 10 次 |
| 限流 | 按 IP：登录每分钟 10 次，注册每小时 5 次，发验证码每小时 10 次。登录连续失败 10 次，该账号锁 15 分钟 |
| 不泄露账号是否存在 | “找回密码”对不存在的邮箱也返回成功 |
| 昵称 | 长度沿用 `NAME_MAX = 16`；过滤控制字符（已有 `cleanName`），再加一份敏感词表 `server/data/badwords.txt` |
| 客户端保存令牌 | 通过 preload 新增 `yiNative.secret.get/set`，用 Electron 的 `safeStorage`（macOS 钥匙串 / Windows DPAPI）加密后存在 userData；开发时在浏览器里调试则退回 `localStorage` |
| 邮件 | **阿里云默认封禁 25 端口，SMTP 走 465（SSL）**。用 Node 内置的 `tls` 写一个最小的 SMTP 客户端（约 150 行），保持免 `npm install`。邮件推送要在 `lightking.com.cn` 上配 SPF、DKIM 解析记录。配置：`SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASS、MAIL_FROM` |
| 隐私同意 | 注册页有“我已阅读并同意《隐私说明》”勾选框，不勾不能注册；同意时刻写入 `users.consent_at` |

### 12.3 联机时的身份

- WebSocket 握手的 `hello` 带上会话令牌（见 13 节）。服务端验证后，这条连接就是这个会员。没有令牌就按游客处理（`uid_hash` 找到或新建游客用户）。
- **同一账号只允许一个联机会话**（A8 的最终解决）：在另一处登录联机时，旧连接收到 `kicked { reason: 'elsewhere' }`；如果旧连接正在对局，对局转到新连接（与断线重连相同）。
- 每次 `hello` 都从数据库重新读取用户状态，封禁立即生效。

### 12.4 游客并入会员

注册或第一次登录时，客户端带上本机 `uid`：

- 找到该设备的游客用户；如果会员这边还没有任何排位局，就把游客的 `ratings` 复制过来（写 `rating_changes(cause='import')`），并把游客的 `games.black_id / white_id` 改指到会员；
- 否则只关联设备，不合并分数（防止用小号养分再并入）；
- 游客用户标记 `merged_into = 会员 id`。

### 12.5 客户端界面

| 位置 | 改动 |
|---|---|
| 多人游戏页顶部 | 显示当前身份：“游客 · 棋手123 【登录 / 注册】”或“会员昵称 · 段位 【账号】” |
| 新面板 `AccountPanel` | 登录、注册（邮箱 → 收验证码 → 设密码和昵称 → 勾选同意隐私说明）、找回密码、改密码、改昵称、退出登录、注销账号 |
| 排位按钮 | 游客点击时提示“排位需要登录”，并打开登录面板 |
| 设置 | “联机昵称”改为：游客时可改；会员时跳到账号面板 |
| 更多 | 新增《隐私说明》页；“联机”页改掉“段位跟着这台设备”的说法（C21） |
| 新文件 | `src/online/api.ts`（HTTP 接口封装）、`src/online/auth.ts`（令牌保存、当前用户 signal）、`src/ui/account.tsx` |

**验收**：注册、登录、登出、找回密码、改昵称全流程可用；游客可以匹配、不能排位；两台设备登录同一账号时旧的被踢下线；限流和锁定生效（有测试）。

---

## 13 阶段 7：联机协议 v4（约 3 天，与阶段 6 同时发布）

### 13.1 变更一览（`src/shared/protocol.ts`，`PROTO_VERSION = 4`）

**客户端 → 服务端**

| 消息 | 变化 |
|---|---|
| `hello` | `{ v: 4, app, name, uid, auth?: string, resume?: string }`：`app` 是客户端版本号；`auth` 是登录令牌；`resume` 是断线重连令牌（原来的 `token` 改名） |
| `move` | 增加 `seq`：客户端认为这是第几手（从 1 开始）。不一致就拒绝，防止重复提交和乱序 |
| `pass`、`undo`、`draw`、`resign`、`mark`、`agree`、`resume` | 同样带 `seq` |
| `resync` | 新：客户端发现局面散列不一致时请求完整同步 |
| `name` | 会员不能用它改名（改名走 HTTP） |

**服务端 → 客户端**

| 消息 | 变化 |
|---|---|
| `welcome` | `{ id, resume, user: { id, name, member, status }, ratings, latest?, url? }` |
| `resumeFailed` | 2.0.1 已加入，v4 保留：重连令牌无效，客户端退出对局并提示 |
| `start` | 增加 `gameId`，`black/white` 改为 `{ id, name, member, points?, provisional? }` |
| `moved`、`passed`、`undone`、`marked`、`resumed` | 增加 `seq`（这之后的手数）和 `hash`（Zobrist 局面散列的 16 位十六进制） |
| `sync` | 改为 `{ record: GameRecord, seq, hash, dead, agreed, ask?, turn, over?, rated? }`，一条消息恢复整局（包括已结束的对局，A4） |
| `over` | 增加 `gameId` |
| `rated` | 增加 `provisional`（是否仍在定级期）、`games` |
| `error`、`info`、`joinNo`、`unmatched` | 文字改为 `code` 加可选参数，如 `{ t: 'error', code: 'ranked-login-required' }`，客户端翻译 |
| `outdated` | 新：客户端版本过旧，带 `{ min, latest, url }`，客户端显示“请更新到 x.y.z”并给出下载链接 |
| `kicked` | 新：`{ reason: 'elsewhere' \| 'banned' \| 'server' }` |
| `restricted` | 新：`{ what: 'ranked', until }`，告诉客户端暂时不能排位及原因 |
| `maintenance` | 新：`{ at }`，服务器即将维护 |

### 13.2 一致性校验

- 服务端每次确认一手，下发 `seq` 和 `hash`。客户端用本地的 `Match` 照做后计算散列；**不一致就发 `resync`**，收到 `sync` 后用 `Match.fromRecord()` 静默重建。
- 客户端落子前本地先用 `Rules.apply` 预检，不合法的直接提示，不发给服务端（服务端照样校验）；发出落子后到收到确认前不再接受第二次点击。

### 13.3 兼容与发布

- 服务端只接受 v4。v3 客户端连上来时回一条 v3 格式的 `error`（“客户端版本与服务器不一致，请更新游戏”）；2.0.1 以后的客户端还会因 `welcome.latest` 提前看到“有新版本”的提示。
- 发布顺序：3.0 服务端与客户端同一天发布；提前几天用 `YI_LATEST` 提示大家更新，并在群里通知。

### 13.4 测试

`tests/server.test.ts`、`tests/client.test.ts` 按 v4 更新；新增：`seq` 乱序与重复提交被拒；人为制造散列不一致后 `resync` 能恢复；带登录令牌的 `hello`；同一账号两处登录；过旧客户端收到 `outdated`。

---

## 14 阶段 8：反作弊与管理工具（约 4 天）

### 14.1 自动规则（`server/anticheat.ts`，阈值集中在 `server/config.ts`）

| 规则 | 具体做法 | 应对的作弊方式 |
|---|---|---|
| 排位资格 | 必须是会员、邮箱已验证、状态不是 `ranked_ban` 或 `banned` | 小号 |
| 同设备 / 同 IP 不配对 | 排位队列里，双方任一 `uid_hash` 相同，或本次连接 IP 相同，不配对 | 自己跟自己刷分 |
| 同一对手限次 | 24 小时内同一对手的排位局，只有前 3 局计分，之后照常下但不计分（开局时提示“本局不计段位”） | 两个号互刷 |
| 定级期 | 前 10 局排位 K=48，段位显示“定级中”，不上排行榜；之后 K=32；2000 分以上 K=24 | 新号影响排行 |
| 逃跑惩罚 | 最近 20 局排位中，离开 + 掉线未归达到 30% 或以上：暂停排位 24 小时；再犯 72 小时；第三次 7 天。写入 `sanctions` | 输棋就跑 |
| 短局标记 | 五子棋少于 10 手、围棋少于 30 手就以认输、离开、超时结束的排位局，在 `games.flags` 标记 `short`；同一对双方 7 天内短局达到 3 次，给双方标记 `farming?` 待人工复查 | 秒投送分 |
| 举报阈值 | 7 天内被 3 个不同的人举报：账号标记待复查，并在管理工具里置顶 | 各类 |
| 用时特征 | 每局结束后计算双方每手用时的均值与变异系数；排位中连续 10 局变异系数异常低（如低于 0.15）、且胜率异常高，标记 `timing?` | 借助 AI（辅助线索） |
| **内置 AI 重合率** | 五子棋排位局结束后，后台用内置困难 AI 对每一手复算首选点，统计重合率；连续多局明显高于同段位平均水平，标记 `engine?`。**内置 AI 本身就是最容易拿到的外挂**，所以这项对五子棋有实际意义；围棋内置 AI 较弱，只作参考 | 借助 AI |

**对“借助 AI 下棋”要实事求是**：没有可靠的自动判定手段，本方案**只做标记、不自动处罚**，最终由人看棋谱判断。

### 14.2 管理工具（`node server.cjs admin <命令>`）

直接读写数据库；需要让运行中的服务端立即生效的操作（封禁、踢人、维护模式），通过本机接口 `POST http://127.0.0.1:<端口>/admin/...` 通知，请求头带 `ADMIN_TOKEN`，并且只接受来自 127.0.0.1 的请求。

| 命令 | 作用 |
|---|---|
| `admin user <邮箱/昵称/id>` | 用户资料、段位、处罚历史、关联设备、共用设备的其他账号 |
| `admin games <用户> [--last 20]` | 最近对局列表：对手、结果、手数、时长、标记 |
| `admin game <id> [--sgf]` | 打印单局：终局盘面（字符画）、每手坐标与用时；`--sgf` 导出 SGF 复盘 |
| `admin analyze <用户> [--last 20]` | 用时统计、与内置 AI 首选点的重合率、逃跑率、主要对手分布 |
| `admin flagged` | 待复查列表（自动标记 + 举报阈值） |
| `admin reports [--open]`、`admin report <id> valid\|invalid` | 处理举报 |
| `admin mute\|ranked-ban\|ban <用户> --days N --reason "…"` | 处罚，同时写 `sanctions`、`audit`；`ban` 会踢掉在线连接，并把关联设备标记为高风险（这些设备注册的新号要人工确认后才能排位） |
| `admin unban <用户>` | 解除 |
| `admin rollback <用户> [--since 日期]` | 回滚：该用户在范围内所有排位局里，**对手**因输给他而扣的分全部加回（写 `rating_changes(cause='rollback')`）；该用户本人分数重置为 1200 或指定值。对手之后的分数变化不重算 |
| `admin rename <用户> <新名>` | 强制改名 |
| `admin maintenance on\|off [--wait 分钟]` | 维护模式（见 10.5） |
| `admin stats` | 在线人数、今日对局数、队列人数、注册数 |
| `admin backup` | 立即备份 |

> 关于回滚：严格来说，对手被扣分后又下了别的棋，后续的 Elo 都会受影响。完全重算代价大，而且会让大量无关玩家的分数跳动，所以只把“直接被作弊者赢走的分”还回去。这是常见的折中做法。

### 14.3 客户端

- 联机终局后，对局面板加“举报”按钮 → 选择原因（使用外挂 / 刷分 / 辱骂或恶意拖延 / 不当昵称 / 其他）+ 可选说明。
- 被暂停排位时，排位按钮显示原因与剩余时间（来自 `restricted` 消息）。
- 开局时如果本局不计段位（同一对手限次），显示“本局不计段位”。

**验收**：`tests/anticheat.test.ts` 覆盖每条规则；在测试服演练一次“发现 → 查看 → 封禁 → 回滚”的完整流程。

---

## 15 阶段 9：新功能与体验（3.x，按需逐个交付）

| 功能 | 说明 | 约（天） |
|---|---|---|
| 战绩页 | 多人游戏页新增“战绩”：最近对局、胜负、段位变化曲线 | 1.5 |
| 复盘 | 新界面 `Screen.Replay`：前进、后退、跳到第 N 手、自动播放；联机棋谱从 `/api/games/:id` 取，单机棋谱从本地取 | 2 |
| 排行榜 | 五子棋、围棋各一张，前 100 | 0.5 |
| 对局中打开设置（B12） | 对局面板加“设置”入口，以浮层打开，不离开对局 | 0.5 |
| 残局存档 | 单机和人机对局退出时自动保存，回来可继续（只存 `GameRecord`） | 0.5 |
| 自动更新 | `electron-updater`，更新包放在 Release 或自己的服务器上。Windows、Linux 直接可用；**macOS 自动更新要求正式签名**（Apple 开发者账号），没有签名时保持 2.0.1 的“提示并打开下载地址” | 1.5 |
| 静止时降帧（B16） | 没有动画、光影关闭、鼠标不动时停止重绘，有变化再恢复 | 1 |
| 界面刷新自动化 | 用 signals 替换 `uiKey` / `bump()`；完整的界面路由状态机（原阶段 3 的剩余部分） | 1.5 |
| SGF 导入导出 | 复盘界面里导出；单机可以导入 SGF 摆出局面继续下 | 1 |
| 读秒 | `Clock` 抽象：每步限时（现有）、包干、包干 + 读秒；好友房可选 | 2 |
| 观战 | 好友房可以带观战者；协议加 `watch` / `unwatch`，观战者两个座位都是只读的 RemoteSeat | 2 |
| 形势判断 / 提示 | 单机时用现有 AI 给出建议点或胜率估计 | 1 |

---

## 16 改造后的目录结构

```
src/
  main.tsx
  core/            纯规则：types、config、move、rules/{gomoku,go}、record、zobrist、sgf、renju、*AI
  session/         match、seats、aiSeat、remoteSeat、policy
  presentation/    boardView（全部动画状态、禁手点缓存）
  app/             app（帧循环）、router、controller（输入 → 意图）、settings、ai.worker、scenarios（开发用场景脚本）
  render/  fx/  scene/  audio/      读 BoardView 与对局快照
  online/          client（WebSocket 会话）、api（HTTP）、auth（令牌与当前用户）、config（服务器地址）
  shared/          protocol（v4）、errors（错误码）
  ui/              panels、online、account、records（战绩）、replay、widgets、assets
  i18n/
server/
  main.ts config.ts http.ts host.ts hub.ts matchmaking.ts room.ts rating.ts anticheat.ts ratelimit.ts maintenance.ts mail.ts
  db/{index.ts, schema.sql, migrations/, repo.ts, importLegacy.ts}
  admin/{cli.ts, commands/*.ts}
  data/badwords.txt
electron/          main（单实例、日志）、preload（log、secret.get/set）
scripts/           build-node、make-fonts、changelog、release、deploy.sh、shots、compare-shots
tests/             rules、record、match、client、server、auth、anticheat、db、e2e
docs/              PLAN.md（本文）、PROTOCOL.md（v4 详细说明）、OPS.md（部署、备份、维护、管理）
.github/workflows/ ci.yml、release.yml
```

---

## 17 测试、运维与隐私

### 17.1 测试

| 文件 | 覆盖 | 阶段 |
|---|---|---|
| `tests/rules.test.ts` | 现有用例 + 每种 `Reject` + 确定性 + 长局 + 黑棋无处可下 | 1 |
| `tests/record.test.ts` | 回放、悔棋、点目、SGF 往返 | 1 |
| `tests/match.test.ts` | 三种座位组合、事件顺序、取消思考 | 2 |
| `tests/client.test.ts` | **联机客户端状态机**：假 WebSocket 接进程内服务端；重连、半开连接、服务端重启、静默断线、断线期间终局 | 0.5 |
| `tests/server.test.ts` | 协议全流程（假时钟 + `:memory:` 数据库）、A5–A8 | 0.5、5、7 |
| `tests/db.test.ts` | 迁移、老数据导入、回滚 | 5 |
| `tests/auth.test.ts` | 注册、登录、验证码、限流、锁定、令牌过期、游客并入 | 6 |
| `tests/anticheat.test.ts` | 14.1 的每条规则 | 8 |
| `tests/e2e.test.ts` | 真起一个 http + ws 服务端，两个 ws 客户端下完一局排位 | 7 |
| 场景脚本 | `?scenario=…` 手动截图对比特效 | 1 起 |

### 17.2 隐私与数据保留

- 收集的个人信息只有：邮箱、密码散列、IP、设备散列。“更多”里加《隐私说明》，写清楚用途（登录、反作弊）和保留期限；注册时必须勾选同意。
- `games.black_ip / white_ip` 保留 180 天后清空（每日维护任务执行）；`sessions` 过期自动删除。
- 注销账号：清空邮箱、密码，昵称改为“已注销用户”，对局记录匿名保留（对手的战绩还要用）。
- 客户端日志（`userData/logs/yi.log`）只在本机，不上传。

### 17.3 运维（写进 `docs/OPS.md`）

- systemd 服务：环境变量文件 `/etc/yi.env`（`PORT`、`EXTRA_PORTS`、`HOST`、`YI_DB`、`YI_LATEST`、`YI_DOWNLOAD`、`SMTP_*`、`ADMIN_TOKEN`）。
- 日志：继续输出到 stdout，由 journald 收集；加上 `[auth]`、`[anticheat]`、`[admin]` 前缀方便过滤。
- 每日任务：备份、清理过期会话和验证码、清空过期 IP、解除到期处罚。
- **升级步骤**：`admin maintenance on --wait 30` → 等对局结束 → 备份数据库 → 替换 `server.cjs` → `systemctl restart yi`（启动时自动执行迁移）→ 更新 `YI_LATEST`。
- **发版步骤**：见 [RELEASE.md](RELEASE.md)。

---

## 18 风险与对策

| 风险 | 对策 |
|---|---|
| 重构引入回归 | 每步测试全过；场景脚本截图对比特效；三种模式手动走查 |
| 画面特效在重构中悄悄坏掉 | 阶段 1 之前先做场景脚本并截图留底（C22） |
| 强制更新时玩家连不上 | 只强制两次；2.0.1 起有“新版本提示”；换端口时新旧端口同时开放一段时间 |
| Windows / Linux 上表现未知 | 阶段 R 实机测试；必要时附带字体子集 |
| 服务端升级打断对局 | 维护模式：等对局结束再重启 |
| 数据库文件损坏或误删 | WAL 模式、每日 `VACUUM INTO` 备份、保留 14 天；建议再同步一份到对象存储 |
| 邮件发不出或进垃圾箱 | 走 465 端口；正规邮件推送服务；配好 SPF / DKIM；验证码页面提示“查看垃圾邮件” |
| 反作弊误伤 | 自动规则只做“暂停排位”和“标记”，封号必须人工确认；所有处罚可撤销、有记录 |
| 合规（D6、D7） | 备案通过前域名不对外提供服务；备案若因游戏或交互内容被驳回，改用香港服务器（改解析、改客户端地址即可）。公开运营前再评估实名与防沉迷要求 |
| 安装包分发 | GitHub Release（私有仓库时需要给朋友一个可下载的地址，如网盘或自己服务器上的静态文件） |
| macOS 未签名 | 分发说明写清首次打开方法；自动更新在 macOS 上退化为“提示并打开下载地址” |

---

## 19 工作量汇总（粗估）

| 阶段 | 内容 | 约（天） |
|---|---|---|
| 0 | 工程基础 | ✅ 已完成 |
| 0.5 | **2.0.1 稳定版** | 3 |
| 1 | 规则层纯化（含场景脚本） | 3.5 |
| 2 | Match / Seat、电脑可取消 | 3 |
| 3′ | 解开循环依赖 | 0.5 |
| R | 发布工程 | ✅ 已完成 |
| 5 | 数据库、对局记录、服务端加固 | 3.5 |
| 4 | 域名与 TLS | 0.5（不含备案等待） |
| 6 | 账号系统 | 4 |
| 7 | 协议 v4 | 3 |
| 8 | 反作弊与管理工具 | 4 |
| **合计（至 3.0）** | | **约 27 天** |
| 9 | 新功能与体验（按需） | 每项 0.5 至 2 |

**下一步**：确认 D9（建议先做 2.0.1），即可开始阶段 0.5；D10、D11、D12 可以在做的过程中再定。
