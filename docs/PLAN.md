# 弈 · 改造草案（v2.0 → v3.0）

> 状态：草案，待确认。本文件列出这次要改的全部内容：架构重构、部署、数据库、账号系统、联机协议 v4、反作弊与管理工具、客户端新功能。
> 每一阶段都能单独交付、单独验收；任何一步做完，游戏都应当照常可玩。

---

## 0. 目标与原则

**目标**

1. 规则层做成纯函数、确定性，客户端与服务端共用同一份，便于测试、回放、存档。
2. 单机双人、人机、联机、观战统一成“一场对局 + 两个座位”，去掉散落的 `if (online.inGame())`。
3. 玩家数据（账号、段位、战绩、每一局棋谱）存在服务器数据库里，能查、能复盘、能回滚。
4. 排位赛需要登录；有一套可执行的反作弊规则和管理工具。

**原则**

- **逐步替换，不推倒重写**：每一阶段结束，现有测试全部通过，游戏行为不变（除非该阶段就是要改行为）。
- **只做一次协议破坏性升级**：账号、序号校验、对局记录同步全部并进协议 v4，一次发版，只强制玩家更新一次。
- **服务端继续是单文件、免 `npm install`**：数据库用 Node 内置的 `node:sqlite`。
- 新增的界面文字都要在 `src/i18n/table.ts` 补齐文言、中文、English 三种。

**版本规划**

| 版本 | 内容 | 协议 |
|---|---|---|
| 2.1.0 | 阶段 0 至 3：架构重构，玩家看不出变化 | v3（不变） |
| 2.2.0 | 阶段 4、5：wss 与域名、数据库、对局记录（服务端升级，客户端只改服务器地址） | v3 |
| 3.0.0 | 阶段 6 至 8：账号、协议 v4、反作弊、战绩与复盘 | **v4** |
| 3.x | 阶段 9：残局存档、SGF、观战、读秒等 | v4 扩展 |

---

## 1. 需要你拍板的事项

没定之前，本草案先按“默认方案”写。

| # | 事项 | 默认方案 | 备选 |
|---|---|---|---|
| D1 | 服务器域名 | 买一个域名，例如 `yi.example.com`，解析到现在的服务器 | 继续用 IP（不能配正规证书，**不能上登录**） |
| D2 | 登录方式 | 邮箱 + 密码，邮箱验证码 | 手机短信（要费用和短信资质）；微信 / QQ 登录（要申请开放平台） |
| D3 | 发邮件 | 阿里云邮件推送（DirectMail）的 SMTP | QQ 邮箱 / 163 的 SMTP（每天有发信上限） |
| D4 | 游客能玩什么 | 匹配和好友房可以不登录；排位必须登录并验证邮箱 | 全部必须登录 |
| D5 | 昵称是否唯一 | 会员昵称全服唯一；游客昵称不限，显示时带“游客”标记 | 都不唯一 |
| D6 | 服务器与端口 | **已定**：继续用现在的大陆服务器，`lightking.com.cn` 已提交 ICP 备案（2026-10-01）。服务端端口统一为 **8443**（原 7700 不再使用）；备案通过后对外走标准 443，由 Caddy 转到本机 8443 | 备案被驳回时换香港服务器 |
| D7 | 公开运营范围 | 自己与朋友圈小范围 | 面向大陆公众运营时，还要评估网络游戏实名认证与防沉迷要求 |
| D8 | 发行平台 | **已定：只做桌面版**（macOS / Windows / Linux），不再部署网页版 | — |

---

## 2. 阶段 0 · 工程基础（约 0.5 天）

| 改动 | 说明 |
|---|---|
| `git init` | 目前**不是 git 仓库**，这是最大的风险。`.gitignore` 已有，补上 `*.db`、`*.db-wal`、`*.db-shm`、`yi-ratings.json`、`.env`。第一次提交即当前 2.0.0 的状态，打 tag `v2.0.0`。 |
| 远程仓库 | 推到 GitHub 或 Gitee 私有仓库。 |
| CI | GitHub Actions（或 Gitee Go）：`npm ci && npm run typecheck && npm test`。 |
| 服务器地址改为构建期配置 | `src/shared/protocol.ts` 的 `ONLINE_SERVER` 改为读 `import.meta.env.VITE_YI_SERVER`，默认值保留现在的地址；新增 `.env.production`。服务端代码不引用这个常量，避免 esbuild 打包出问题。 |
| 统一 Node 版本 | `package.json` 加 `"engines": { "node": ">=22.13" }`，新增 `.nvmrc`；`scripts/build-node.mjs` 的 `target` 改为 `node22`（为阶段 5 的 `node:sqlite` 做准备）。 |

**验收**：CI 通过；`npm run dev`、`npm run app:dev`、`npm run server` 都照常工作。

---

## 3. 阶段 1 · 规则层纯化（约 3 天，最重要）

### 3.1 问题

`src/core/game.ts` 的 `Game` 同时装着规则状态和画面状态，而且在规则里调用 `now()`、`Math.random()`。服务端也 `new Game()`，并从 `g.msg.key`（中文文案）里读非法落子的原因。

### 3.2 新的 core 结构

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

### 3.3 类型

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
  line?: { x: number; y: number }[];   // 五子连珠的那几颗
  result?: Result;                      // 这一手结束了对局（连五、满盘）
  scoring?: boolean;                    // 双方连续停着，进入点目
}
export interface Rules {
  init(cfg: GameConfig): Pos;
  apply(pos: Pos, m: Move, history: ReadonlyArray<Pos>): { ok: true; v: Applied } | { ok: false; why: Reject };
  forbidden?(pos: Pos, x: number, y: number): Reject | null;   // 五子棋禁手预判（悬停提示用）
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
- 规则层**不含**任何时间、随机数、文字。错误原因改为 `Reject` 码，在 `src/i18n` 里新增 `rejectText(why)` 映射到现有中文原文（如 `'ko' → '劫争：此处暂不可提，请先在别处落子'`），界面照旧显示。
- 悔棋就是 `moves.pop()`，局面由缓存的 `history` 取。`HISTMAX = 1024` 的上限去掉：19 路围棋一局几百手，每个局面 361 字节，完全放得下。
- “人机时悔两手”的逻辑从规则层挪到会话层（阶段 2）。
- 棋子的纹理种子 `seed` 由画面层用 `hash(x, y, 手数)` 算出，不再存在规则里。

### 3.4 过渡：`Game` 变成外观类

阶段 1 先不动调用方。`Game` 内部改为持有 `GameRecord + Rules + history`，对外保留原有字段和方法（`play`、`pass`、`undo`、`toggleDead`、`confirmScore` 等），把画面字段转给新的 `BoardView`（见 3.5）。这样 `app/`、`fx/`、`online/`、`server/` 在这一步都不用改，测试也不用改。

### 3.5 画面状态搬到 `BoardView`

新建 `src/presentation/boardView.ts`，把以下字段从 `Game` 移过去：

| 字段 | 用途 | 现在谁在读 |
|---|---|---|
| `placeT`、`appearT`、`seed` | 落子下落、淡入、棋子纹理 | render/board、fx/rewind |
| `fades` | 提子淡出 | render/board |
| `rw` | 悔棋时的倒放 | fx/rewind |
| `switch`、`SWITCH_T` | 切换棋盘的过渡 | fx/rewind、render/board |
| `win`、`winT`、`winBurst`、`forfeit` | 五子连珠的胜利动画 | fx/fx、fx/gomokuWin、fx/blow |
| `review`、`blowView`、`undoPending` | 炸飞、查看棋局 | fx/blow、app/stage |
| `goEndT`、`goBurst` | 围棋终局揭晓 | fx/goEnd |
| `animK` | 动画速度倍率 | 多处 |
| `msg`、`msgAt` | 屏幕上方的提示 | ui/panels |
| `aiAt` | 电脑落子前的停顿 | app/controller（阶段 2 移到 AISeat） |

`BoardView` 提供 `onApplied(applied, t)`、`onUndo(prev, cur, t)`、`onReset(cfg, t)`、`onEnd(result, t)`，由 `Game` 外观类在对应操作后调用。服务端不创建 `BoardView`。

### 3.6 服务端同步修改

`server/rooms.ts` 的 `move` 分支不再读 `g.msg`，改为拿 `apply()` 返回的 `Reject` 码，发给客户端的 `info` 文字由 `rejectText()` 生成（v3 协议仍然发中文原文，保证老客户端兼容）。

### 3.7 测试

- `tests/rules.test.ts`：现有用例全部保留（通过外观类跑）。新增针对 `Rules.apply` 的用例：每种 `Reject`；`apply` 不修改传入的局面；同一份 `GameRecord` 回放两次结果逐字节相同。
- 新增 `tests/record.test.ts`：回放、悔棋、点目死子。

**验收**：`npm test` 全部通过；`grep -rn "now()\|Math.random" src/core/rules src/core/record.ts` 为空；服务端不再引用 `g.msg`。

---

## 4. 阶段 2 · 对局会话 Match 与座位 Seat（约 3 天）

### 4.1 新结构

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
}

export interface Seat {
  readonly kind: 'local' | 'ai' | 'remote';
  attach(match: Match, color: Color): void;
  onTurn(): void;              // 轮到这个座位
  wantsInput(): boolean;       // 棋盘点击是否交给这个座位
  dispose(): void;
}
```

三种模式都是两个座位的组合：

| 模式 | 黑 | 白 |
|---|---|---|
| 单机双人 | LocalSeat | LocalSeat |
| 人机 | LocalSeat / AISeat | AISeat / LocalSeat |
| 联机 | RemoteSeat（自己，点击后发给服务端） | RemoteSeat（对方） |
| 以后：观战 | RemoteSeat（只读） | RemoteSeat（只读） |
| 以后：AI 演示 | AISeat | AISeat |

悔棋步数由 `policy.ts` 决定：人机时退到玩家的回合；单机退一手；联机由服务端下发 `n`。

### 4.2 调用方修改

| 文件 | 改动 |
|---|---|
| `src/app/controller.ts` | `boardClick`、`boardHover` 只问“当前该谁落子、他 `wantsInput()` 吗”，然后调用 `seat.click(x, y)`；删掉所有 `online.inGame()` 分支。“电脑”那一段整体搬到 `aiSeat.ts`。快捷键表按“当前模式允许哪些操作”生成，不再写两套。 |
| `src/app/state.ts` | `game` 单例换成 `session`：`{ match: Match; view: BoardView }`，新局时整体替换。 |
| `src/online/client.ts` | `onStart` 创建 `Match` 和两个 `RemoteSeat`；`moved`、`undone`、`marked` 等直接调用 `match.apply()` 等方法；`replay()` 改为 `Match.fromRecord()` 并让 `BoardView` 静默（不播动画），替代现在的 `eventMark / eventRewind`。 |
| `server/rooms.ts` | `Room.g: Game` 换成 `Room.match: Match`（服务端的 Match 不挂 Seat），`acts: Act[]` 换成 `record: GameRecord`。v3 协议的 `sync` 仍需要 `Act[]`，由 `record` 转换生成。 |
| `src/core/game.ts` | 删除。 |

### 4.3 测试

新增 `tests/match.test.ts`：三种座位组合下的落子、悔棋、点目、终局事件顺序；AISeat 用同步的假 Worker。

**验收**：三种模式手动走查一遍（落子、提子、禁手、悔棋、炸飞后悔棋、点目、认输、断线重连）；测试全部通过；`src/core/game.ts` 已删除。

---

## 5. 阶段 3 · 状态管理与界面路由（约 2 天）

| 改动 | 说明 |
|---|---|
| Store | 新建 `src/app/store.ts`：`matchSig`、`viewSig`、`netSig`、`settings` 这些 signals。`Match` 的事件里更新 `matchSig`，UI 直接读，删掉 `app.ts` 里的 `uiKey()` 字符串比较和 `bump()` / `uiTick`。每帧变化的动画值仍放在普通对象里，不走 signals。 |
| 路由 | 新建 `src/app/router.ts`：`Screen` 状态机和 `go(screen)`，只负责切换和进出钩子。`goScreen` 里“离开对局时棋子飞回棋罐”等逻辑改成钩子注册。 |
| 解开循环依赖 | `online/client.ts` 不再 import `app/controller`（现在用了 `bump`、`goScreen`），改为调用 `router.go()` 并更新 `netSig`。`app/app.ts` 不再 import `online`，改为 `main.tsx` 里把 `online.update` 注册到帧循环。 |
| fx / render 只读 BoardView | `src/fx/*`、`src/render/board.ts`、`src/scene/online.ts` 不再 import `app/state` 的 `game`，改为 `draw(p, L, now, view: BoardView, match: MatchSnapshot)` 的参数传入。 |
| 依赖方向检查 | 加一条测试或 lint：`core` 不得 import 其他层；`session` 只能 import `core`；`fx/render` 不得 import `app`、`online`。 |

**验收**：依赖方向检查通过；界面与 2.0 表现一致（逐屏截图对比）。

---

## 6. 阶段 4 · 部署：域名、TLS、反向代理（约 0.5 天，需要 D1、D6）

服务端端口已统一为 **8443**。备案期间游戏直连 `ws://IP:8443`，域名不对外提供任何服务；**备案通过后**才做本阶段：对外走标准 443，Caddy 用 HTTP 验证自动签发证书，再转到本机 8443。

| 改动 | 说明 |
|---|---|
| 域名 | `yi.lightking.com.cn`，A 记录指向服务器。 |
| Caddy | 安装 Caddy，自动申请并续期 Let's Encrypt 证书：<br>`yi.lightking.com.cn { reverse_proxy 127.0.0.1:8443 }` |
| 服务端只监听本机 | `server/main.ts` 已支持 `HOST` 环境变量（阶段 0），生产环境设为 `127.0.0.1`；安全组开放 80、443，8443 在过渡期结束后关闭。 |
| 客户端地址 | `.env.production`：`VITE_YI_SERVER=wss://yi.lightking.com.cn/ws`，HTTP 接口为 `https://yi.lightking.com.cn/api`。 |
| CSP | `index.html` 的 `connect-src` 现在是 `'self' ws: wss:`，改为只允许 `wss://yi.lightking.com.cn https://yi.lightking.com.cn`；开发时由 Vite 注入本机地址。 |
| 网页版 | 不再部署：README 删去网页版部署说明，`build:web` 只作为桌面版的构建步骤保留。 |
| 真实 IP | 服务端取客户端 IP 时读 `X-Forwarded-For`（只信任来自 127.0.0.1 的这个头），反作弊和限流要用。 |
| 过渡 | 先让新老地址同时可用一段时间：Caddy 上线后，老客户端的 `ws://IP:8443` 暂时保留，等 2.2 普及后再关。 |

**验收**：`curl -I https://yi.lightking.com.cn` 证书有效；桌面版用新地址可以联机；`ss -lnt` 看到 8443 只监听 127.0.0.1。

---

## 7. 阶段 5 · 数据库与对局记录（约 3 天）

### 7.1 选型

- `node:sqlite`（Node 22.13+ 无需参数；推荐直接用 Node 24 LTS）。同步 API（`DatabaseSync`），适合单进程服务端。
- 打开时设置 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;`。
- 文件位置：环境变量 `YI_DB`，默认 `./yi.db`。
- 服务端仍打包成单文件 `server.cjs`，`node:sqlite` 是内置模块，esbuild 自动当作外部依赖。

### 7.2 表结构（完整 DDL，放在 `server/db/schema.sql`，以迁移脚本方式执行）

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
  black_ip    TEXT, white_ip TEXT,                    -- 180 天后清空（见 13.2）
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

### 7.3 服务端代码结构

`rooms.ts` 现在 581 行，拆成：

```
server/
  main.ts               入口：读环境变量、打开数据库、启动 http + ws、优雅退出
  config.ts             新：所有环境变量集中解析（PORT、HOST、YI_DB、SMTP_*、ADMIN_TOKEN、TRUST_PROXY……）
  http.ts               新：node:http 服务器，/api/* 路由（阶段 6），/ws 升级给 ws
  host.ts               改：从“自己开端口”改为挂到 http 服务器的 upgrade 上
  hub.ts                新：连接与玩家（现在的 Player、hello、重连、心跳、tick 的连接部分）
  matchmaking.ts        新：队列、配对、确认（enqueue / unqueue / dropMatch / confirm）
  room.ts               新：一个房间的对局流程（申请、点目、计时、终局），持有 Match
  rating.ts             新：Elo 计算、定级期、K 值（纯函数，便于测试）
  anticheat.ts          新：配对限制、逃跑率、自动标记（阶段 8）
  ratelimit.ts          新：令牌桶（按连接、按 IP、按接口）
  db/
    index.ts            新：打开数据库、执行迁移
    schema.sql          新：7.2 的 DDL
    migrations/         新：001_init.sql、002_...（按 meta.schema_version 顺序执行）
    repo.ts             新：所有 SQL 语句集中在这里（prepare 一次、复用）
    importLegacy.ts     新：导入 yi-ratings.json（见 7.5）
  store.ts              删除（被 db/repo.ts 取代；测试用 ':memory:' 数据库）
  admin/                阶段 8：命令行管理工具
```

`RoomServer` 保持“与传输无关、时钟可注入”的特点，方便测试。

### 7.4 这一阶段写入数据库的内容（仍是协议 v3，还没有账号）

- 每个连上来的 uid 建一个 `kind='guest'` 的用户，写入 `devices`，段位从 `ratings` 表读。
- 每局开始 `INSERT games`（只有基本信息），结束时 `UPDATE` 写入 `record`、结果、每手用时。**对局记录从这一刻开始积累**，以后反作弊有据可查。
- 排位结算写 `ratings` 和 `rating_changes`，包在一个事务里。
- 每手用时：服务端在 `startTurn` 记开始时刻，收到 `move` 时算出毫秒数写进 `MoveRec.ms`。

### 7.5 老数据迁移

`yi-ratings.json` 的结构是 `{ [uid_hash]: { name, ratings } }`。首次启动时，如果数据库为空并且找到这个文件：

1. 每一项建一个 `guest` 用户，名字沿用，`devices` 写入这个 `uid_hash`；
2. 写入 `ratings`，同时写一条 `rating_changes(cause='import')`；
3. 把原文件改名为 `yi-ratings.json.imported`，不删除。

老玩家更新后，用同一台设备连上来，分数原样保留。

### 7.6 备份

- systemd timer 每天执行一次 `node server.cjs backup`，内部用 `VACUUM INTO '/opt/yi/backup/yi-YYYYMMDD.db'` 生成一致的快照，保留最近 14 份。
- README 补一节“备份与恢复”。

**验收**：打满一局匹配和一局排位，数据库里有 `games`、`ratings`、`rating_changes` 记录；重启服务端后段位不丢；导入老 JSON 的测试通过；`tests/server.test.ts` 改用 `:memory:` 数据库后全部通过。

---

## 8. 阶段 6 · 账号系统（约 4 天，需要 D2、D3、D4、D5）

### 8.1 HTTP 接口（`/api/*`，JSON，只走 HTTPS）

| 方法 | 路径 | 入参 | 说明 |
|---|---|---|---|
| POST | `/api/code` | `email, purpose` | 发邮箱验证码（注册、找回密码） |
| POST | `/api/register` | `email, code, password, name, uid` | 注册并登录；把这台设备的游客档案并入（8.4） |
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

### 8.2 安全细节

| 项 | 做法 |
|---|---|
| 密码散列 | `crypto.scrypt`，N=2^15、r=8、p=1、16 字节盐、64 字节输出，存成 `scrypt$32768$8$1$<salt>$<hash>`；比较用 `timingSafeEqual`。 |
| 密码要求 | 至少 8 位；不能与邮箱相同。 |
| 会话令牌 | 32 字节随机数，base64url；数据库只存 sha256；有效期 90 天，每次使用后顺延。 |
| 验证码 | 6 位数字，10 分钟有效，最多试 5 次，存散列。同一邮箱 60 秒内只能发一次，每天最多 10 次。 |
| 限流 | 按 IP：登录每分钟 10 次，注册每小时 5 次，发验证码每小时 10 次。登录连续失败 10 次，该账号锁 15 分钟。 |
| 不泄露账号是否存在 | “找回密码”对不存在的邮箱也返回成功。 |
| 昵称 | 长度沿用 `NAME_MAX = 16`；过滤控制字符（已有 `cleanName`），再加一份敏感词表 `server/data/badwords.txt`。 |
| 客户端保存令牌 | 通过 preload 新增 `yiNative.secret.get/set`，用 Electron 的 `safeStorage`（macOS 钥匙串 / Windows DPAPI）加密后存在 userData；开发时在浏览器里调试则退回 `localStorage`。 |
| 邮件 | 用 Node 内置的 `net`/`tls` 写一个最小的 SMTP 客户端（约 150 行），保持免 `npm install`；也可以接受引入 `nodemailer` 并打包进单文件。配置：`SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASS、MAIL_FROM`。 |

### 8.3 联机时的身份

- WebSocket 握手的 `hello` 带上会话令牌（见 9 节）。服务端验证后，这条连接就是这个会员。没有令牌就按游客处理（`uid_hash` 找到或新建游客用户）。
- 同一会员在另一处登录联机时，旧连接收到 `kicked { reason: 'elsewhere' }`；如果旧连接正在对局，对局转到新连接（与断线重连相同）。
- 每次 `hello` 都从数据库重新读取用户状态，封禁立即生效。

### 8.4 游客并入会员

注册或第一次登录时，客户端带上本机 `uid`：

- 找到该设备的游客用户；如果会员这边还没有任何排位局，就把游客的 `ratings` 复制过来（写 `rating_changes(cause='import')`），并把游客的 `games.black_id / white_id` 改指到会员；
- 否则只关联设备，不合并分数（防止用小号养分再并入）；
- 游客用户标记 `merged_into = 会员 id`。

### 8.5 客户端界面

| 位置 | 改动 |
|---|---|
| 多人游戏页顶部 | 显示当前身份：“游客 · 棋手123 【登录 / 注册】”或“会员昵称 · 段位 【账号】”。 |
| 新面板 `AccountPanel` | 登录、注册（邮箱 → 收验证码 → 设密码和昵称）、找回密码、改密码、改昵称、退出登录、注销账号。 |
| 排位按钮 | 游客点击时提示“排位需要登录”，并打开登录面板。 |
| 设置 | “联机昵称”改为：游客时可改；会员时跳到账号面板。 |
| 新文件 | `src/online/api.ts`（HTTP 接口封装）、`src/online/auth.ts`（令牌保存、当前用户 signal）、`src/ui/account.tsx`。 |

**验收**：注册、登录、登出、找回密码、改昵称全流程可用；游客可以匹配、不能排位；两台设备登录同一账号时旧的被踢下线；限流和锁定生效（有测试）。

---

## 9. 阶段 7 · 联机协议 v4（约 3 天，与阶段 6 同时发布）

### 9.1 变更一览（`src/shared/protocol.ts`，`PROTO_VERSION = 4`）

**客户端 → 服务端**

| 消息 | 变化 |
|---|---|
| `hello` | `{ v: 4, name, uid, auth?: string, resume?: string }`：`auth` 是登录令牌，`resume` 是断线重连令牌（原来的 `token` 改名） |
| `move` | 增加 `seq`：客户端认为这是第几手（从 1 开始）。不一致就拒绝，防止重复提交和乱序 |
| `pass`、`undo`、`draw`、`resign`、`mark`、`agree`、`resume` | 同样带 `seq` |
| `resync` | 新：客户端发现局面散列不一致时请求完整同步 |
| `report` | 新：`{ gameId, reason, note? }`（也可以走 HTTP，二选一，建议 HTTP） |
| `name` | 会员不能用它改名（改名走 HTTP） |

**服务端 → 客户端**

| 消息 | 变化 |
|---|---|
| `welcome` | `{ id, resume, user: { id, name, member, status }, ratings }` |
| `start` | 增加 `gameId`，`black/white` 改为 `{ id, name, member, points?, provisional? }` |
| `moved`、`passed`、`undone`、`marked`、`resumed` | 增加 `seq`（这之后的手数）和 `hash`（Zobrist 局面散列的 16 位十六进制） |
| `sync` | 改为 `{ record: GameRecord, seq, hash, dead, agreed, ask?, turn }`，一条消息恢复整局，替代 `Act[]` 回放 |
| `over` | 增加 `gameId` |
| `rated` | 增加 `provisional`（是否仍在定级期）、`games` |
| `error`、`info`、`joinNo`、`unmatched` | 文字改为 `code` 加可选参数，如 `{ t: 'error', code: 'ranked-login-required' }`，客户端翻译 |
| `kicked` | 新：`{ reason: 'elsewhere' \| 'banned' \| 'server' }` |
| `restricted` | 新：`{ what: 'ranked', until }`，告诉客户端暂时不能排位及原因 |

### 9.2 一致性校验

- 服务端每次确认一手，下发 `seq` 和 `hash`。客户端用本地的 `Match` 照做后计算散列；**不一致就发 `resync`**，收到 `sync` 后用 `Match.fromRecord()` 静默重建。
- 客户端落子前本地先用 `Rules.apply` 预检，不合法的直接提示，不发给服务端（服务端照样校验）。

### 9.3 兼容与发布

- 服务端只接受 v4：v3 客户端连上来时回一条 v3 格式的 `error`（“客户端版本与服务器不一致，请更新游戏”），老客户端已经能正确显示这句。
- 发布顺序：服务端 3.0 与客户端 3.0 同一天发布；提前在游戏里（v2.2 的 `info` 消息）或群里通知。

### 9.4 测试

`tests/server.test.ts` 按 v4 更新；新增：`seq` 乱序与重复提交被拒；人为制造散列不一致后 `resync` 能恢复；带登录令牌的 `hello`；同一账号两处登录。

---

## 10. 阶段 8 · 反作弊与管理工具（约 4 天）

### 10.1 自动规则（`server/anticheat.ts`，阈值集中在 `server/config.ts`，可改）

| 规则 | 具体做法 | 应对的作弊方式 |
|---|---|---|
| 排位资格 | 必须是会员、邮箱已验证、状态不是 `ranked_ban` 或 `banned` | 小号 |
| 同设备 / 同 IP 不配对 | 排位队列里，双方任一 `uid_hash` 相同，或本次连接 IP 相同，不配对 | 自己跟自己刷分 |
| 同一对手限次 | 24 小时内同一对手的排位局，只有前 3 局计分，之后照常下但不计分（开局时提示“本局不计段位”） | 两个号互刷 |
| 定级期 | 前 10 局排位 K=48，段位显示“定级中”，不上排行榜；之后 K=32；2000 分以上 K=24 | 新号影响排行 |
| 逃跑惩罚 | 最近 20 局排位中，离开 + 掉线未归达到 30% 或以上：暂停排位 24 小时；再犯 72 小时；第三次 7 天。写入 `sanctions` | 输棋就跑 |
| 短局标记 | 五子棋少于 10 手、围棋少于 30 手就以认输、离开、超时结束的排位局，在 `games.flags` 标记 `short`；同一对双方 7 天内短局达到 3 次，给双方标记 `farming?` 待人工复查 | 秒投送分 |
| 举报阈值 | 7 天内被 3 个不同的人举报：账号标记待复查，并在管理工具里置顶 | 各类 |
| 用时特征 | 每局结束后计算双方每手用时的均值与变异系数；排位中连续 10 局变异系数异常低（如低于 0.15）、且胜率异常高，标记 `timing?` | 借助外部 AI（辅助线索） |
| 频率限制 | 每个连接每秒最多 20 条消息，超出就丢弃，持续超出断开；每个 IP 同时最多 4 条连接 | 刷消息 |

**对“借助外部 AI 下棋”要实事求是**：没有可靠的自动判定手段，本方案**只做标记、不自动处罚**，最终由人看棋谱判断。管理工具提供“与本地 AI 首选点的重合率”作参考（五子棋较有参考价值；围棋的内置 AI 较弱，参考价值有限）。

### 10.2 管理工具（`node server.cjs admin <命令>`）

直接读写数据库；需要让运行中的服务端立即生效的操作（封禁、踢人），通过本机接口 `POST http://127.0.0.1:<端口>/admin/refresh` 通知，要求请求头带 `ADMIN_TOKEN`，并且只接受来自 127.0.0.1 的请求。

| 命令 | 作用 |
|---|---|
| `admin user <邮箱/昵称/id>` | 用户资料、段位、处罚历史、关联设备、共用设备的其他账号 |
| `admin games <用户> [--last 20]` | 最近对局列表：对手、结果、手数、时长、标记 |
| `admin game <id> [--sgf]` | 打印单局：终局盘面（字符画）、每手坐标与用时；`--sgf` 导出 SGF 复盘 |
| `admin analyze <用户> [--last 20]` | 用时统计、与本地 AI 首选点的重合率、逃跑率、主要对手分布 |
| `admin flagged` | 待复查列表（自动标记 + 举报阈值） |
| `admin reports [--open]`、`admin report <id> valid\|invalid` | 处理举报 |
| `admin mute\|ranked-ban\|ban <用户> --days N --reason "…"` | 处罚，同时写 `sanctions`、`audit`；`ban` 会踢掉在线连接，并把关联设备标记为高风险（这些设备注册的新号要人工确认后才能排位） |
| `admin unban <用户>` | 解除 |
| `admin rollback <用户> [--since 日期]` | 回滚：该用户在范围内所有排位局里，**对手**因输给他而扣的分全部加回（写 `rating_changes(cause='rollback')`）；该用户本人分数重置为 1200 或指定值。对手之后的分数变化不重算（说明见下） |
| `admin rename <用户> <新名>` | 强制改名 |
| `admin stats` | 在线人数、今日对局数、队列人数、注册数 |
| `admin backup` | 立即备份 |

> 关于回滚：严格来说，对手被扣分后又下了别的棋，后续的 Elo 都会受影响。完全重算代价大、而且会让大量无关玩家的分数跳动，所以只把“直接被作弊者赢走的分”还回去。这是常见的折中做法。

### 10.3 客户端

- 联机终局后，对局面板加“举报”按钮 → 选择原因（使用外挂 / 刷分 / 辱骂或恶意拖延 / 不当昵称 / 其他）+ 可选说明。
- 被暂停排位时，排位按钮显示原因与剩余时间（来自 `restricted` 消息）。
- 开局时如果本局不计段位（同一对手限次），显示“本局不计段位”。

**验收**：`tests/anticheat.test.ts` 覆盖每条规则；在测试服演练一次“发现 → 查看 → 封禁 → 回滚”的完整流程。

---

## 11. 阶段 9 · 客户端新功能（按需，逐个交付）

这些功能都建立在阶段 1 的 `GameRecord` 上，前面做完后成本都不高。

| 功能 | 说明 | 约 |
|---|---|---|
| 战绩页 | 多人游戏页新增“战绩”：最近对局、胜负、段位变化曲线 | 1.5 天 |
| 复盘 | 新界面 `Screen.Replay`：前进、后退、跳到第 N 手、自动播放；联机棋谱从 `/api/games/:id` 取，单机棋谱从本地取 | 2 天 |
| 排行榜 | 五子棋、围棋各一张，前 100 | 0.5 天 |
| 残局存档 | 单机和人机对局退出时自动保存，回来可继续（存 `localStorage`，只存 `GameRecord`） | 0.5 天 |
| 自动更新 | 只有桌面版，发新版就得靠它：`electron-updater`，更新包放在同一台服务器（Caddy 的 `file_server`，走 443）。Windows 直接可用；**macOS 的自动更新要求正式签名**（Developer ID），ad-hoc 签名只能提示“有新版本”并打开下载地址 | 1.5 天 |
| SGF 导入导出 | 复盘界面里导出；单机可以导入 SGF 摆出局面继续下 | 1 天 |
| 读秒 | `Clock` 抽象：每步限时（现有）、包干、包干 + 读秒；好友房可选 | 2 天 |
| 观战 | 好友房可以带观战者；协议加 `watch` / `unwatch`，观战者两个座位都是只读的 RemoteSeat | 2 天 |
| 形势判断 / 提示 | 单机时用现有 AI 给出建议点或胜率估计 | 1 天 |

---

## 12. 改造后的目录结构

```
src/
  main.tsx
  core/            纯规则：types、config、move、rules/{gomoku,go}、record、zobrist、sgf、renju、*AI
  session/         match、seats、aiSeat、remoteSeat、policy
  presentation/    boardView（全部动画状态）
  app/             app（帧循环）、router、store、controller（输入 → 意图）、settings、ai.worker
  render/  fx/  scene/  audio/      只读 BoardView 与对局快照
  online/          client（WebSocket 会话）、api（HTTP）、auth（令牌与当前用户）
  shared/          protocol（v4）、errors（错误码）
  ui/              panels、online、account、records（战绩）、replay、widgets
  i18n/
server/
  main.ts config.ts http.ts host.ts hub.ts matchmaking.ts room.ts rating.ts anticheat.ts ratelimit.ts mail.ts
  db/{index.ts, schema.sql, migrations/, repo.ts, importLegacy.ts}
  admin/{cli.ts, commands/*.ts}
  data/badwords.txt
electron/          main、preload（新增 secret.get/set）
tests/             rules、record、match、server、auth、anticheat、db、e2e
docs/              PLAN.md（本文）、PROTOCOL.md（v4 详细说明）、OPS.md（部署、备份、管理）
```

---

## 13. 测试、运维与隐私

### 13.1 测试

| 文件 | 覆盖 |
|---|---|
| `tests/rules.test.ts` | 现有用例 + 每种 `Reject` + 确定性 |
| `tests/record.test.ts` | 回放、悔棋、点目、SGF 往返 |
| `tests/match.test.ts` | 三种座位组合、事件顺序 |
| `tests/server.test.ts` | 协议 v4 全流程（假时钟 + `:memory:` 数据库） |
| `tests/db.test.ts` | 迁移、老数据导入、回滚 |
| `tests/auth.test.ts` | 注册、登录、验证码、限流、锁定、令牌过期、游客并入 |
| `tests/anticheat.test.ts` | 10.1 的每条规则 |
| `tests/e2e.test.ts` | 真起一个 http + ws 服务端，两个 ws 客户端下完一局排位 |

### 13.2 隐私与数据保留

- 收集的个人信息只有：邮箱、密码散列、IP、设备散列。在“更多”里加一页《隐私说明》，写清楚用途（登录、反作弊）和保留期限。
- `games.black_ip / white_ip` 保留 180 天后清空（每天的维护任务执行）；`sessions` 过期自动删除。
- 注销账号：清空邮箱、密码、昵称改为“已注销用户”，对局记录匿名保留（对手的战绩还要用）。

### 13.3 运维（写进 `docs/OPS.md`）

- systemd 服务：增加环境变量文件 `/etc/yi.env`（`YI_DB`、`SMTP_*`、`ADMIN_TOKEN`、`HOST=127.0.0.1`）。
- 日志：继续输出到 stdout，由 journald 收集；加上 `[auth]`、`[anticheat]`、`[admin]` 前缀方便过滤。
- 每日任务：备份、清理过期会话和验证码、清空过期 IP、解除到期处罚。
- 升级步骤：备份数据库 → 替换 `server.cjs` → `systemctl restart yi`（启动时自动执行迁移）。

---

## 14. 风险与对策

| 风险 | 对策 |
|---|---|
| 重构引入回归 | 阶段 1 至 3 每步都保证测试全过，并对照 2.0 逐项手动走查；先有 git 才开始动 |
| 协议 v4 发布时老玩家连不上 | 服务端给 v3 客户端发“请更新”；提前通知；桌面版以后可加自动更新（electron-updater，可放进阶段 9） |
| 数据库文件损坏或误删 | WAL 模式、每日 `VACUUM INTO` 备份、保留 14 天；建议再同步一份到对象存储 |
| 邮件进垃圾箱或发不出 | 用正规邮件推送服务，配好 SPF / DKIM；验证码页面提示“查看垃圾邮件” |
| 反作弊误伤 | 自动规则只做“暂停排位”和“标记”，封号必须人工确认；所有处罚可撤销、有记录 |
| 合规（D6、D7） | 备案通过前域名不对外提供服务；备案若因游戏或交互内容被驳回，改用香港服务器（改解析、改客户端地址即可）。公开运营前再评估实名与防沉迷要求 |
| 安装包分发渠道 | 没有网站后，安装包通过 QQ 群、网盘或 GitHub Releases 发放；自动更新走自己的服务器 |

---

## 15. 工作量汇总（粗估）

| 阶段 | 内容 | 约（天） |
|---|---|---|
| 0 | 工程基础 | 0.5 |
| 1 | 规则层纯化 | 3 |
| 2 | Match / Seat | 3 |
| 3 | 状态管理与路由 | 2 |
| 4 | 域名与 TLS | 0.5（不含备案等待） |
| 5 | 数据库与对局记录 | 3 |
| 6 | 账号系统 | 4 |
| 7 | 协议 v4 | 3 |
| 8 | 反作弊与管理工具 | 4 |
| **合计（至 3.0）** | | **约 23 天** |
| 9 | 新功能（按需） | 每项 0.5 至 2 |

**建议的起步**：阶段 0 和阶段 1 可以马上开始，不依赖任何待定事项；域名已买好，确认 D6 后即可做阶段 4。
