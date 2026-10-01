# 弈 · 架构与设计规范

| 项目 | 内容 |
|---|---|
| 所属 | 弈 · 工程规范（YI-STD-001），总则见 [00-general.md](00-general.md) |
| 文件版本 | 1.1 |
| 修订日期 | 2026-10-02 |
| 规则前缀 | `ARC` |

参考：ISO/IEC/IEEE 42010:2022（架构描述）；ISO/IEC 25010:2023 维护性中的模块性、可复用性、可测试性；GB/T 8567—2006 第 6 章（软件设计说明）。

## 1 分层与依赖方向

1.1 项目的层与允许的依赖方向统一如下（箭头表示“可以依赖”）。本表与 `tests/layers.test.ts` 中的 `ALLOWED` 必须逐项一致：

| 层 | 职责 | 允许依赖的层 | 允许的第三方包与运行时模块 |
|---|---|---|---|
| core | 棋类规则、棋谱、电脑算法，纯计算 | — | 无 |
| shared | 联机协议、段位表、错误码 | core | 无 |
| session | 对局会话与座位 | core | 无 |
| presentation | 棋盘的动画状态 | core、shared、app | 无 |
| render | WebGL 绘制 | core、app、fx | 无 |
| fx | 终局特效 | core、app、audio、presentation、render、scene | 无 |
| scene | 场景布置 | core、render、online | 无 |
| audio | 音效与音乐合成 | core、app | 无 |
| i18n | 多语言 | app | 无 |
| online | 联机客户端 | core、shared、app、audio、i18n | 无 |
| app | 主循环、状态、控制器 | 上述全部（除 ui、main） | `@preact/signals` |
| ui | Preact 界面 | core、shared、app、audio、fx、i18n、online、scene、render | `preact`、`@preact/signals` |
| main | 前端入口 | app、audio、online、ui | 无 |
| server | 联机服务端 | core、shared | `ws`、`node:*` |
| electron | 桌面版主进程与预加载 | 无（严禁依赖 `src/`） | `electron`、`node:*` |

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| ARC-010 | A | 模块间严禁循环依赖 | 满足 |
| ARC-011 | A | 每个模块只允许依赖 7.1.1 表中允许的层；检查必须覆盖 `import … from`、`import '…'`（副作用导入）、`export … from`、动态 `import()` 四种形式 | 部分满足（只覆盖第一种） |
| ARC-012 | A | 每层只允许使用 7.1.1 表中列出的第三方包与 `node:*` 模块 | 未满足（未检查） |
| ARC-013 | A | `import type` 不计入依赖方向，但严禁以 `import type` 引用不允许依赖的层的运行时值 | 满足 |
| ARC-014 | C | 新增层或调整依赖方向，必须先在 `docs/adr/` 中提交架构决策记录（ARC-060），并在同一 PR 中修改 7.1.1 表与 `tests/layers.test.ts` | 满足 |

## 2 核心层纯度

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| ARC-020 | A | `src/core/` 严禁直接调用 `Date.now`、`new Date`、`performance.now`、`Math.random`、`setTimeout`、`setInterval`、`console.*`、DOM API、`localStorage`、网络与文件 API；时间统一经 `src/core/clock.ts` 注入，随机数统一经参数传入的种子化生成器获得 | 部分满足（`goAI.ts` 直接调用 `performance.now` 和 `Math.random`） |
| ARC-021 | A | 规则函数（`src/core/rules/`）必须是纯函数：相同输入必须得到相同输出，严禁修改入参 | 满足 |
| ARC-022 | A | 规则层的拒绝原因统一为 `Reject` 枚举码，严禁返回自然语言文本 | 满足 |
| ARC-023 | C | 电脑算法的思考时间上限必须由调用方注入（预算毫秒数或模拟次数），严禁在算法内部写死 | 部分满足 |

## 3 数据流与状态

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| ARC-030 | C | 前端数据流统一为单向：输入 → `controller` / `session` → `Game`（规则）→ `listener` → `BoardView` → 渲染；严禁渲染层、特效层修改 `Game` | 满足 |
| ARC-031 | C | 联机对局的唯一可信状态在服务端。客户端在收到服务端确认（`moved`、`passed`、`undone` 等）之前，严禁修改联机对局状态；本地预检只允许用于提示 | 满足 |
| ARC-032 | C | 界面状态统一用 `@preact/signals` 表达；严禁在组件中直接修改 `Game` 或联机状态，必须调用 `controller`、`session` 或联机模块的公开函数 | 满足 |
| ARC-033 | C | 跨线程（Worker）请求必须带请求编号与局面指纹（`Game.ver`）；结果的指纹与当前局面不一致时必须丢弃；必须支持以终止 Worker 的方式取消 | 满足 |
| ARC-034 | C | 服务端业务逻辑（`server/rooms.ts`）严禁直接依赖传输层与存储层实现，统一经 `Conn`、`RatingStore` 等接口注入，以保证可在测试中以假实现替换 | 满足 |

## 4 模块边界与接口

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| ARC-040 | C | 每个模块只承担一项职责，模块说明注释（COD-030）必须能用一句话概括；需要用“和”连接两项无关职责时，必须拆分 | 部分满足（`server/rooms.ts` 同时承担队列、房间、对局、段位） |
| ARC-041 | C | 跨层调用只允许经由目标模块的导出符号；以下划线开头或注释标明“内部”的符号严禁跨文件使用 | 满足 |
| ARC-042 | A | 环境变量与命令行参数统一在一个配置模块中解析并校验（服务端为 `server/config.ts`，P2-04 建立），其他模块严禁直接读取 `process.env`；校验失败时进程必须以退出码 78 退出，并打印失败的变量名与期望格式 | 未满足（`server/main.ts` 直接读取） |
| ARC-043 | C | Electron 主进程与渲染进程之间只允许经 `preload.ts` 中 `contextBridge` 暴露的函数通信，通道名统一为 `app:` 前缀；主进程必须校验每个通道参数的类型与长度 | 满足 |

## 5 架构决策记录

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| ARC-060 | C | 影响两个及以上层、引入运行时依赖、改变协议或数据格式的决策，必须在 `docs/adr/NNNN-标题.md` 中记录，内容统一包括：背景、决策、备选方案、后果、状态（提议、接受、废弃、取代）；[plan/roadmap.md](../plan/roadmap.md) 中已有的决策 D1 至 D12 视为已接受的记录 | 部分满足 |
