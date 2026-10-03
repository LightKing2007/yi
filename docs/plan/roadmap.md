# 弈 · 架构改造路线图

| 项目 | 内容 |
|---|---|
| 性质 | 计划，资料性；各阶段的实施必须符合 [docs/standards/](../standards/00-general.md)，二者冲突时以规范为准 |
| 文件版本 | 第 3 版 |
| 修订日期 | 2026-10-02 |
| 当前版本 | 2.0.4（联机协议第 3 版） |
| 下一阶段 | 阶段 5：数据库、对局记录与服务端加固 |

本文件规定“弈”的架构改造目标、原则与尚未完成的阶段。已完成阶段的设计与实施细节见 Git 历史（第 2 版：提交 `ed1cb10` 中的 `docs/PLAN.md`，可用 `git show ed1cb10:docs/PLAN.md` 查看）；规范整改项见 [remediation.md](remediation.md)。

## 1 目标与原则

### 1.1 目标

1. 规则层做成纯函数、确定性，客户端与服务端共用，便于测试、回放、存档。
2. 单机双人、人机、联机、观战统一成“一场对局 + 两个座位”。
3. 玩家数据（账号、段位、战绩、每一局棋谱）存在服务器数据库里，能查、能复盘、能回滚。
4. 排位赛需要登录；有一套可执行的反作弊规则和管理工具。
5. **联机稳定可靠**：断网、服务器重启、对局中途结束等情况都有明确结果，不会卡死。
6. **发布流程自动化**：三平台安装程序自动构建，玩家可收到新版本提示。

### 1.2 原则

- **逐步替换，不推倒重写**：每一阶段结束，测试全部通过，游戏行为不变（除非该阶段就是要改行为）。
- **强制更新只有两次**：2.0.1（换端口 + 稳定性，并带上“新版本提示”）与 3.0（账号 + 协议 v4 + 域名）。其余版本服务端向下兼容。
- **服务端继续是单文件、免 `npm install`**：数据库用 Node 内置的 `node:sqlite`。
- **本机不做全局安装**：开发工具都放在项目依赖里；服务器上的软件（Node、Caddy）只装在服务器上。
- 新增界面文字都在 `src/i18n/table.ts` 补齐文言、中文、English。
- 提交说明带 `Co-Authored-By: Claude` 署名。

## 2 已完成的阶段

| 阶段 | 内容 | 发布版本 |
|---|---|---|
| 0 | 工程基础：Git、CI、服务器地址配置化、端口统一为 8443 | 2.0.1 |
| 0.5 | 2.0.1 稳定版：联机缺陷修复、WebGL 恢复、单实例、错误日志、版本号统一、新版本提示、双端口过渡 | 2.0.1 |
| 1 | 规则层纯化：规则纯函数、`Reject` 错误码、棋谱与回放、画面回归场景脚本 | 2.0.1 |
| 2 | 对局会话与座位：三种模式统一为一场对局加两个座位；电脑思考可取消；五子棋困难难度限时 | 2.0.1 |
| 3′ | 解开模块间的循环依赖，建立分层检查 | 2.0.1 |
| R | 发布工程：三平台自动出包、内置字体子集、服务器上的下载页面、规范化的发布流程 | 2.0.2 |

第 2 版问题清单中的 A1 至 A5、A7、B9 至 B11、B13 至 B15、C17、C19 至 C22 已全部解决。仍未解决的问题已并入第 5 章至第 10 章的对应阶段：A6（按 IP 限制加入房间，阶段 5）、A8（单账号单会话，阶段 6）、B12、B16、C18（阶段 9）、C21 第三项（“段位与本机绑定”的说明，阶段 6）。

## 3 决策记录

| # | 事项 | 状态 / 默认方案 | 备选 |
|---|---|---|---|
| D1 | 域名 | **已定**：`lightking.com.cn`（已购），游戏服务用 `yi.lightking.com.cn` | — |
| D2 | 登录方式 | 待定，默认：邮箱 + 密码，邮箱验证码 | 手机短信（要费用和资质）；微信 / QQ 登录（要申请开放平台） |
| D3 | 发邮件 | 待定，默认：阿里云邮件推送（DirectMail），**SMTP 走 465 端口** | QQ 邮箱 / 163 的 SMTP（有发信上限） |
| D4 | 游客能玩什么 | 待定，默认：匹配和好友房不用登录；排位必须登录并验证邮箱 | 全部必须登录 |
| D5 | 昵称是否唯一 | 待定，默认：会员昵称全服唯一；游客昵称不限，显示“游客”标记 | 都不唯一 |
| D6 | 服务器与端口 | **已定**：继续用阿里云大陆服务器；ICP 备案已提交（2026-10-01）。服务端端口统一为 **8443**；备案通过后对外走 443，由 Caddy 转到本机 8443 | 备案被驳回时换香港服务器 |
| D7 | 公开运营范围 | 自己与朋友圈小范围 | 面向大陆公众运营时，还要评估网络游戏实名认证与防沉迷要求 |
| D8 | 发行平台 | **已定**：只做桌面版（macOS、Windows、Linux） | — |
| D9 | 是否先出 2.0.1 稳定版 | **已定并完成**：2.0.1 已发布 | — |
| D10 | Windows / Linux 实机测试 | **已定**：以 GitHub Actions 的 Windows、Linux 机器运行安装程序与界面截图验证；发布前按平台验证清单检查 | — |
| D11 | 玩家规模 | 待定：影响 A6、A7 等安全项的紧迫程度 | — |
| D12 | 禁手下黑棋无处可下 | **已定并实施**：判和棋（`reason: 'full'`） | 判黑负 |

## 4 路线图

### 4.1 版本与阶段

| 顺序 | 版本 | 阶段 | 内容 | 约（天） | 强制更新 |
|---|---|---|---|---|---|
| 1 | 2.0.x | — | 规范整改 P0、P1 项（[remediation.md](remediation.md)） | 见整改路线图 | 否 |
| 2 | 2.1 | 5 | 数据库与对局记录；服务端加固（限流、连接上限）；维护模式 | 3.5 | 否（仅服务端） |
| 3 | **3.0** | 4 + 6 + 7 | 域名与 TLS（待备案通过）、账号系统、协议 v4 | 7.5 | **是** |
| 4 | 3.0 | 8 | 反作弊与管理工具 | 4 | — |
| 5 | 3.x | 9 | 新功能（复盘、战绩、自动更新、对局中设置等） | 按需 | 否 |

### 4.2 时间线

```
现在（2.0.4）─► 规范整改 P0、P1 ─► 阶段 5 ─► 发布 2.1（以服务端为主）
                                              ▼
                     ICP 备案通过 ─► 阶段 4 + 6 + 7 ─► 阶段 8 ─► 发布 3.0 ─► 阶段 9
```

**关键路径**：阶段 5（对局记录入库）→ 阶段 6、7（账号与协议）。阶段 4 取决于 ICP 备案的审核进度。

## 5 阶段 5：数据库、对局记录与服务端加固（约 3.5 天）

### 5.1 选型

- `node:sqlite`（Node 22.13+ 无需参数；服务器上推荐 Node 24 LTS，先确认系统 glibc ≥ 2.28）。同步 API（`DatabaseSync`），适合单进程服务端。
- 打开时设置 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;`。
- 文件位置：环境变量 `YI_DB`，默认 `./yi.db`。
- 服务端仍打包成单文件 `server.cjs`，`scripts/build-node.mjs` 的服务端构建目标升到 `node22`。

### 5.2 表结构

本节表结构为草案，实施前必须按 [03-data.md](../standards/03-data.md) 修订（整改项 P2-01）：时间改为 UTC 毫秒、IP 截断存储、`flags` 改为子表、全部表声明 `STRICT`、索引统一命名、避免保留字作列名；二者冲突时以规范为准。

### 5.2.1 草案（完整 DDL，放在 `server/db/schema.sql`，以迁移脚本方式执行）

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
  black_ip    TEXT, white_ip TEXT,                    -- 按 DAT-071 截断存储，180 天后清空（DAT-074）
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

### 5.3 服务端代码结构

`rooms.ts` 现在约 1050 行（2026-10-02 按 Prettier 格式化后），拆成：

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
    schema.sql          新：5.2 的 DDL
    migrations/         新：001_init.sql、002_...（按 meta.schema_version 顺序执行）
    repo.ts             新：所有 SQL 语句集中在这里（prepare 一次、复用）
    importLegacy.ts     新：导入 yi-ratings.json（见 5.6）
  store.ts              删除（被 db/repo.ts 取代；测试用 ':memory:' 数据库）
  admin/                阶段 8：命令行管理工具
```

`RoomServer` 保持“与传输无关、时钟可注入”的特点，方便测试。

### 5.4 这一阶段写入数据库的内容（仍是协议 v3，还没有账号）

- 每个连上来的 uid 建一个 `kind='guest'` 的用户，写入 `devices`，段位从 `ratings` 表读。
- 每局开始 `INSERT games`（基本信息），结束时 `UPDATE` 写入 `record`、结果、每手用时。**对局记录从这一刻开始积累**，以后反作弊有据可查。
- 排位结算写 `ratings` 和 `rating_changes`，包在一个事务里；**结算前从数据库重新读取段位**，不再用登录时缓存的那份（彻底解决 A8 的覆盖问题）。
- 每手用时：服务端在 `startTurn` 记开始时刻，收到 `move` 时算出毫秒数写进 `MoveRec.ms`。

### 5.5 服务端加固（从阶段 8 提前）

| 项 | 做法 |
|---|---|
| 消息频率 | 每条连接每秒最多 20 条消息，超出丢弃，持续超出断开（已随整改项 P1-05 实施） |
| 按 IP 限流 | 加入房间失败次数（A6）按 IP 统计；新建连接频率已随整改项 P1-05 实施；IP 取法见阶段 4 |
| 维护模式 | `node server.cjs admin maintenance on`：不再接受新的匹配和开房间，向在线玩家提示“服务器即将维护”；等所有对局结束（或到达设定的最长等待时间）后退出，由 systemd 重启新版本 |

### 5.6 老数据迁移

`yi-ratings.json` 的结构是 `{ [uid_hash]: { name, ratings } }`。首次启动时，如果数据库为空并且找到这个文件：

1. 每一项建一个 `guest` 用户，名字沿用，`devices` 写入这个 `uid_hash`；
2. 写入 `ratings`，同时写一条 `rating_changes(cause='import')`；
3. 把原文件改名为 `yi-ratings.json.imported`，不删除。

### 5.7 备份

- systemd timer 每天执行一次 `node server.cjs backup`，内部用 `VACUUM INTO '/opt/yi/backup/yi-YYYYMMDD.db'` 生成一致的快照，保留最近 14 份。
- README 补一节“备份与恢复”。

**验收**：打满一局匹配和一局排位，数据库里有 `games`、`ratings`、`rating_changes` 记录；重启服务端后段位不丢；导入老 JSON 的测试通过；维护模式演练一次；`tests/server.test.ts` 改用 `:memory:` 数据库后全部通过。

### 5.8 并入本阶段的事项

- 按 IP 限制加入房间的失败次数（原问题 A6），与 API-041、API-044 一并实施。
- 维护模式：停止开新局，等待现有对局结束后重启（OPS-045）。升级步骤为：开启维护模式并等待 ≤ 30 分钟 → 备份数据库 → 上线新版本（启动时自动执行迁移）→ 健康检查（OPS-046）。
- 每日维护任务：备份、清理过期会话与验证码、截断到期的 IP、解除到期的处罚（DAT-061、DAT-074）。

## 6 阶段 4：域名与 TLS（约 0.5 天，**备案通过后**，随 3.0 发布）

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

## 7 阶段 6：账号系统（约 4 天，需要 D2–D5）

### 7.1 HTTP 接口（`/api/*`，JSON，只走 HTTPS）

| 方法 | 路径 | 入参 | 说明 |
|---|---|---|---|
| POST | `/api/code` | `email, purpose` | 发邮箱验证码（注册、找回密码） |
| POST | `/api/register` | `email, code, password, name, uid, consent` | 注册并登录（`consent` 必须为真）；把这台设备的游客档案并入（7.4） |
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

### 7.2 安全细节

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

### 7.3 联机时的身份

- WebSocket 握手的 `hello` 带上会话令牌（见 13 节）。服务端验证后，这条连接就是这个会员。没有令牌就按游客处理（`uid_hash` 找到或新建游客用户）。
- **同一账号只允许一个联机会话**（A8 的最终解决）：在另一处登录联机时，旧连接收到 `kicked { reason: 'elsewhere' }`；如果旧连接正在对局，对局转到新连接（与断线重连相同）。
- 每次 `hello` 都从数据库重新读取用户状态，封禁立即生效。

### 7.4 游客并入会员

注册或第一次登录时，客户端带上本机 `uid`：

- 找到该设备的游客用户；如果会员这边还没有任何排位局，就把游客的 `ratings` 复制过来（写 `rating_changes(cause='import')`），并把游客的 `games.black_id / white_id` 改指到会员；
- 否则只关联设备，不合并分数（防止用小号养分再并入）；
- 游客用户标记 `merged_into = 会员 id`。

### 7.5 客户端界面

| 位置 | 改动 |
|---|---|
| 多人游戏页顶部 | 显示当前身份：“游客 · 棋手123 【登录 / 注册】”或“会员昵称 · 段位 【账号】” |
| 新面板 `AccountPanel` | 登录、注册（邮箱 → 收验证码 → 设密码和昵称 → 勾选同意隐私说明）、找回密码、改密码、改昵称、退出登录、注销账号 |
| 排位按钮 | 游客点击时提示“排位需要登录”，并打开登录面板 |
| 设置 | “联机昵称”改为：游客时可改；会员时跳到账号面板 |
| 更多 | 新增《隐私说明》页；“联机”页改掉“段位跟着这台设备”的说法（C21） |
| 新文件 | `src/online/api.ts`（HTTP 接口封装）、`src/online/auth.ts`（令牌保存、当前用户 signal）、`src/ui/account.tsx` |

**验收**：注册、登录、登出、找回密码、改昵称全流程可用；游客可以匹配、不能排位；两台设备登录同一账号时旧的被踢下线；限流和锁定生效（有测试）。

### 7.6 并入本阶段的事项

- 单账号单会话：同一账号在别处登录时，以关闭码 4002 断开旧连接（原问题 A8）。
- “联机”页中“段位与本机绑定”的说明，改为“段位与账号绑定”（原问题 C21 第三项）。
- 邮件：阿里云默认封禁 25 端口，SMTP 必须使用 465 端口（SSL）；邮件推送须在域名上配置 SPF、DKIM。
- 隐私：注册时必须勾选同意《隐私说明》；“更多”中提供《隐私说明》，写明收集的个人信息（邮箱、口令散列、IP、设备散列）、用途（登录、反作弊）与保留期限（DAT-074）。
- 注销账号：清空邮箱与口令，昵称改为“已注销用户”，对局记录匿名保留。

## 8 阶段 7：联机协议 v4（约 3 天，与阶段 6 同时发布）

### 8.1 变更一览（`src/shared/protocol.ts`，`PROTO_VERSION = 4`）

**客户端 → 服务端**

| 消息 | 变化 |
|---|---|
| `hello` | `{ v: 4, app, name, uid, auth?: string, resume?: string }`：`app` 是客户端版本号；`auth` 是登录令牌；`resume` 是断线重连令牌（原来的 `token` 改名；与 v3 相同，每次重连成功都换发新的一枚，SEC-020） |
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

### 8.2 一致性校验

- 服务端每次确认一手，下发 `seq` 和 `hash`。客户端用本地的 `Match` 照做后计算散列；**不一致就发 `resync`**，收到 `sync` 后用 `Match.fromRecord()` 静默重建。
- 客户端落子前本地先用 `Rules.apply` 预检，不合法的直接提示，不发给服务端（服务端照样校验）；发出落子后到收到确认前不再接受第二次点击。

### 8.3 兼容与发布

- 服务端只接受 v4。v3 客户端连上来时回一条 v3 格式的 `error`（“客户端版本与服务器不一致，请更新游戏”）；2.0.1 以后的客户端还会因 `welcome.latest` 提前看到“有新版本”的提示。
- 发布顺序：3.0 服务端与客户端同一天发布；提前几天用 `YI_LATEST` 提示大家更新，并在群里通知。

### 8.4 测试

`tests/server.test.ts`、`tests/client.test.ts` 按 v4 更新；新增：`seq` 乱序与重复提交被拒；人为制造散列不一致后 `resync` 能恢复；带登录令牌的 `hello`；同一账号两处登录；过旧客户端收到 `outdated`。

## 9 阶段 8：反作弊与管理工具（约 4 天）

### 9.1 自动规则（`server/anticheat.ts`，阈值集中在 `server/config.ts`）

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

### 9.2 管理工具（`node server.cjs admin <命令>`）

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
| `admin maintenance on\|off [--wait 分钟]` | 维护模式（见 5.5） |
| `admin stats` | 在线人数、今日对局数、队列人数、注册数 |
| `admin backup` | 立即备份 |

> 关于回滚：严格来说，对手被扣分后又下了别的棋，后续的 Elo 都会受影响。完全重算代价大，而且会让大量无关玩家的分数跳动，所以只把“直接被作弊者赢走的分”还回去。这是常见的折中做法。

### 9.3 客户端

- 联机终局后，对局面板加“举报”按钮 → 选择原因（使用外挂 / 刷分 / 辱骂或恶意拖延 / 不当昵称 / 其他）+ 可选说明。
- 被暂停排位时，排位按钮显示原因与剩余时间（来自 `restricted` 消息）。
- 开局时如果本局不计段位（同一对手限次），显示“本局不计段位”。

**验收**：`tests/anticheat.test.ts` 覆盖每条规则；在测试服演练一次“发现 → 查看 → 封禁 → 回滚”的完整流程。

### 9.4 并入本阶段的事项

- 游戏内置的困难难度电脑本身即是最易获得的外挂（开两个窗口即可），因此“与内置电脑首选点的重合率”对五子棋有实际意义，必须纳入自动规则。

## 10 阶段 9：新功能与体验（3.x，按需逐个交付）

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

## 11 改造后的目录结构

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
docs/              standards/（工程规范）、procedures/（规程）、plan/（计划）、audits/（审计）、incidents/（事件复盘）
.github/workflows/ ci.yml、release.yml
```

## 12 测试计划

各阶段新增的测试如下，测试本身须符合 [06-testing.md](../standards/06-testing.md)：

| 文件 | 覆盖 | 阶段 |
|---|---|---|
| `tests/db.test.ts` | 迁移、老数据导入、回滚 | 5 |
| `tests/auth.test.ts` | 注册、登录、验证码、限流、锁定、令牌过期、游客并入 | 6 |
| `tests/anticheat.test.ts` | 9.1 的每条规则 | 8 |
| `tests/e2e.test.ts` | 真起一个 http + ws 服务端，两个 ws 客户端下完一局排位 | 7 |

## 13 风险与对策

| 风险 | 对策 |
|---|---|
| 重构引入回归 | 每步测试全过；场景脚本截图对比特效；三种模式手动走查 |
| 强制更新时玩家连不上 | 3.0 之前不再强制更新；新版本提示与下载页面已就绪；协议兼容规则见 VER-010 |
| 服务端升级打断对局 | 维护模式：等对局结束再重启 |
| 数据库文件损坏或误删 | 按 DAT-050 至 DAT-066 执行：WAL 模式、启动时完整性检查、本地与异地加密备份、季度恢复演练 |
| 邮件发不出或进垃圾箱 | 走 465 端口；正规邮件推送服务；配好 SPF / DKIM；验证码页面提示“查看垃圾邮件” |
| 反作弊误伤 | 自动规则只做“暂停排位”和“标记”，封号必须人工确认；所有处罚可撤销、有记录 |
| 合规（D6、D7） | 备案通过前域名不对外提供服务；备案若因游戏或交互内容被驳回，改用香港服务器（改解析、改客户端地址即可）。公开运营前再评估实名与防沉迷要求 |
| macOS 未签名 | 分发说明写清首次打开方法；自动更新在 macOS 上退化为“提示并打开下载地址” |

## 14 工作量

| 阶段 | 内容 | 约（天） |
|---|---|---|
| 5 | 数据库、对局记录、服务端加固 | 3.5 |
| 4 | 域名与 TLS | 0.5（不含备案等待） |
| 6 | 账号系统 | 4 |
| 7 | 协议 v4 | 3 |
| 8 | 反作弊与管理工具 | 4 |
| **合计（至 3.0）** | | **约 15** |
| 9 | 新功能与体验（按需） | 每项 0.5 至 2 |

规范整改项（[remediation.md](remediation.md)）的 P0、P1 项须在阶段 5 开始前完成，P2 项随对应阶段实施。
