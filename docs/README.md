# 弈 · 文档索引

| 项目 | 内容 |
|---|---|
| 文件版本 | 2.0 |
| 修订日期 | 2026-11-04 |
| 状态 | 现行 |
| 读者 | 全部参与者：开发者、维护者、审查者与外部报告者 |
| 规范依据 | [standards/00-general.md](standards/00-general.md) 第 4.1 条；[standards/11-documentation.md](standards/11-documentation.md) |

本索引是文档体系的唯一入口：说明每份文档的职责、读者与状态，以及文档之间的分工。规则条文与文档要求以[工程规范](standards/00-general.md)为准，本索引不重复规定内容（GEN-001）。

## 1 文档集与分工

1.1 项目文档分为下列类别，分别存放于 `docs/` 下对应目录（00-general.md 第 4.1.1 条）：

| 类别 | 目录 | 性质 | 主要读者 | 唯一职责 |
|---|---|---|---|---|
| 规范 | [standards/](standards/00-general.md) | 规范性，强制执行 | 全部参与者 | 规则条文及其执行方式（YI-STD-001） |
| 规程 | [procedures/](procedures/release.md) | 规范性，强制执行 | 开发者、维护者 | 按规范执行某项工作的操作步骤 |
| 计划 | [plan/](plan/roadmap.md) | 资料性 | 开发者、维护者 | 路线、整改、设计与契约；阶段与整改状态分别由 [roadmap.md](plan/roadmap.md)、[remediation.md](plan/remediation.md) 单一负责 |
| 审计 | [audits/](audits/2026-10-02-baseline.md) | 资料性，只增不改 | 维护者 | 审查、性能、演练与验证的事实与数据 |
| 参考 | [reference/](reference/README.md) | 资料性 | 维护者 | 外部资料的拆解与学习笔记，不构成规定 |
| 事件 | `incidents/` | 资料性，只增不改 | 维护者 | 事件复盘报告（发生事件时建立） |

1.2 仓库根部的文件不属于上述目录，职责如下：

| 文件 | 性质 | 读者 | 职责 |
|---|---|---|---|
| [README.md](../README.md) | 资料性 | 玩家、开发者、维护者 | 软件产品规格说明与开发者手册：功能、开发方法、打包发行、联机服务端部署、源码结构；不重复规范条文 |
| [SECURITY.md](../SECURITY.md) | 资料性 | 外部报告者 | 安全策略：支持范围、私下报告方式、响应与公开时限（SEC-063） |
| [CLAUDE.md](../CLAUDE.md) | 协作约定入口 | 全部参与者（含 AI 协作者） | 按任务列出必读规范与流程入口；只保留指向规范的引用（GEN-001） |
| `HANDOFF.md` | 会话交接记录，不纳入版本控制 | 维护者 | 记录会话完成的工作与下一步规划；位于主仓库检出目录根部，工作树中没有 |

1.3 文档索引不重复各文件的内容。需要了解当前版本与阶段时看 [roadmap.md](plan/roadmap.md)；需要了解整改项状态时看 [remediation.md](plan/remediation.md)；需要了解当前工作顺序时看 [next-development.md](plan/next-development.md) 的当前状态一章。

## 2 规范（`standards/`）

2.1 规范共 14 个规范文件与 1 份检查清单，规则以“前缀-序号”引用（11-website-frontend.md 不含规则编号）；执行方式与现状列的含义见 [00-general.md](standards/00-general.md) 第 3.3 条。

| 文件 | 规则前缀 | 唯一职责 |
|---|---|---|
| [00-general.md](standards/00-general.md) | GEN | 总则：范围、引用标准、术语、规则编号与执行等级、文档体系、例外、协作与修订记录 |
| [01-coding.md](standards/01-coding.md) | COD | 编码与命名：文件格式、命名、注释、复杂度、类型安全、禁止的反模式、依赖引入 |
| [02-architecture.md](standards/02-architecture.md) | ARC | 架构与设计：分层与依赖方向、核心层纯度、数据流、模块边界、架构决策记录 |
| [03-data.md](standards/03-data.md) | DAT | 数据与存储：数据库命名与类型、约束与索引、迁移、数据分级与脱敏、本地存储、备份与恢复 |
| [04-api.md](standards/04-api.md) | API | 接口与通信：消息格式、入参校验、错误码、状态码与关闭码、限流、重连、HTTP 接口 |
| [05-security.md](standards/05-security.md) | SEC | 安全：威胁模型、传输、身份与会话、桌面端、服务器基线、密钥、漏洞管理、分发完整性 |
| [06-testing.md](standards/06-testing.md) | TST | 质量与测试：测试层级、覆盖率、确定性、Mock、性能基线 |
| [07-operations.md](standards/07-operations.md) | OPS | 构建、部署与运维：提交、CI、发布、上线与回滚、日志、监控、事件管理、日志事件码与指标 |
| [08-versioning.md](standards/08-versioning.md) | VER | 版本与兼容：版本号、协议与数据兼容、运行时与依赖版本、更新日志 |
| [09-text-and-i18n.md](standards/09-text-and-i18n.md) | I18N | 文字与国际化：文体、术语表、中文、更新日志、文言、英文、发布说明、多语言技术要求 |
| [10-edge-cases.md](standards/10-edge-cases.md) | EDGE | 极端与边界情况：高并发、网络抖动、脏数据、恶意攻击、版本兼容、多语言、平台、人为失误 |
| [11-documentation.md](standards/11-documentation.md) | DOC | 文档：文档集、文档要求、缺陷跟踪 |
| [11-website-frontend.md](standards/11-website-frontend.md) | — | 官网前端：设计风格、组件、样式与渐进增强的边界与验收；改官网页面前必读 |
| [12-audit.md](standards/12-audit.md) | AUD | 合规审计：度量指标、审计周期、发现分级 |
| [checklists.md](standards/checklists.md) | — | 检查清单：PR、发布前、平台验证、上线后 |

2.2 规则中的“现状”列记录最近一次核对的符合情况，不是规定本身；未满足项必须在 [remediation.md](plan/remediation.md) 中登记（00-general.md 第 3.3.3 条）。

## 3 规程（`procedures/`）

| 文件 | 读者 | 唯一职责 | 状态 |
|---|---|---|---|
| [release.md](procedures/release.md) | 开发者 | 开发与发布：分支、提交、PR、更新日志、发版、上线、回滚、紧急修复 | 现行 |
| [ops.md](procedures/ops.md) | 维护者 | 运维：日常检查、备份与恢复、回滚、应急处置、账号功能的开启 | 现行 |
| [website.md](procedures/website.md) | 维护者、网站工作流 | 独立官网的正文维护、独立发布、首次迁移、更新与回滚、游戏内更新清单的同步 | 现行；页面实现细节以 [11-website-frontend.md](standards/11-website-frontend.md) 为准 |

## 4 计划（`plan/`）

### 4.1 路线与整改（状态的唯一来源）

| 文件 | 读者 | 唯一职责 | 状态 |
|---|---|---|---|
| [roadmap.md](plan/roadmap.md) | 开发者、维护者 | 架构改造路线：目标、原则、决策记录、阶段与版本状态、各阶段设计；版本与阶段状态以本文件为准 | 现行 |
| [remediation.md](plan/remediation.md) | 全部参与者 | 规范整改路线：P0、P1、P2 整改项、期限与待决策事项；整改项状态以本文件为准 | 现行 |
| [next-development.md](plan/next-development.md) | 开发者、维护者 | 当前工作顺序与批次安排；第 1 至 13 章是 2026-10-30 至 10-31 的历史记录，第 14 章为当前状态 | 现行 |

### 4.2 阶段与设计记录

| 文件 | 读者 | 唯一职责 | 状态 |
|---|---|---|---|
| [phase5.md](plan/phase5.md) | 开发者、维护者 | 阶段 5 的逐步开发记录与验收依据 | 已完成；历史记录 |
| [phase6-7.md](plan/phase6-7.md) | 开发者 | 阶段 6、7 的设计边界与安全要求；接口与协议以两份契约为准 | 设计记录（已随 4.0 实施） |
| [agreement-publication.md](plan/agreement-publication.md) | 维护者 | 官网三份文书的补齐事项与正式版 1.0 的定稿记录 | 记录；文书已发布 |

### 4.3 契约（现行）

| 文件 | 读者 | 唯一职责 | 状态 |
|---|---|---|---|
| [account-api.md](plan/account-api.md) | 开发者 | 账号 HTTP 接口契约：路径、请求与响应、错误码、跨源与客户端约定 | 现行；4.0 已实现并上线 |
| [protocol-v4.md](plan/protocol-v4.md) | 开发者 | 联机协议第 4 版契约：账号握手、一个账号一条连接、错误码、状态版本与重同步、第 3 版客户端更新指引 | 现行；4.0 已实现并上线 |

## 5 架构决策记录（`adr/`）

写法、状态与全部记录的索引见 [adr/README.md](adr/README.md)。ADR 正文在决策接受后只增不改；决策改变时新写一条并把旧记录标为被取代或废弃。路线图第 3 章的 D1 至 D13、整改路线图第 7 章的 D-1 至 D-4 视为已接受的记录，不在 `adr/` 重复。

## 6 审计（`audits/`）

审计报告与性能报告只增不改；发现的问题按 [12-audit.md](standards/12-audit.md) 分级后登记到 [remediation.md](plan/remediation.md)。

### 6.1 审查、安全与演练

| 文件 | 内容 |
|---|---|
| [2026-10-02-baseline.md](audits/2026-10-02-baseline.md) | 基线审查：16 项既有规范、38 项发现 |
| [2026-10-03-full-audit.md](audits/2026-10-03-full-audit.md) | 全面审计：150 个文件、安全扫描、依赖更新，22 项发现 |
| [2026-10-05-restore-drill.md](audits/2026-10-05-restore-drill.md) | 恢复演练（DAT-065）：从 OSS 的异地备份解密，与本地备份逐字节一致 |
| [2026-10-29-restore-drill.md](audits/2026-10-29-restore-drill.md) | 恢复演练（DAT-065）：数据库异地备份解密、校验和与条数一致、副本启动正常 |
| [2026-10-29-ops-drill.md](audits/2026-10-29-ops-drill.md) | 回滚与维护模式演练（OPS-044、OPS-045） |
| [2026-10-30-account-foundations.md](audits/2026-10-30-account-foundations.md) | 账号基础与仓储开发验证记录（不代替阶段验收） |
| [2026-11-02-upgrade-drill.md](audits/2026-11-02-upgrade-drill.md) | 升级演练：数据库结构第 1 版升到第 5 版，含打开账号功能与回滚恢复 |

### 6.2 性能报告

| 文件 | 内容 |
|---|---|
| [perf-2.0.4.md](audits/perf-2.0.4.md) | 2.0.4 性能基线（TST-046） |
| [perf-2.0.5.md](audits/perf-2.0.5.md) | 2.0.5 性能测量与对照 |
| [perf-2.0.6.md](audits/perf-2.0.6.md) | 2.0.6 性能测量 |
| [perf-2.0.7.md](audits/perf-2.0.7.md) | 2.0.7 性能测量与对照 |
| [perf-3.0.0.md](audits/perf-3.0.0.md) | 3.0.0 性能测量与对照（含 `tick()` 加测） |
| [perf-3.1.0.md](audits/perf-3.1.0.md) | 3.1.0 性能测量与对照（含网站页面） |
| [perf-4.0.0.md](audits/perf-4.0.0.md) | 4.0.0 性能测量与对照（含账号与协议第 4 版） |

### 6.3 基线

[baseline.json](audits/baseline.json) 为违规基线（OPS-015、00-general.md 第 4.3.2 条），由 `node scripts/ratchet.mjs --update` 生成，各项只允许减少；不得手工编辑。

## 7 参考资料（`reference/`）

| 文件 | 内容 |
|---|---|
| [reference/README.md](reference/README.md) | 参考资料的说明、登记表与维护要求 |
| [baigave-design-teardown.md](reference/baigave-design-teardown.md) | baigave.cn 官网设计拆解；外部资料，不构成项目规定 |

## 8 事件（`incidents/`）

发生 SEV1、SEV2 事件时，按 [07-operations.md](standards/07-operations.md) 第 7 节与 [ops.md](procedures/ops.md) 第 5.1 条提交复盘报告 `incidents/YYYY-MM-DD-标题.md`。目录尚未建立，建立后在本索引登记，并在 [11-documentation.md](standards/11-documentation.md) 第 1.1 条更新“现状”。

## 9 阅读路径

| 你的任务 | 先读 | 再按需查阅 |
|---|---|---|
| 首次参与项目 | [README.md](../README.md)、[CLAUDE.md](../CLAUDE.md)、[00-general.md](standards/00-general.md) | [roadmap.md](plan/roadmap.md) 第 3、4 章 |
| 修改源码 | [CLAUDE.md](../CLAUDE.md) 的必读表、[01-coding.md](standards/01-coding.md) | 对应的领域规范与 [checklists.md](standards/checklists.md) 第 1 节 |
| 新增功能或协议、数据变更 | [02-architecture.md](standards/02-architecture.md)、[04-api.md](standards/04-api.md)、[03-data.md](standards/03-data.md) | [10-edge-cases.md](standards/10-edge-cases.md)、[08-versioning.md](standards/08-versioning.md) |
| 发版、上线与运维 | [release.md](procedures/release.md)、[ops.md](procedures/ops.md) | [07-operations.md](standards/07-operations.md)、[checklists.md](standards/checklists.md) 第 2 至 4 节 |
| 只改官网 | [website.md](procedures/website.md)、[11-website-frontend.md](standards/11-website-frontend.md) | [04-api.md](standards/04-api.md) 的 API-060 至 API-063 |
| 新增或修改文档 | [11-documentation.md](standards/11-documentation.md)、[09-text-and-i18n.md](standards/09-text-and-i18n.md) | 本索引第 10 章 |
| 合规审计 | [12-audit.md](standards/12-audit.md) | [remediation.md](plan/remediation.md)、[audits/](audits/2026-10-02-baseline.md) |

## 10 维护与检查

10.1 一文件一职责：同一事项只在一处作出规定或记录状态，其他文件只引用，不复述（GEN-001）。

| 内容 | 唯一负责的文件 |
|---|---|
| 规则条文与执行方式 | `standards/` 下对应的规范 |
| 操作步骤 | `procedures/` 下对应的规程 |
| 版本与阶段状态 | [roadmap.md](plan/roadmap.md) |
| 整改项状态 | [remediation.md](plan/remediation.md) |
| 当前工作顺序 | [next-development.md](plan/next-development.md) 第 14 章 |
| 接口与协议细节 | [account-api.md](plan/account-api.md)、[protocol-v4.md](plan/protocol-v4.md) |
| 已接受的架构决策 | `adr/`（正文只增不改） |
| 审查、性能与演练数据 | `audits/`（只增不改） |

10.2 相对链接由 `tests/docs.test.ts` 在 CI 中检查（DOC-004）：本目录与仓库根部的全部 Markdown 文档，其相对链接与页内锚点必须指向存在的文件或标题。链接目标移动或改名时，必须在同一个 PR 中更新全部引用。

10.3 新增、移动、合并或删除文档时，必须在同一个 PR 中更新本索引与 [11-documentation.md](standards/11-documentation.md) 第 1.1 条的文档集，并在受影响的文档信息表中递增版本、更新修订日期（DOC-001、DOC-003）。审计报告与 ADR 正文不因链接变化而改写，只在索引中登记。

10.4 本索引的修订记录：

| 版本 | 日期 | 修订内容 |
|---|---|---|
| 2.0 | 2026-11-04 | 重排为按“一文件一职责”组织的文档集：补全规范、规程、计划、审计、参考与事件各类文档；标明每份文档的读者、职责与状态；明确版本与阶段状态、整改状态、当前工作顺序与契约的单一来源；登记 `docs/reference/`；说明 `tests/docs.test.ts` 的链接检查 |
| 1.0 | 2026-10-02 | 初版：目录与文件清单 |
