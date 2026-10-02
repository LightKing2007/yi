# 弈 · 编码与命名规范

| 项目 | 内容 |
|---|---|
| 所属 | 弈 · 工程规范（YI-STD-001），总则见 [00-general.md](00-general.md) |
| 文件版本 | 1.1.1 |
| 修订日期 | 2026-10-02 |
| 规则前缀 | `COD` |

参考：ISO/IEC 5055:2021（可靠性、安全性、性能效率、可维护性四类源码度量）；ISO/IEC 25010:2023 维护性子特性；GB/T 8567—2006 第 5 章。

## 1 文件格式

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| COD-001 | A | 文本文件统一 UTF-8 编码（无 BOM）、LF 换行、文件末尾一个换行符，由 `.editorconfig` 与 CI 检查 | 部分满足（无 `.editorconfig`） |
| COD-002 | A | 缩进统一 2 个空格，严禁 Tab | 满足 |
| COD-003 | B | 单行长度 ≤ 160 字符；超出时必须折行 | 未满足（96 行超出） |
| COD-004 | A | 字符串统一使用单引号；`src/i18n/table.ts` 译文表统一使用双引号；模板字符串只用于含插值或多行的字符串 | 满足 |
| COD-005 | A | 语句末尾统一加分号 | 满足 |
| COD-006 | A | 格式统一由 Prettier 决定，配置文件为仓库根目录的 `.prettierrc.json`；严禁手工调整与 Prettier 输出不同的格式。不由 Prettier 格式化的文件以 `.prettierignore` 列出并注明原因，只限于文档（按 09-text-and-i18n.md 排版）、按行解析的文字数据与二进制资源 | 未满足（未配置） |

## 2 命名

### 2.1 命名格式

| 编号 | 等级 | 对象 | 格式 | 示例 | 现状 |
|---|---|---|---|---|---|
| COD-010 | A | 目录 | 全小写单词，不含分隔符；集合目录用复数 | `core`、`tests`、`scripts` | 满足 |
| COD-011 | A | `src/`、`server/`、`electron/` 下的源文件 | lowerCamelCase；Worker 文件以 `.worker.ts` 结尾；严禁 PascalCase 文件名 | `boardView.ts`、`computer.worker.ts` | 部分满足（`src/ui/App.tsx`） |
| COD-012 | A | `scripts/` 下的脚本、`docs/` 下的文档 | 统一 kebab-case 小写英文；规范文件加两位序号前缀；仓库根目录的 `README.md`、`CLAUDE.md`、`SECURITY.md` 按 GitHub 约定全大写 | `build-node.mjs`、`01-coding.md`、`release.md` | 满足 |
| COD-013 | A | 类、接口、类型别名、枚举、Preact 组件 | PascalCase；严禁 `I`、`T` 等匈牙利前缀（泛型参数除外） | `BoardView`、`Seat`、`UpdateNote` | 满足 |
| COD-014 | A | 函数、方法、变量、参数、属性 | lowerCamelCase | `rankIndex`、`lastSeen` | 满足 |
| COD-015 | A | 模块级不可变常量（原始值、冻结表） | UPPER_SNAKE_CASE；表示时间、大小的常量必须以单位结尾：`_MS`、`_SECS`、`_BYTES`、`_PX` | `GRACE_SECS`、`MAX_MSG_BYTES` | 部分满足（`MAX_MSG`、`LOG_MAX` 无单位） |
| COD-016 | A | 环境变量 | `YI_` 前缀加 UPPER_SNAKE_CASE。存量的 `PORT`、`HOST`、`EXTRA_PORTS` 允许保留，严禁新增无前缀变量 | `YI_LATEST` | 部分满足 |
| COD-017 | A | `localStorage` 键 | `yi.` 前缀加 lowerCamelCase | `yi.settings` | 满足 |
| COD-018 | A | 协议消息类型 `t`、消息字段 | lowerCamelCase | `resumeFailed` | 满足 |
| COD-019 | A | 枚举性字符串值（错误码、终局原因、禁着原因） | kebab-case；错误码另加领域前缀，见 [04-api.md](04-api.md) 第 3 节 | `off-board`、`room.full` | 满足 |
| COD-020 | C | CSS 类名、CSS 自定义属性 | kebab-case | `update-note`、`--serif` | 满足 |
| COD-021 | A | Git 分支 | `类型/kebab-case 英文`，总长 ≤ 40 字符；类型同 OPS-001 | `fix/back-flash` | 满足 |
| COD-022 | A | 数据库对象 | 见 [03-data.md](03-data.md) 第 2 节 | — | 不适用（尚无数据库） |

### 2.2 命名语义

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| COD-023 | C | 布尔量必须使用形容词、过去分词，或 `is`、`has`、`can`、`should` 前缀，如 `over`、`thinking`、`isDraft`；严禁否定式命名，如 `notReady`、`disableX` | 满足 |
| COD-024 | B | 单字母标识符只允许用于：循环计数 `i`、`j`、`k`、`n`；坐标 `x`、`y`、`z`；不超过 10 行的回调参数。领域缩写白名单为 `g`（Game）、`r`（Room）、`p`（Player）、`m`（消息）、`st`（状态）、`b`（棋盘数组），只允许在函数作用域内使用，严禁用于导出符号和类属性 | 部分满足 |
| COD-025 | A | 枚举名、类名、导出函数名严禁使用两个字母以下的缩写（存量 `const enum RS` 必须改为 `RoomState`） | 部分满足（1 处） |
| COD-026 | C | 同一概念在全项目使用同一标识符，以 [09-text-and-i18n.md](09-text-and-i18n.md) 第 2.2 节术语表的英文标识为准；新增领域概念必须先补入术语表 | 满足 |

## 3 注释与文档注释

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| COD-030 | A | 每个源文件第一行必须是模块说明注释，写明该模块的职责 | 满足（61/61） |
| COD-031 | B | 每个导出的函数、类、接口、类型、常量必须有 TSDoc 文档注释（`/** … */`），写明用途；函数参数或返回值含单位、取值范围或副作用时必须写明 | 未满足（125/307，41%） |
| COD-032 | B | 目录级注释率（注释行 ÷（注释行 + 代码行），行尾注释按 0.5 行计）≥ 10%；`src/i18n/table.ts`、`src/render/shaders.ts` 等数据文件除外 | 未满足（`ui` 3.8%、`audio` 6.7%、`render` 8.3%、`server` 8.8%） |
| COD-033 | C | 注释必须说明“为什么”或“约束是什么”，严禁逐句复述代码 | 满足 |
| COD-034 | A | 严禁提交被注释掉的代码 | 满足 |
| COD-035 | A | 待办注释格式统一为 `TODO(#Issue 编号): 说明`，严禁不带 Issue 编号的 `TODO`、`FIXME`、`XXX`、`HACK` | 满足（0 处） |
| COD-036 | A | 源码注释统一使用中文；代码标识符、协议字段名、第三方 API 名保持英文 | 满足 |

## 4 复杂度与规模

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| COD-037 | B | 函数体 ≤ 60 行（不含空行与注释行） | 未满足（11 处） |
| COD-038 | A | 函数圈复杂度 ≤ 15；协议消息分发函数允许 ≤ 30，但每个分支必须委托给独立函数 | 未知（待 P1-01 测量） |
| COD-039 | A | 代码块嵌套深度 ≤ 4；函数参数 ≤ 4 个，超过时改用选项对象 | 未知（待 P1-01 测量） |
| COD-040 | B | 源文件 ≤ 400 行；数据文件（译文表、着色器源码）≤ 1000 行 | 未满足（`server/rooms.ts` 628、`src/online/client.ts` 524、`src/core/goAI.ts` 467、`src/audio/synth.worker.ts` 434） |
| COD-041 | B | 单个文件的 `import` 语句 ≤ 15 条 | 未满足（`src/ui/online.tsx` 17、`src/app/stage.ts` 16） |
| COD-042 | B | 严禁 10 行以上的重复代码块，由 jscpd 检测，阈值为 10 行、50 个标记 | 未知（待 P1-01 测量） |

## 5 类型安全

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| COD-050 | A | `tsconfig.json` 必须开启 `strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`、`noImplicitOverride`、`noUncheckedIndexedAccess`；后两项按整改项 P2-10 分阶段开启 | 部分满足 |
| COD-051 | B | 严禁 `any`。外部库缺少类型定义时，允许在边界处使用一次，必须带 [00-general.md](00-general.md) 第 4.4 节格式的例外声明 | 未满足（6 处） |
| COD-052 | B | 非空断言 `!` 每处必须在同一行或上一行注释说明为何非空 | 未满足（23 处中多数无说明） |
| COD-053 | A | 严禁对外部输入使用 `as` 类型断言。外部输入必须经过返回类型谓词或解析结果的校验函数，见 API-010 至 API-016 | 未满足（服务端以 `as C2S` 处理入站消息） |
| COD-054 | A | 严禁 `@ts-ignore`、`@ts-nocheck`；`@ts-expect-error` 只允许在 `tests/` 中使用，并必须附原因 | 满足 |
| COD-055 | A | 严禁 `export default`；统一使用具名导出 | 满足 |
| COD-056 | A | 严禁 `var`；不重新赋值的绑定统一用 `const` | 满足 |
| COD-057 | A | 严禁 `==` 与 `!=`；与 `null` 比较时允许 `== null` | 满足 |
| COD-058 | A | 严禁导出可变绑定（`export let`）；跨模块共享的可变状态统一放在 signal 或类实例中 | 满足 |

## 6 禁止的反模式

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| COD-060 | A | 严禁 `eval`、`new Function`、`setTimeout(字符串)`、`innerHTML`、`outerHTML`、`document.write`、`dangerouslySetInnerHTML` | 满足 |
| COD-061 | A | 严禁未处理的 Promise。每个 Promise 必须被 `await`、返回，或以 `.catch()` 处理；以 `void` 显式丢弃时必须注释原因 | 未知（待 P1-01 测量） |
| COD-062 | A | 严禁空的 `catch` 块。忽略异常时，`catch` 内必须有注释说明为何可以忽略，原因不少于 8 个汉字；存量的 `/* 忽略 */` 必须补全原因 | 部分满足 |
| COD-063 | A | `throw` 的对象必须是 `Error` 或其子类的实例，消息必须包含出错时的关键参数值 | 满足 |
| COD-064 | A | `console.*` 只允许出现在 `server/log.ts`（P1-08 建立）、`scripts/`、`src/app/scenarios.ts` 和开发模式分支中；其他位置统一调用日志接口 | 部分满足（10 处中 4 处不合规） |
| COD-065 | B | 严禁魔法数字：表示时间、上限、阈值、端口、重试次数的字面量必须定义为具名常量（COD-015）；`0`、`1`、`-1`、`2`（倍数或除数）和数组下标除外 | 未满足（如 `src/online/client.ts` 中的 `8000` 与重连间隔 `2`） |
| COD-066 | A | 渲染帧循环（每帧调用的函数）内严禁创建数组、对象、闭包，严禁调用 `JSON.*`；必须复用预分配的缓冲区 | 未知（待 P2-12 审查） |
| COD-067 | A | 服务端消息处理路径严禁同步文件 I/O（`fs.*Sync`）。定时落盘允许同步 I/O，单次耗时必须 ≤ 50 ms，超出时改为异步写入 | 满足 |
| COD-068 | A | 严禁在循环中拼接 SQL，严禁以字符串插值构造 SQL；统一使用参数化语句 | 不适用（尚无数据库） |

## 7 依赖引入

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| COD-070 | C | 新增依赖必须在 PR 中写明用途、许可证、周下载量、最近一次发布日期。必须同时满足：许可证属于 MIT、BSD-2-Clause、BSD-3-Clause、Apache-2.0、ISC、0BSD、OFL-1.1；最近 12 个月内有发布；无未修复的高危漏洞 | 满足 |
| COD-071 | A | 严禁引入 GPL、AGPL、LGPL、SSPL 及无许可证的依赖，由 CI 的许可证检查执行 | 满足（未检查） |
| COD-072 | A | `package-lock.json` 必须提交；CI 与发布统一使用 `npm ci`；严禁在 CI 中使用 `npm install` | 满足 |
| COD-073 | A | 运行时依赖（随程序分发的代码）总数 ≤ 5 个顶层包；当前为 `preact`、`@preact/signals`、`ws` | 满足 |
