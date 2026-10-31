# 弈 · 架构改造路线图

| 项目 | 内容 |
|---|---|
| 性质 | 计划，资料性；各阶段的实施必须符合 [docs/standards/](../standards/00-general.md)，二者冲突时以规范为准 |
| 文件版本 | 第 6 版 |
| 修订日期 | 2026-10-31 |
| 状态 | 阶段 4、5 已完成；阶段 6、7 的服务端认证基础已合并（#209 至 #219），尚未部署，产品决策见第 3 章 |
| 当前版本 | 3.1.0（联机协议第 3 版） |
| 下一阶段 | 阶段 6、7：账号系统与联机协议第 4 版 |
| 相关文档 | [下一步开发计划](next-development.md)、[阶段 5 验收](phase5.md)、[整改路线图](remediation.md) |

本文件规定“弈”的架构改造目标、原则与尚未完成的阶段。已完成阶段的设计与实施细节见 Git 历史（第 2 版：提交 `ed1cb10` 中的 `docs/PLAN.md`，可用 `git show ed1cb10:docs/PLAN.md` 查看）；规范整改项见 [remediation.md](remediation.md)。

## 1 目标与原则

### 1.1 目标

1. 规则层做成纯函数、确定性，客户端与服务端共用，便于测试、回放、存档。
2. 单机双人、人机、联机、观战统一成“一场对局 + 两个座位”。
3. 玩家数据（账号、段位、战绩、每一局棋谱）存在服务器数据库里，能查、能复盘、能回滚。
4. 全部联机模式需要登录并同意相关隐私协议；有一套可执行的反作弊规则和管理工具。
5. **联机稳定可靠**：断网、服务器重启、对局中途结束等情况都有明确结果，不会卡死。
6. **发布流程自动化**：三平台安装程序自动构建，玩家可收到新版本提示。

### 1.2 原则

- **逐步替换，不推倒重写**：每一阶段结束，测试全部通过，游戏行为不变（除非该阶段就是要改行为）。
- **不兼容变更按主版本发布**：3.0.0 已完成数据库与 TLS 切换；账号系统与协议第 4 版计划随 4.0 发布。兼容安排按 VER-010 与对应的架构决策执行，不再以旧计划中的强制更新次数作为约束。
- **服务端继续是单文件、免 `npm install`**：数据库用 Node 内置的 `node:sqlite`。
- **本机不做全局安装**：开发工具都放在项目依赖里；服务器上的软件（Node、Caddy）只装在服务器上。
- 新增界面文字都在 `src/i18n/table.ts` 补齐文言、中文、English。
- 提交说明按 [发布规程](../procedures/release.md) 书写；协作者署名须反映实际参与者。

## 2 已完成的阶段

| 阶段 | 内容 | 发布版本 |
|---|---|---|
| 0 | 工程基础：Git、CI、服务器地址配置化、端口统一为 8443 | 2.0.1 |
| 0.5 | 2.0.1 稳定版：联机缺陷修复、WebGL 恢复、单实例、错误日志、版本号统一、新版本提示、双端口过渡 | 2.0.1 |
| 1 | 规则层纯化：规则纯函数、`Reject` 错误码、棋谱与回放、画面回归场景脚本 | 2.0.1 |
| 2 | 对局会话与座位：三种模式统一为一场对局加两个座位；电脑思考可取消；五子棋困难难度限时 | 2.0.1 |
| 3′ | 解开模块间的循环依赖，建立分层检查 | 2.0.1 |
| R | 发布工程：三平台自动出包、内置字体子集、服务器上的下载页面、规范化的发布流程 | 2.0.2 |
| 4 | 域名、Caddy 与 TLS；客户端改用 `wss://`，服务端只监听本机，关闭公网 8443 | 服务器部分于 2026-10-13 完成；客户端部分随 3.0.0 发布 |
| 5 | 数据库、对局记录、备份与服务端加固；2026-10-29 完成全部验收（#205、#206） | 3.0.0；验收时线上为 3.1.0 |

官方网站主页与独立下载页面已随 3.1.0 发布（#194 至 #200），不改变联机协议版本。2026-10-31 起官网与联机程序分开构建、发布和运行（#222 至 #225），官网按提交号编号，不改变游戏版本。

第 2 版问题清单中的 A1 至 A5、A7、B9 至 B11、B13 至 B15、C17、C19 至 C22 已全部解决。A6（按 IP 限制加入房间）已随阶段 5 完成。仍未解决的问题已并入后续阶段：A8（单账号单会话，阶段 6）、B12、B16、C18（阶段 9）、C21 第三项（“段位与本机绑定”的说明，阶段 6）。

## 3 决策记录

| # | 事项 | 状态 / 默认方案 | 备选 |
|---|---|---|---|
| D1 | 域名 | **已定**：`lightking.com.cn`（已购），游戏服务用 `yi.lightking.com.cn` | — |
| D2 | 登录方式 | **已定（2026-10-30）**：邮箱 + 密码；注册填写用户名、邮箱、密码和邮箱验证码；忘记密码只能重置 | 手机短信（要费用和资质）；微信 / QQ 登录（要申请开放平台） |
| D3 | 发邮件 | 待定，默认：阿里云邮件推送（DirectMail），**SMTP 走 465 端口** | QQ 邮箱 / 163 的 SMTP（有发信上限） |
| D4 | 未登录时可使用的模式 | **已定（2026-10-30）**：仅单机双人和人机对弈；匹配、排位、好友房间均须登录并同意相关隐私协议。所有联机模式还须验证邮箱 | — |
| D5 | 显示名称与公开标识 | **已定（2026-10-30）**：名称称“雅号”，允许重名；系统分配不可更改的八位 Base32 UID，末位为校验字符（决策 0011） | — |
| D6 | 服务器与端口 | **已定并实施**：继续用阿里云大陆服务器；备案于 2026-10-12 通过；对外经 443，由 Caddy 转到本机 8443，公网 8443 已关闭 | — |
| D7 | 公开运营范围 | 自己与朋友圈小范围 | 面向大陆公众运营时，还要评估网络游戏实名认证与防沉迷要求 |
| D8 | 发行平台 | **已定**：只做桌面版（macOS、Windows、Linux） | — |
| D9 | 是否先出 2.0.1 稳定版 | **已定并完成**：2.0.1 已发布 | — |
| D10 | Windows / Linux 实机测试 | **已定**：以 GitHub Actions 的 Windows、Linux 机器运行安装程序与界面截图验证；发布前按平台验证清单检查 | — |
| D11 | 玩家规模 | 待定：影响账号并发、邮件配额、数据库增长与后续容量安排 | — |
| D12 | 禁手下黑棋无处可下 | **已定并实施**：判和棋（`reason: 'full'`） | 判黑负 |
| D13 | 已有游客数据的归属 | **已定（2026-10-30）**：允许认领并入会员；认领条件、段位合并及重复认领的处理在阶段 6 设计中明确。新版本未登录时不再开放联机，不产生新的游客联机档案 | — |

## 4 路线图

### 4.1 版本与阶段

2026-10-16 针对 3.0 升级决定按游戏尚无玩家看待，不保留该次升级前的旧数据与旧客户端兼容；此决定不适用于后续账号升级，现有游客数据须支持认领（D13）（[架构决策记录 0009](../adr/0009-no-legacy-compat.md)）：阶段 5 与阶段 4 的客户端切换合为 3.0.0 发布，原定的 3.0（账号与协议第 4 版）顺延为 4.0。

| 顺序 | 版本 | 阶段 | 内容 | 状态 |
|---|---|---|---|---|
| 1 | 2.0.x | — | 规范整改 P0、P1 项 | 已完成；其余整改见 [remediation.md](remediation.md) |
| 2 | 3.0.0 | 5 + 4（客户端部分） | 数据库、对局记录、备份、按 IP 限流、TLS 与 CSP | 已发布；阶段 5 全部验收已完成 |
| 3 | 3.1.0 | 网站改版 | 官方网站主页与独立下载页面 | 已发布 |
| 4 | 4.0 | 6 + 7 | 账号系统、全部联机模式的登录与隐私同意要求、协议第 4 版 | 服务端认证基础已合并；HTTP 入口、邮件、界面与协议第 4 版待实施；D3、D11 与游客认领细则待决定 |
| 5 | 4.0 | 8 | 反作弊与管理工具 | 未开始；按现有路线在 4.0 发布前完成 |
| 6 | 4.x | 9 | 复盘、战绩、自动更新、对局中设置等 | 按需安排 |

### 4.2 时间线

```
当前：3.1.0，阶段 4、5 已完成；阶段 6、7 的设计与服务端认证基础已完成
    → 阶段 6、7 的其余实施
    → 阶段 8
    → 4.0 验收与发布（协议不兼容，按主版本安排更新）
    → 阶段 9
```

**关键路径**：账号及数据归属决策 → 账号与协议实施 → 反作弊和管理能力 → 发布验收。具体批次见 [next-development.md](next-development.md)。已完成的阶段 5 演练不作为新一轮待办；账号迁移后的回滚方案须单独验证。

## 5 阶段 5：数据库、对局记录与服务端加固（已完成）

3.0.0 已发布并上线；2026-10-29 验收第 1 至 7 项全部满足，见 [phase5.md](phase5.md) 第 5 章，以及 [恢复演练](../audits/2026-10-29-restore-drill.md) 与 [运维演练](../audits/2026-10-29-ops-drill.md)。以下保留设计与实施说明，不表示仍待开发。

### 5.1 选型

- `node:sqlite`，同步接口 `DatabaseSync`，适合单进程服务端；选型的背景与实测见 [架构决策记录 0008](../adr/0008-node-sqlite.md)（服务器为 Node.js v24.21.0、SQLite 3.53.4）。
- 打开后立即执行 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;`，并校验 `PRAGMA integrity_check` 的结果为 `ok`，否则拒绝启动（DAT-002）。
- 文件位置：环境变量 `YI_DB`，默认为工作目录下的 `yi.db`（服务器上为 `/var/lib/yi/yi.db`）。
- 服务端仍打包成单文件 `server.cjs`，`scripts/build-node.mjs` 的构建目标升到 `node22`，与 `package.json` 的 `engines` 一致。

### 5.2 表结构

5.2.1 本节按 [03-data.md](../standards/03-data.md) 修订（整改项 P2-01，2026-10-16），取代第 3 版中的草案。按阶段 5 开发计划的决定 D5-3，阶段 5 的迁移 `0001_init.sql` 只建本阶段写入的 6 张表（5.2.2）；其余各表的结构见 5.2.4，由对应阶段的迁移新增，实施时以届时的决定（D2 至 D5）为准，并须再次按 03-data.md 审查。

5.2.2 阶段 5 的 DDL（`server/db/migrations/0001_init.sql`）：

```sql
-- 元数据：结构版本 schema_version 等（DAT-041）
CREATE TABLE meta (
  id         INTEGER PRIMARY KEY,
  meta_name  TEXT NOT NULL CHECK (length(meta_name) BETWEEN 1 AND 64),
  meta_text  TEXT NOT NULL CHECK (length(meta_text) <= 2000)
) STRICT;
CREATE UNIQUE INDEX uq_meta_meta_name ON meta (meta_name);

-- 用户：阶段 5 只有游客，一个 uid_hash 对应一个游客用户；会员的列由阶段 6 的迁移新增
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('guest', 'member')),
  name          TEXT NOT NULL CHECK (length(CAST(name AS BLOB)) BETWEEN 1 AND 64),   -- 最近一次使用的昵称，按 UTF-8 字节计（DAT-022）
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
) STRICT;

-- 设备：客户端本地 uid 的散列 sha256('yi:' + uid) 的前 32 位（DAT-075），用于关联游客与（阶段 6 起）会员
CREATE TABLE devices (
  id             INTEGER PRIMARY KEY,
  uid_hash       TEXT NOT NULL CHECK (length(uid_hash) = 32 AND uid_hash NOT GLOB '*[^0-9a-f]*'),
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX uq_devices_uid_hash_user_id ON devices (uid_hash, user_id);
CREATE INDEX idx_devices_user_id ON devices (user_id);

-- 段位：每人每种棋一行
CREATE TABLE ratings (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  game_type   TEXT NOT NULL CHECK (game_type IN ('gomoku', 'go')),
  points      INTEGER NOT NULL DEFAULT 1200 CHECK (points >= 0),
  win_count   INTEGER NOT NULL DEFAULT 0 CHECK (win_count >= 0),
  loss_count  INTEGER NOT NULL DEFAULT 0 CHECK (loss_count >= 0),
  draw_count  INTEGER NOT NULL DEFAULT 0 CHECK (draw_count >= 0),
  updated_at  INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX uq_ratings_user_id_game_type ON ratings (user_id, game_type);

-- 对局：开局时插入，终局时在结算事务中更新（DAT-040）
CREATE TABLE games (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('match', 'ranked', 'friend')),
  game_type      TEXT NOT NULL CHECK (game_type IN ('gomoku', 'go')),
  board_size     INTEGER NOT NULL CHECK (board_size IN (9, 13, 15, 19)),
  black_user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  white_user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  record         TEXT CHECK (record IS NULL OR (json_valid(record) AND length(record) <= 262144)),  -- 棋谱，见 5.2.3；NULL 表示尚未终局
  move_count     INTEGER NOT NULL DEFAULT 0 CHECK (move_count BETWEEN 0 AND 1024),
  winner         TEXT CHECK (winner IN ('black', 'white', 'draw')),                                 -- NULL 表示尚未终局
  end_reason     TEXT CHECK (end_reason IN ('five', 'full', 'score', 'resign', 'timeout', 'disconnect', 'draw', 'left', 'limit', 'aborted')),  -- NULL 表示尚未终局
  is_rated       INTEGER NOT NULL DEFAULT 0 CHECK (is_rated IN (0, 1)),                             -- 本局是否结算了段位
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,                                                                           -- NULL 表示尚未终局
  CHECK ((ended_at IS NULL) = (end_reason IS NULL) AND (ended_at IS NULL) = (winner IS NULL)),
  CHECK (is_rated = 0 OR kind = 'ranked')
) STRICT;
CREATE INDEX idx_games_black_user_id_ended_at ON games (black_user_id, ended_at);
CREATE INDEX idx_games_white_user_id_ended_at ON games (white_user_id, ended_at);
CREATE INDEX idx_games_ended_at ON games (ended_at);

-- 段位变化明细：每一次段位分的变化一行，可以精确回滚
CREATE TABLE rating_changes (
  id             INTEGER PRIMARY KEY,
  game_id        INTEGER REFERENCES games (id) ON DELETE RESTRICT,   -- NULL 表示不是由对局引起（回滚、管理操作）
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  game_type      TEXT NOT NULL CHECK (game_type IN ('gomoku', 'go')),
  points_before  INTEGER NOT NULL CHECK (points_before >= 0),
  points_after   INTEGER NOT NULL CHECK (points_after >= 0),
  cause          TEXT NOT NULL CHECK (cause IN ('game', 'rollback', 'admin')),
  changed_at     INTEGER NOT NULL,
  CHECK ((cause = 'game') = (game_id IS NOT NULL))
) STRICT;
CREATE INDEX idx_rating_changes_user_id_changed_at ON rating_changes (user_id, changed_at);
CREATE INDEX idx_rating_changes_game_id ON rating_changes (game_id);
```

说明：

1. 时间列均为 UTC 的 Unix 毫秒数（DAT-012），取自服务端注入的时钟；
2. 枚举的取值一次列全：SQLite 修改 `CHECK` 须重建整张表，因此 `users.kind` 的 `member`、`rating_changes.cause` 的 `rollback`、`admin` 虽在阶段 6、8 才写入，也在此列出；
3. `games.end_reason` 在协议第 3 版的 8 种终局原因之外，增加 `limit`（达到 API-046 的手数或动作记录上限，协议第 3 版中以 `draw` 下发）与 `aborted`（服务端异常隔离时放弃的房间，以及服务端重启时尚未终局的对局：启动时把 `ended_at` 为空的对局一律记为 `aborted`、和棋、不计段位）；
4. 和棋时 `winner` 为 `draw`；协议中的 `winner` 数值（1 黑胜、2 白胜、3 和棋）在仓储模块中换算；
5. 阶段 5 不保存 IP（决定 D5-4）：按 IP 的限流只在内存中统计；`devices.last_ip`、`games.black_ip` 与 `white_ip` 不建；
6. `meta` 为单数名，沿用 DAT-041 中的表名；键与值的列名避开保留字 `key`、`value`（DAT-014）；
7. 外键全部为 `ON DELETE RESTRICT`（DAT-030），每个外键列有以它开头的索引（DAT-031）：`games` 的两个用户外键由复合索引覆盖，`rating_changes.user_id` 由 `idx_rating_changes_user_id_changed_at` 覆盖；
8. DAT-022 的昵称上限为 64 字节（按 16 个字素 × 4 字节），而 `cleanName` 按字素截到 `NAME_MAX` 个：由多个码位组成的字素（如带肤色或组合的表情符号）可使 16 个字素超过 64 字节。按阶段 5 开发计划的决定 D5-5，仓储模块写入前再按字素截短到 64 字节以内，不得因约束失败而丢弃整条写入；DAT-022 不变。

5.2.3 棋谱（`games.record`）：内容为 `{ "v": 1, "cfg": …, "moves": [{ "m": …, "ms": … }], "dead": …, "result": … }`，即 `src/core/record.ts` 的 `GameRecord` 加上版本字段 `v`（DAT-024，VER-012：棋谱 JSON 单独编号，读取到高于自身支持的版本时只读不写）。约定如下：

- `moves` 只保存终局时的着法序列：被悔棋撤销的着法不保存；`ms` 为这一手的用时（毫秒），从轮到该方起至收到落子或停一手为止，以服务端时钟计；
- 单值上限 256 KB；按 API-046 每局至多 1024 手，实际大小在阶段 5 第 6 步实测并记入 PR；
- 由 `replay()` 可从头回放到终局局面，测试以此核对。

5.2.4 后续阶段新增的表与列（结构示意；实施时按 03-data.md 写出完整 DDL）：

| 阶段 | 表或列 | 结构要点 | 数据等级 |
|---|---|---|---|
| 6 | `accounts` 等（设计草案） | 账号与 `users` 一一对应；公开 UID、邮箱密文及查找标识、验证状态、口令散列和认证世代等见 [阶段 6、7 设计](phase6-7.md)；雅号允许重名，不添加会员昵称唯一索引 | 邮箱及查找标识 L3；口令散列 L4 |
| 6 | `sessions` | `token_hash`（SHA-256，唯一）、`user_id`、`created_at`、`expires_at`、`last_seen_at` | 令牌散列 L4 |
| 6 | `email_challenges`、`consents` 等（设计草案） | 挑战用途、单次消费、尝试次数、到期与发送状态，以及协议类型、版本和同意时刻；完整 DDL 随待定事项收敛后编写 | 邮箱 L3；验证码凭据 L4；同意记录 L2 |
| 8 | `game_flags` | `game_id`、`flag`（`short`、`farming-suspect`、`timing-suspect`、`engine-suspect`）、`created_at`；唯一索引 `uq_game_flags_game_id_flag`；取代草案中逗号分隔的 `games.flags`（DAT-025） | L2 |
| 8 | `reports` | `reporter_user_id`、`target_user_id`、`game_id`、`reason`、`note`（`length ≤ 2000`）、`status`、`created_at`、`resolved_at`；`uq_reports_reporter_user_id_game_id`（同一局只能举报一次，DAT-034） | L2 |
| 8 | `sanctions` | `user_id`、`kind`、`reason_text`、`until_at`（NULL 表示永久）、`admin_name`、`created_at` | L2 |
| 8 | `admin_actions` | 取代草案中的 `audit`：`admin_name`、`operation`、`detail_json`（`json_valid`）、`created_at` | L2；严禁含 L4（DAT-073） |
| 8 | IP | 如需识别同一来源，按 DAT-071 截断或存 HMAC，并按 DAT-076 更新隐私说明 | L3 |

5.2.5 阶段 5 各列的数据等级（03-data.md 第 6.1 条）：

| 等级 | 列 |
|---|---|
| L1 公开 | `users.name`；`ratings` 的段位分与胜负局数；`games` 的种类、棋类、路数、胜方、终局原因 |
| L2 内部 | `devices.uid_hash`；`games.record`；各表的时间列与编号；`rating_changes` 全部列；`meta` |
| L3、L4 | 阶段 5 不收集 |

### 5.3 服务端代码结构

`server/rooms.ts` 已由整改项 P2-12 按职责拆分（`hub`、`matchmaking`、`room`、`play`、`lobby`、`rating`、`faults` 等，经 `ServerContext` 共用状态）。阶段 5 新增与改动：

```
server/
  main.ts               改：读配置对象、打开数据库、启动服务、优雅退出
  config.ts             新：环境变量与命令行参数集中解析与校验（P2-04，ARC-042）
  db/
    index.ts            新：打开数据库、PRAGMA 与完整性检查、执行迁移、结构版本检查
    migrations/         新：0001_init.sql、0002_…（DAT-017；随服务端打包进 server.cjs）
    repo.ts             新：全部 SQL 集中于此，预编译一次、参数绑定（DAT-044、DAT-045）
    ratingStore.ts      新：数据库中的段位与对局记录存放处，实现 RatingStore 接口
    startup.ts          新：启动时打开数据库、放弃上次未终局的对局
    backup.ts           新：node server.cjs backup，以 VACUUM INTO 生成快照（见 5.7）
  record.ts             新：对局记录与每手用时，终局时在事务内结算（DAT-040）
  store.ts              删除（3.0.0 起不再有 JSON 段位存档，架构决策记录 0009）
```

`RoomServer` 保持“与传输无关、时钟可注入”的特点：段位与对局记录经接口注入，测试使用 `:memory:` 数据库。

### 5.4 这一阶段写入数据库的内容（仍是协议 v3，还没有账号）

- 每个完成握手的 uid 找到或新建一个 `kind = 'guest'` 的用户与对应的设备行，段位从 `ratings` 表读。
- 每局开局时 `INSERT games`（双方、种类、棋类、路数），终局时在一个事务内 `UPDATE` 写入棋谱、胜方、终局原因，并结算段位。**对局记录从这一刻开始积累**，以后反作弊有据可查。
- 排位结算写 `ratings` 与 `rating_changes`，与对局记录在同一事务中（DAT-040）；**结算前从数据库重新读取段位**，不再用握手时缓存的那份（解决原问题 A8 中的覆盖问题）。
- 写入失败（约束违反、磁盘写满）时回滚事务，写 `db.write-failed` 日志（含错误编号），向双方下发 E5 提示“服务器出现问题，请稍后再试”与错误编号，本局不结算段位，对局与连接照常（10-edge-cases.md 第 4 节）；开局时写入失败的一局没有记录，终局时同样不结算。协议第 3 版沿用现有提示文字，不新增需要翻译的文字；专门的说明随协议第 4 版的错误码一并加入。
- 每手用时：轮到一方时记下服务端时钟，收到落子或停一手时写入 `MoveRec.ms`；手数没有变化（如申请被拒）时不重新计时。
- 服务端异常隔离时放弃的房间，以及上次运行时尚未终局的对局（启动时检查），记为 `aborted`、和棋、不计段位。

### 5.5 服务端加固（从阶段 8 提前）

| 项 | 做法 |
|---|---|
| 消息频率 | 每条连接按令牌桶限速，持续超出断开（已随整改项 P1-05 实施） |
| 按 IP 限流 | 加入房间的失败次数（A6）改为按真实 IP 统计，只在内存中进行；新建连接频率与同时连接数已随 P1-05 与 #115 实施 |
| 维护模式 | 已随 OPS-045 实施：`systemctl kill -s SIGUSR2 yi` 开启，上线脚本在有对局时自动进入并等待对局结束（至多 30 分钟）；阶段 5 不新增管理命令行 |

### 5.6 老数据迁移

不迁移（[架构决策记录 0009](../adr/0009-no-legacy-compat.md)）：3.0.0 从空数据库开始，服务端不再读写 `yi-ratings.json`；上线时删除服务器上的该文件及其本地备份，删除前由项目所有者下载一份副本到本机（DAT-066）。

### 5.7 备份

- 服务端新增 `node server.cjs backup`：以 `VACUUM INTO` 生成一致的快照（DAT-062），写入 `/var/lib/yi/backup/`，附 SHA-256 校验和（DAT-064）。
- `yi-backup.timer` 由每日改为每小时，使 RPO ≤ 1 小时（DAT-060）；本地保留份数按服务器磁盘的实测余量确定，且满足 DAT-061 的“每日一份、保留 7 份”；异地备份（DAT-061 第二层、DAT-063）改为上传数据库快照。
- 执行迁移前自动备份到 `/var/lib/yi/backup/pre-migrate-版本号-时间.db`（DAT-042）。
- 上线后按 DAT-065 演练一次恢复；README 与 [ops.md](../procedures/ops.md) 的备份与恢复章节随之修改。

**验收**：见 [phase5.md](phase5.md) 第 5 章。

### 5.8 并入本阶段的事项

- 按 IP 限制加入房间的失败次数（原问题 A6），与 API-044 一并实施。
- 升级步骤见 [phase5.md](phase5.md) 第 4.11.2 条：3.0.0 从空数据库开始，不导入旧段位存档（架构决策记录 0009）。
- 每日维护任务（清理过期会话与验证码、截断到期的 IP、解除到期的处罚，DAT-074）随阶段 6、8 引入相应数据时实施；阶段 5 不收集 L3 数据，无须截断。

## 6 阶段 4：域名与 TLS（已完成）

服务器部分于 2026-10-13 完成，客户端切换与关闭公网 8443 于 2026-10-24 随 3.0.0 完成。现有联机经 `wss://yi.lightking.com.cn/ws`，HTTPS 请求由 Caddy 转发到本机 8443；下表记录已实施的配置。

| 改动 | 说明 |
|---|---|
| 域名 | `yi.lightking.com.cn`，A 记录指向服务器 |
| Caddy | 安装 Caddy，自动申请并续期证书：`yi.lightking.com.cn { reverse_proxy 127.0.0.1:8443 }`。**已实施**（2026-10-13，Caddy v2.11.7）：站点配置为 `scripts/server/yi.caddy`，以 `npm run deploy -- install-caddy` 安装；安全组与 UFW 已放行 80、443；Caddy 与主配置由 LightsWeb 仓库管理（2026-10-13 项目所有者决定），以便同一台服务器承载多个网站 |
| 服务端只监听本机 | `yi.service` 设 `HOST=127.0.0.1`（6c 已改，2026-10-24 随 3.0.0 以 `install-service` 安装）；安全组与 UFW 关闭 8443，只开放 80、443（2026-10-24 已关闭）。按架构决策记录 0009 不再为 2.x 客户端保留对外端口 |
| 客户端地址 | `src/online/config.ts` 的生产地址为 `wss://yi.lightking.com.cn/ws`，构建时可由 `VITE_YI_SERVER` 指定（2026-10-24 随 3.0.0 发布） |
| CSP | `index.html` 的 `connect-src` 为 `'self' wss://yi.lightking.com.cn`；开发时由 Vite 插件另加本机地址（6c 已改，`scripts/dev-csp.mjs`） |
| 真实 IP | 服务端取客户端 IP 时读 `X-Forwarded-For`（只信任来自 127.0.0.1 的这个头），限流和反作弊要用。**已实施**（#115，`server/clientIp.ts`）：取该头的最后一项；带这个头的请求不算本机请求，`/healthz`、`/metrics` 不回应 |

**验收**：`curl -I https://yi.lightking.com.cn` 证书有效；桌面版用新地址可以联机；`ss -lnt` 看到 8443 只监听 127.0.0.1。

## 7 阶段 6：账号系统（设计准备）

D2、D4、D13、雅号允许重名与存储方向已决定；邮件服务与认领细节等仍待收敛，UID 与邮箱保留见决策 0011。以下为待细化的接口与流程草案，不代表已有功能。实施前须完成 [next-development.md](next-development.md) 第 3、4 章的决策和规范对齐。

### 7.1 HTTP 接口

账号接口与错误格式以 [阶段 6、7 设计](phase6-7.md) 第 5 章为准：邮箱＋密码登录，注册含雅号、邮箱、密码、验证码及协议版本；忘记密码只允许重置。错误采用 `application/problem+json`，不再沿用旧 `{ error }` 草案。公开资料、战绩、排行榜与举报接口分别随相应功能定稿。

### 7.2 安全细节

[账号存储决策 0010](../adr/0010-account-storage.md) 已确定密码采用 DAT-070 的加盐 scrypt，邮箱分为受控密文与带密钥查找标识，公开雅号保留可显示文本。参数、字段、密钥与资源边界见 [阶段 6、7 设计](phase6-7.md) 第 3 章。

会话最长 30 日、闲置 7 日失效；修改或重置密码撤销全部会话。登录失败与 IP 限流按 SEC-023。浏览器调试只保存内存会话，不退回 `localStorage`。验证码防滥用、发送状态见该设计第 4 章；邮箱保留和验证码保护已同步规范，邮件商仍待收敛，不把旧 SMTP 草案当作已批准的实现。

### 7.3 联机时的身份

- WebSocket 握手的 `hello` 带上会话令牌（见第 8 章）。服务端验证后，这条连接就是这个会员。未登录、邮箱未验证或未完成所需隐私同意时拒绝进入联机，不再按游客创建联机档案（D4）。
- **同一账号只允许一个联机会话**（A8 的最终解决）：在另一处登录联机时，旧连接收到 `kicked { reason: 'elsewhere' }`；如果旧连接正在对局，对局转到新连接（与断线重连相同）。
- 每次 `hello` 都从数据库重新读取用户状态，封禁立即生效。

### 7.4 已有游客数据的认领

按 D13，允许会员认领升级前已有的游客段位和棋谱。认领条件、身份依据、会员已有段位时的合并规则、重复认领和并发认领的处理须在实施计划中明确；不能仅因登录时携带设备标识就自动转移记录。

当前 `rating_changes.cause` 不含 `import`，对局外键为 `black_user_id`、`white_user_id`；旧草案的导入原因与字段名不能直接用于迁移。认领涉及的归属变更及审计记录必须在同一事务中完成（DAT-040）。D4 生效后，新版本未登录时不再产生游客联机档案。

### 7.5 客户端界面

| 位置 | 改动 |
|---|---|
| 多人游戏入口 | 未登录时引导登录；未完成相关隐私同意时引导确认。完成邮箱验证及相关同意后才可进入匹配、排位与好友房间；单机双人和人机对弈不受影响 |
| 新面板 `AccountPanel` | 登录、注册（邮箱 → 收验证码 → 设密码和昵称 → 勾选同意隐私说明）、找回密码、改密码、改昵称、退出登录、注销账号 |
| 匹配、排位与好友房间 | 全部经登录、邮箱验证与隐私同意检查；服务端同时校验，不能只在界面上隐藏入口 |
| 设置 | 联机昵称改由账号面板管理；未登录时不修改会员资料 |
| 更多 | 新增《隐私说明》页；“联机”页改掉“段位跟着这台设备”的说法（C21） |
| 新文件 | `src/online/api.ts`（HTTP 接口封装）、`src/online/auth.ts`（令牌保存、当前用户 signal）、`src/ui/account.tsx` |

**验收**：注册、登录、登出、找回密码、改昵称全流程可用；未登录时仅可单机双人和人机对弈，全部联机模式须登录并同意相关隐私协议；两台设备登录同一账号时旧的被踢下线；限流和锁定生效（有测试）。

### 7.6 并入本阶段的事项

- 单账号单会话：同一账号在别处登录时，以关闭码 4002 断开旧连接（原问题 A8）。
- “联机”页中“段位与本机绑定”的说明，改为“段位与账号绑定”（原问题 C21 第三项）。
- 邮件：服务商与发送方式尚未确定；实施前核实服务、域名验证与限额，真实投递单独验收。
- 隐私：注册时必须勾选同意《隐私说明》；“更多”中提供《隐私说明》，写明收集的个人信息（邮箱、口令散列、IP、设备散列）、用途（登录、反作弊）与保留期限（DAT-074）。
- 注销账号：清空邮箱与口令，昵称改为“已注销用户”，对局记录匿名保留。

## 8 阶段 7：联机协议 v4（与阶段 6 同时发布）

以下为草案。`seq`、快照、散列与认证失败的确切语义须按 [next-development.md](next-development.md) 第 4 章细化后才可实施；不得把未定稿字段当作已接受的协议契约。

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
| `error`、`info`、`joinNo`、`unmatched` | 文字改为 `code` 加可选参数，如 `{ t: 'error', code: 'ranked-login-required' }`，客户端翻译。服务端内部错误（E5）的 `error` 保留 v3 已有的 `errorId`（P2-15 加入，API-023） |
| `outdated` | 新：客户端版本过旧，带 `{ min, latest, url }`，客户端显示“请更新到 x.y.z”并给出下载链接 |
| `kicked` | 新：`{ reason: 'elsewhere' \| 'banned' \| 'server' }` |
| `restricted` | 新：`{ what: 'ranked', until }`，告诉客户端暂时不能排位及原因 |
| `maintenance` | 新：`{ at }`，服务器即将维护 |

### 8.2 一致性校验

- 服务端每次确认一手，下发 `seq` 和 `hash`。客户端用本地的 `Match` 照做后计算散列；**不一致就发 `resync`**，收到 `sync` 后用 `Match.fromRecord()` 静默重建。
- 客户端落子前本地先用 `Rules.apply` 预检，不合法的直接提示，不发给服务端（服务端照样校验）；发出落子后到收到确认前不再接受第二次点击。

### 8.3 兼容与发布

- 服务端只接受 v4。v3 客户端连上来时回一条 v3 格式的 `error`（“客户端版本与服务器不一致，请更新游戏”）；2.0.1 以后的客户端还会因 `welcome.latest` 提前看到“有新版本”的提示。
- 发布目标为 4.0，按现有路线在阶段 6、7、8 验收后发布配套客户端与服务端。下载产物可用后再下发更新提示；停服、协议切换、数据库迁移及回滚顺序须在发布前验证，不向玩家推荐尚不可下载的版本。

### 8.4 测试

服务端拆分后的 `tests/server*.test.ts` 及客户端联机测试按 v4 更新；新增：`seq` 乱序与重复提交被拒；人为制造散列不一致后 `resync` 能恢复；带登录令牌的 `hello`；同一账号两处登录；过旧客户端收到 `outdated`。

## 9 阶段 8：反作弊与管理工具（待实施）

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

## 10 阶段 9：新功能与体验（4.x，按需逐个交付）

| 功能 | 说明 |
|---|---|
| 战绩页 | 多人游戏页新增“战绩”：最近对局、胜负、段位变化曲线 |
| 复盘 | 新界面 `Screen.Replay`：前进、后退、跳到第 N 手、自动播放；联机棋谱从 `/api/games/:id` 取，单机棋谱从本地取 |
| 排行榜 | 五子棋、围棋各一张，前 100 |
| 对局中打开设置（B12） | 对局面板加“设置”入口，以浮层打开，不离开对局 |
| 残局存档 | 单机和人机对局退出时自动保存，回来可继续（只存 `GameRecord`） |
| 自动更新 | `electron-updater`，更新包放在 Release 或自己的服务器上。Windows、Linux 直接可用；**macOS 自动更新要求正式签名**（Apple 开发者账号），没有签名时保持 2.0.1 的“提示并打开下载地址” |
| 静止时降帧（B16） | 没有动画、光影关闭、鼠标不动时停止重绘，有变化再恢复 |
| 界面刷新自动化 | 用 signals 替换 `uiKey` / `bump()`；完整的界面路由状态机（原阶段 3 的剩余部分） |
| SGF 导入导出 | 复盘界面里导出；单机可以导入 SGF 摆出局面继续下 |
| 读秒 | `Clock` 抽象：每步限时（现有）、包干、包干 + 读秒；好友房可选 |
| 观战 | 好友房可以带观战者；协议加 `watch` / `unwatch`，观战者两个座位都是只读的 RemoteSeat |
| 形势判断 / 提示 | 单机时用现有 AI 给出建议点或胜率估计 |

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
  db/{index.ts, migrations/, repo.ts, ratingStore.ts, startup.ts, backup.ts}
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
| `tests/db.test.ts` | 迁移、完整性检查、结构版本检查、迁移失败时回滚 | 5 |
| `tests/auth.test.ts` | 注册、登录、验证码、限流、锁定、令牌过期、游客并入 | 6 |
| `tests/anticheat.test.ts` | 9.1 的每条规则 | 8 |
| `tests/e2e.test.ts` | 真起一个 http + ws 服务端，两个 ws 客户端下完一局排位 | 7 |

## 13 风险与对策

| 风险 | 对策 |
|---|---|
| 重构引入回归 | 每步测试全过；场景脚本截图对比特效；三种模式手动走查 |
| 强制更新时玩家连不上 | 4.0 发布前验证旧客户端更新指引、配套安装程序与服务端的切换；兼容规则见 VER-010 |
| 服务端升级打断对局 | 维护模式：等对局结束再重启 |
| 数据库文件损坏或误删 | 按 DAT-050 至 DAT-066 执行：WAL 模式、启动时完整性检查、本地与异地加密备份、季度恢复演练 |
| 邮件发不出或进垃圾箱 | 走 465 端口；正规邮件推送服务；配好 SPF / DKIM；验证码页面提示“查看垃圾邮件” |
| 反作弊误伤 | 自动规则只做“暂停排位”和“标记”，封号必须人工确认；所有处罚可撤销、有记录 |
| 使用范围变化（D7） | 备案与域名接入已完成；扩大公开运营范围前单独评估所需条件，不将本路线图视为已完成该评估 |
| macOS 未签名 | 分发说明写清首次打开方法；自动更新在 macOS 上退化为“提示并打开下载地址” |

## 14 工作量与安排

旧版中的天数为早期估算，不作为当前排期。阶段 4、5 已完成，不再计入剩余工作；阶段 6、7 的设计、实现和验证按批次记录实际耗时，再安排后续工作。阶段 8 另行细化，阶段 9 按需逐项交付。

规范整改项的 P0、P1 已完成；P2 按 [remediation.md](remediation.md) 的范围与期限继续推进。不得因账号开发而把既有整改期限一并顺延。
