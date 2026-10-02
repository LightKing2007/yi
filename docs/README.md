# 弈 · 文档索引

本目录存放“弈”项目的工程规范、操作规程、计划与审计记录。文档的分类与管理要求见 [standards/00-general.md](standards/00-general.md) 第 4.1 条与 [standards/11-documentation.md](standards/11-documentation.md)。

## 1 目录

| 目录 | 类别 | 性质 | 内容 |
|---|---|---|---|
| [standards/](standards/00-general.md) | 规范 | 规范性，强制执行 | 工程规范 YI-STD-001，按领域分为 14 个文件 |
| [procedures/](procedures/release.md) | 规程 | 规范性，强制执行 | 按规范执行某项工作的操作步骤 |
| [plan/](plan/roadmap.md) | 计划 | 资料性 | 架构改造路线、规范整改路线 |
| [audits/](audits/2026-10-02-baseline.md) | 审计 | 资料性，只增不改 | 审查报告、性能报告、违规基线 |
| `incidents/` | 事件 | 资料性，只增不改 | 事件复盘报告（发生事件时建立） |

## 2 文件

### 2.1 规范（`standards/`）

| 文件 | 规则前缀 | 内容 |
|---|---|---|
| [00-general.md](standards/00-general.md) | GEN | 总则：范围、引用标准、术语、规则编号与执行等级、规范体系、例外、协作与审查、修订记录 |
| [01-coding.md](standards/01-coding.md) | COD | 编码与命名：文件格式、命名、注释、复杂度、类型安全、禁止的反模式、依赖引入 |
| [02-architecture.md](standards/02-architecture.md) | ARC | 架构与设计：分层与依赖方向、核心层纯度、数据流、模块边界、架构决策记录 |
| [03-data.md](standards/03-data.md) | DAT | 数据与存储：数据库命名与类型、约束与索引、迁移、数据分级与脱敏、本地存储、存档与备份 |
| [04-api.md](standards/04-api.md) | API | 接口与通信：消息格式、入参校验、错误码体系、状态码与关闭码、限流、重连、HTTP 接口、错误码表 |
| [05-security.md](standards/05-security.md) | SEC | 安全：威胁模型、传输、身份与会话、桌面端、服务器基线、密钥、漏洞管理、分发完整性 |
| [06-testing.md](standards/06-testing.md) | TST | 质量与测试：测试层级、覆盖率、确定性、Mock、性能基线 |
| [07-operations.md](standards/07-operations.md) | OPS | 构建、部署与运维：提交、CI、发布、上线与回滚、日志、监控、事件管理、日志事件码、监控指标 |
| [08-versioning.md](standards/08-versioning.md) | VER | 版本与兼容：版本号、协议与数据兼容、运行时与依赖版本、更新日志 |
| [09-text-and-i18n.md](standards/09-text-and-i18n.md) | I18N | 文字与国际化：文体、术语表、中文、更新日志、文言、英文、发布说明、多语言技术要求 |
| [10-edge-cases.md](standards/10-edge-cases.md) | EDGE | 极端与边界情况：高并发、网络抖动、脏数据、恶意攻击、版本兼容、多语言、平台、人为失误 |
| [11-documentation.md](standards/11-documentation.md) | DOC | 文档：文档集、文档要求、缺陷跟踪 |
| [12-audit.md](standards/12-audit.md) | AUD | 合规审计：度量指标、审计周期、发现分级 |
| [checklists.md](standards/checklists.md) | — | 检查清单：PR、发布、平台验证、上线后 |

### 2.2 规程（`procedures/`）

| 文件 | 内容 |
|---|---|
| [release.md](procedures/release.md) | 开发与发布规程：分支、提交、PR、更新日志、发版、上线、回滚、紧急修复 |
| `ops.md` | 运维规程：日常检查、备份恢复、应急（整改项 P1-12 建立） |

### 2.3 计划（`plan/`）

| 文件 | 内容 |
|---|---|
| [roadmap.md](plan/roadmap.md) | 架构改造路线图：目标、决策记录、未完成的阶段 5 至阶段 9、风险 |
| [remediation.md](plan/remediation.md) | 规范整改路线图：P0、P1、P2 整改项与待决策事项 |

### 2.4 审计（`audits/`）

| 文件 | 内容 |
|---|---|
| [2026-10-02-baseline.md](audits/2026-10-02-baseline.md) | 基线审查报告：16 项既有规范的审查、38 项发现、实测数据 |
| [2026-10-03-full-audit.md](audits/2026-10-03-full-audit.md) | 全面审计报告：150 个文件的代码审计、安全扫描、依赖更新，22 项发现 |
| [perf-2.0.4.md](audits/perf-2.0.4.md) | 2.0.4 的性能基线（TST-046）：电脑思考、服务端、下载页面、打包体积与渲染帧 |
| [baseline.json](audits/baseline.json) | 违规基线（OPS-015、00-general.md 第 4.3.2 条）：由 `node scripts/ratchet.mjs --update` 生成，各项只允许减少 |
