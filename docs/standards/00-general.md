# 弈 · 工程规范 · 总则

| 项目 | 内容 |
|---|---|
| 文件编号 | YI-STD-001 |
| 文件版本 | 1.1 |
| 发布日期 | 2026-10-02 |
| 状态 | 现行；整改项按 [plan/remediation.md](../plan/remediation.md) 的期限实施 |
| 编制 | LightKing、Claude |
| 审查基准 | [audits/2026-10-02-baseline.md](../audits/2026-10-02-baseline.md) |

## 引言

YI-STD-001《弈 · 工程规范》是“弈”项目全部工程规范的总纲，由本文件（总则）与 `docs/standards/` 下的各领域规范共同组成，以下统称“本规范”。

本规范的作用有三项：

1. 审查项目中已有的规范、约定和流程，找出反模式、模糊表述、逻辑漏洞和缺失的极端情况，并给出整改后的规定；审查过程与结论见 [基线审查报告](../audits/2026-10-02-baseline.md)；
2. 对成熟项目必须具备、但本项目尚未制定的规范，参照国际标准和国家标准从零建立，即 `01-coding.md` 至 `12-audit.md`；
3. 对每一类规范给出极端与边界情况的防御要求和降级方案，即 [10-edge-cases.md](10-edge-cases.md)，各领域规范中亦有分散规定。

本规范中的每一条规定均有唯一编号、执行等级和验证方式。凡无法量化、无法审计或无法执行的表述，均不作为规定。

## 1 范围

1.1 本规范规定“弈”项目在以下方面的要求：编码与命名、架构与设计、数据与存储、接口与通信、安全、质量与测试、构建部署与运维、版本与兼容、国际化与文字、极端与边界情况防御、文档、合规审计。

1.2 本规范适用于仓库内的全部内容，包括源码（`src/`、`server/`、`electron/`）、测试（`tests/`）、脚本（`scripts/`）、工作流（`.github/`）、构建资源（`build-res/`、`public/`）、文档（`docs/`、`README.md`、`CLAUDE.md`），以及线上服务器的部署与运维活动。

1.3 本规范适用于全部参与者，包括人类开发者和 AI 协作者。AI 协作者执行任何变更前必须遵守本规范，`CLAUDE.md` 仅作为本规范的入口指引。

1.4 以下内容不在本规范范围内：宣传片等营销素材（`trailer/`，不纳入版本控制）、第三方依赖的内部实现。

## 2 规范性引用文件

下列文件中的内容通过文中的规范性引用而构成本规范必不可少的条款。注明日期的引用文件，仅该日期对应的版本适用于本规范。表中“引用于”一列为引用该文件的规范文件，省略 `.md` 后缀。

### 2.1 国家标准

| 编号 | 名称 | 引用于 |
|---|---|---|
| GB/T 1.1—2020 | 标准化工作导则 第 1 部分：标准化文件的结构和起草规则 | 全部文件 |
| GB/T 8567—2006 | 计算机软件文档编制规范 | 11-documentation |
| GB/T 11457—2006 | 信息技术 软件工程术语 | 00-general |
| GB/T 15532—2008 | 计算机软件测试规范 | 06-testing |
| GB/T 25000.10—2016 | 系统与软件工程 系统与软件质量要求和评价（SQuaRE）第 10 部分：系统与软件质量模型 | 00-general、06-testing |
| GB/T 25000.51—2016 | 系统与软件工程 系统与软件质量要求和评价（SQuaRE）第 51 部分：就绪可用软件产品（RUSP）的质量要求和测试细则 | 06-testing |
| GB/T 22239—2019 | 信息安全技术 网络安全等级保护基本要求 | 05-security、07-operations |
| GB/T 35273—2020 | 信息安全技术 个人信息安全规范 | 03-data、05-security |
| GB/T 20984—2022 | 信息安全技术 信息安全风险评估方法 | 05-security |
| GB/T 20986—2023 | 信息安全技术 网络安全事件分类分级指南 | 07-operations |
| GB/T 7408.1—2023 | 日期和时间 信息交换表示法 第 1 部分：基本规则 | 03-data、07-operations |
| GB 18030—2022 | 信息技术 中文编码字符集 | 09-text-and-i18n |
| GB/T 15834—2011 | 标点符号用法 | 09-text-and-i18n |
| GB/T 15835—2011 | 出版物上数字用法 | 09-text-and-i18n |

### 2.2 国际标准

| 编号 | 名称 | 引用于 |
|---|---|---|
| ISO 9001:2015 | Quality management systems — Requirements | 00-general、12-audit |
| ISO/IEC/IEEE 12207:2017 | Systems and software engineering — Software life cycle processes | 00-general、07-operations |
| ISO/IEC 25010:2023 | Systems and software engineering — SQuaRE — Product quality model | 00-general、06-testing |
| ISO/IEC 5055:2021 | Software measurement — Software quality measurement — Automated source code quality measures | 01-coding |
| ISO/IEC/IEEE 42010:2022 | Software, systems and enterprise — Architecture description | 02-architecture |
| ISO/IEC/IEEE 29119-1:2022、-3:2021、-4:2021 | Software and systems engineering — Software testing | 06-testing |
| ISO/IEC 27001:2022、ISO/IEC 27002:2022 | Information security management systems；Information security controls | 05-security |
| ISO/IEC 29100:2011、ISO/IEC 27701:2019 | Privacy framework；Privacy information management | 03-data |
| ISO/IEC 27035-1:2023 | Information security incident management — Part 1 | 07-operations |
| ISO/IEC 29147:2018、ISO/IEC 30111:2019 | Vulnerability disclosure；Vulnerability handling processes | 05-security |
| ISO/IEC 20000-1:2018 | Service management system requirements | 07-operations |
| ISO 22301:2019 | Business continuity management systems | 03-data、07-operations |
| ISO 8601-1:2019 | Date and time — Representations for information interchange | 03-data、07-operations |
| ISO/IEC 9075（全部分） | Information technology — Database languages — SQL | 03-data |
| ISO/IEC 10646 | Universal coded character set (UCS) | 09-text-and-i18n |
| ISO 639-3 | Codes for the representation of names of languages | 09-text-and-i18n |
| ISO/IEC/IEEE 15289:2019、ISO/IEC/IEEE 26514:2022 | Content of life-cycle information items；Design and development of information for users | 11-documentation |
| ISO/IEC 40500:2012 | W3C Web Content Accessibility Guidelines (WCAG) 2.0 | 09-text-and-i18n |

### 2.3 行业规范与技术规范

| 编号 | 名称 | 引用于 |
|---|---|---|
| RFC 2119、RFC 8174 | Key words for use in RFCs to Indicate Requirement Levels | 00-general |
| RFC 3339 | Date and Time on the Internet: Timestamps | 07-operations |
| RFC 5424 | The Syslog Protocol（严重性等级） | 07-operations |
| RFC 5646（BCP 47） | Tags for Identifying Languages | 09-text-and-i18n |
| RFC 6455 | The WebSocket Protocol | 04-api |
| RFC 8259 | The JavaScript Object Notation (JSON) Data Interchange Format | 04-api |
| RFC 9110 | HTTP Semantics | 04-api |
| RFC 9457 | Problem Details for HTTP APIs | 04-api |
| Semantic Versioning 2.0.0 | 语义化版本 | 08-versioning |
| Conventional Commits 1.0.0 | 约定式提交 | 07-operations |
| OWASP ASVS 5.0、OWASP API Security Top 10:2023 | 应用安全验证标准；API 安全风险 | 04-api、05-security |
| SLSA v1.0、OpenSSF Scorecard | 软件供应链安全等级；开源项目安全度量 | 05-security、07-operations |
| CIS Ubuntu Linux 24.04 LTS Benchmark | 操作系统安全基线 | 05-security |
| Electron Security Checklist | Electron 官方安全清单 | 05-security |
| Unicode UAX #9、UAX #29、UTS #39 | 双向文字算法；文本分段；Unicode 安全机制 | 04-api、09-text-and-i18n |
| W3C WCAG 2.2 | Web Content Accessibility Guidelines 2.2 | 09-text-and-i18n |

## 3 术语、定义与规范用语

### 3.1 术语和定义

GB/T 11457—2006 界定的以及下列术语和定义适用于本规范。

| 术语 | 定义 |
|---|---|
| 规则 | 本规范中带编号的单条规定，如 `COD-012` |
| 存量代码 | 本规范发布时（提交 `ed1cb10`）已存在于 `main` 分支的代码 |
| 新增代码 | 本规范发布后新建的文件，以及存量文件中新增或修改的行 |
| 棘轮 | 对存量违规数的约束机制：违规数基线记录在 `docs/audits/baseline.json`，任何变更不得使违规数增加，违规数只能减少 |
| 门禁 | 在 CI 或 Git 钩子中自动执行、不通过即阻断合并或发布的检查 |
| 外部输入 | 来自本进程以外的数据，包括网络消息、HTTP 请求、文件、`localStorage`、环境变量、命令行参数、IPC 消息、Worker 消息 |
| 活跃对局 | 服务端状态为“对局中”或“点目中”的房间 |
| 生产环境 | 线上服务器 47.108.181.240 及其上运行的服务，以及已发布给玩家的安装程序 |
| 敏感等级 | [03-data.md](03-data.md) 第 6 节定义的数据分级 L1 至 L4 |

### 3.2 规范用语

本规范的规范用语与 GB/T 1.1—2020 及 RFC 2119、RFC 8174 的对应关系如下。其中“必须”“严禁”“统一”为强制要求，违反即为不合规；“允许”表示在所述条件下不构成违规。本规范不使用“尽量”“适度”“合理”等无法验证的表述。

| 用语 | 含义 | GB/T 1.1—2020 | RFC 2119 |
|---|---|---|---|
| 必须 | 强制要求 | 应 | MUST、SHALL |
| 严禁 | 强制禁止 | 不应 | MUST NOT、SHALL NOT |
| 统一 | 强制要求在全项目范围内采用同一做法 | 应 | MUST |
| 允许 | 在所述条件下许可 | 可 | MAY |

### 3.3 规则编号与执行等级

3.3.1 规则编号格式统一为 `领域前缀-三位序号`。领域前缀如下：

| 前缀 | 领域 | 文件 |
|---|---|---|
| GEN | 总则 | [00-general.md](00-general.md) |
| COD | 编码与命名 | [01-coding.md](01-coding.md) |
| ARC | 架构与设计 | [02-architecture.md](02-architecture.md) |
| DAT | 数据与存储 | [03-data.md](03-data.md) |
| API | 接口与通信 | [04-api.md](04-api.md) |
| SEC | 安全 | [05-security.md](05-security.md) |
| TST | 质量与测试 | [06-testing.md](06-testing.md) |
| OPS | 构建、部署与运维 | [07-operations.md](07-operations.md) |
| VER | 版本与兼容 | [08-versioning.md](08-versioning.md) |
| I18N | 国际化与文字 | [09-text-and-i18n.md](09-text-and-i18n.md) |
| EDGE | 极端与边界情况 | [10-edge-cases.md](10-edge-cases.md) |
| DOC | 文档 | [11-documentation.md](11-documentation.md) |
| AUD | 合规审计 | [12-audit.md](12-audit.md) |

规则编号在规范拆分、章节调整后保持不变；跨文件引用时统一使用规则编号，不使用章节号。

3.3.2 每条规则标注一个执行等级：

| 等级 | 名称 | 执行方式 | 违反的后果 |
|---|---|---|---|
| A | 自动门禁 | CI 或 Git 钩子自动检查 | 阻断合并或发布 |
| B | 自动度量 | CI 自动统计违规数，按棘轮约束 | 违规数增加时阻断合并；不增加时只报告 |
| C | 人工审查 | 按 [checklists.md](checklists.md) 逐项确认 | 未确认的 PR 严禁合并，未确认的版本严禁发布 |
| D | 定期审计 | 按 [12-audit.md](12-audit.md) 的周期审计 | 写入审计报告并限期整改 |

3.3.3 规则表中的“现状”列记录 2026-10-02 审查时的符合情况：“满足”“部分满足”“未满足”。未满足的规则必须在 [plan/remediation.md](../plan/remediation.md) 中有对应的整改项。规则的执行工具尚未建立时，该规则自本规范发布之日起按 C 级人工审查执行，执行工具建立后升为标注的等级。

## 4 总则

参考：ISO 9001:2015 第 4 章至第 10 章；ISO/IEC/IEEE 12207:2017 第 6.3 节；ISO/IEC 25010:2023。

### 4.1 规范体系

4.1.1 项目文档统一分为下列五类，存放于 `docs/` 下对应的目录。严禁在此之外另立规范：

| 类别 | 目录 | 性质 | 内容 |
|---|---|---|---|
| 规范 | `docs/standards/` | 规范性，强制执行 | 本规范的全部文件 |
| 规程 | `docs/procedures/` | 规范性，强制执行 | 按规范执行某项工作的操作步骤，如发布、运维 |
| 计划 | `docs/plan/` | 资料性 | 架构改造路线、规范整改路线 |
| 审计 | `docs/audits/` | 资料性，只增不改 | 审查报告、性能报告、违规基线 |
| 事件 | `docs/incidents/` | 资料性，只增不改 | 事件复盘报告 |

4.1.2 规范文件及其适用场景如下。执行任何变更前，必须阅读“何时阅读”一列所对应的文件：

| 文件 | 规则前缀 | 何时阅读 |
|---|---|---|
| [00-general.md](00-general.md) | GEN | 首次参与项目；规则之间冲突或需要例外时 |
| [01-coding.md](01-coding.md) | COD | 编写或修改任何源码时 |
| [02-architecture.md](02-architecture.md) | ARC | 新增模块、跨层引用、调整数据流时 |
| [03-data.md](03-data.md) | DAT | 修改段位存档、数据库、本地存储，或处理个人信息时 |
| [04-api.md](04-api.md) | API | 修改联机协议、服务端消息处理、HTTP 接口、错误码时 |
| [05-security.md](05-security.md) | SEC | 修改身份、令牌、Electron 配置、服务器配置，或处理外部输入时 |
| [06-testing.md](06-testing.md) | TST | 编写测试，或修改影响性能的代码时 |
| [07-operations.md](07-operations.md) | OPS | 修改 CI、发版脚本、上线脚本、日志、监控时 |
| [08-versioning.md](08-versioning.md) | VER | 确定版本号、修改协议或数据版本、升级依赖时 |
| [09-text-and-i18n.md](09-text-and-i18n.md) | I18N | 编写任何面向玩家或面向人的文字（界面、更新日志、文档）时 |
| [10-edge-cases.md](10-edge-cases.md) | EDGE | 设计新功能，或修复与网络、并发、数据损坏有关的缺陷时 |
| [11-documentation.md](11-documentation.md) | DOC | 新增或修改文档时 |
| [12-audit.md](12-audit.md) | AUD | 季度审计时 |
| [checklists.md](checklists.md) | — | 提交 PR、发布、上线前 |

4.1.3 各规范文件的执行载体为 `tests/*.test.ts`、`.githooks/*`、`.github/workflows/*` 等，必须在注释中标注所实现的规则编号（DOC-010）。

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| GEN-001 | C | 同一事项只允许在一个文件中作出规定，其他文件只允许引用该规定的编号或章节，严禁复述规定内容；`CLAUDE.md` 和 `README.md` 只保留指向本规范的引用 | 部分满足（F-36） |
| GEN-002 | C | 下级规范与本规范冲突时，以本规范为准，并必须在发现冲突后 7 日内修订下级规范 | 满足 |

### 4.2 质量目标

参考 ISO/IEC 25010:2023 产品质量模型，本项目的质量特性与可度量目标如下：

| 质量特性 | 度量 | 目标值 | 规则 |
|---|---|---|---|
| 功能适合性 | 规则与联机逻辑的测试覆盖率（行） | 核心层 ≥ 90%，服务端 ≥ 85% | TST-010 |
| 性能效率 | 渲染帧时间 p95；电脑单步思考时间 | ≤ 16.7 ms（参考机）；见 TST-041 | TST-041、TST-042 |
| 兼容性 | 受支持平台的安装、运行、联机验证通过率 | 100% | [checklists.md](checklists.md) 第 3 节 |
| 交互能力 | 三种界面语言下的文字溢出数 | 0 | I18N-020 |
| 可靠性 | 联机服务月可用率 | ≥ 99.5% | OPS-070 |
| 安全性 | 已知高危及以上漏洞的存续时间 | ≤ 30 日 | SEC-060 |
| 维护性 | COD 前缀的 B 级规则违规数 | 每月净减少，2027-03-31 前清零 | COD 全部 |
| 灵活性 | 三个平台的安装程序自动构建成功率 | 100% | OPS-020 |
| 安全保障（Safety） | 数据丢失事件 | 0 | DAT-050 |

### 4.3 存量与新增

4.3.1 新增代码必须满足本规范全部规则。

4.3.2 存量代码的违规按棘轮约束：违规数基线在整改项 P1-01 完成时写入 `docs/audits/baseline.json`；此后任何 PR 不得使任一 B 级规则的违规数增加。

4.3.3 修改存量文件时，必须同时消除被修改函数内的全部违规，即“修改即整改”。被修改函数超过 COD-037 的长度上限时，允许另开 `refactor:` PR 整改，但必须在 14 日内完成。

### 4.4 例外

4.4.1 任何规则的例外必须在违规处以注释声明，格式统一为：

```ts
// 例外 COD-051：WebGL 扩展对象没有类型定义，在此一处转换
```

4.4.2 例外声明必须包含规则编号和不少于 8 个汉字或 4 个英文单词的原因。没有例外声明的违规一律视为不合规。

4.4.3 例外总数由 CI 统计并纳入棘轮。单条规则的例外数超过 5 处时，必须在季度审计中评估是修改规则还是整改代码。

4.4.4 等级为 A 的安全类规则（SEC 前缀）严禁以注释声明例外，确需例外时必须修订本规范。

### 4.5 协作与审查

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| GEN-010 | C | PR 的审查方式按待决策事项 D-1 的结论执行。D-1 决定之前，涉及安全（SEC）、数据格式（DAT）、联机协议（API-004 至 API-006）的 PR，AI 协作者在合并前必须向项目所有者逐项说明变更要点 | 未满足（F-16） |
| GEN-011 | C | AI 协作者执行生产环境操作（重启服务、修改服务器配置、删除或修改数据）前，必须向项目所有者说明操作内容与影响，经确认后执行；已写入上线脚本并经批准的流程（`npm run deploy`）在无活跃对局时除外 | 满足 |
| GEN-012 | C | AI 协作者安装依赖、下载文件、在项目目录之外写入文件前，必须说明文件、来源与大小，经项目所有者同意后执行 | 满足 |

### 4.6 规范的修订

4.6.1 本规范的修订必须通过 PR 进行，PR 标题类型为 `docs`，并在文件版本号上按语义化版本递增：新增或删除规则递增第二位，措辞修改递增第三位。

4.6.2 每次修订必须在本文件第 5 章的修订记录中写明修订日期、版本、修订内容摘要。

4.6.3 新增 A 级或 B 级规则时，必须在同一 PR 中提交对应的执行载体，或在 [plan/remediation.md](../plan/remediation.md) 中登记整改项和期限。

## 5 修订记录

| 版本 | 日期 | 修订内容 |
|---|---|---|
| 1.0 | 2026-10-02 | 首次发布：审查 16 项既有规范，记录 38 项发现；建立 13 个领域的规则；登记整改路线图与待决策事项 |
| 1.1 | 2026-10-02 | 按领域拆分为 `docs/standards/` 下的 14 个文件；审查报告移至 `docs/audits/`，整改路线图移至 `docs/plan/`；原 `STYLE.md` 并入 `09-text-and-i18n.md`，原 `RELEASE.md` 移至 `docs/procedures/release.md`；更正 4.3.3 条中的规则编号；规则编号不变 |
| 1.1.1 | 2026-10-02 | 更正 SEC-011、SEC-041：启用 TLS 后的放行端口补充 80，供 Caddy 以 HTTP 验证申请证书，与 [plan/roadmap.md](../plan/roadmap.md) 第 6 章一致；规则编号不变 |
| 1.1.2 | 2026-10-02 | 修订 API-060、API-063：下载页面可提供 `/assets/` 下以常量定义的标题图、图标与字体，CSP 增加 `font-src 'self'`，仍不允许任何脚本，使下载页面与游戏开始菜单的标题样式一致；规则编号不变 |
| 1.1.3 | 2026-10-02 | 随整改项 P1-01 至 P1-03 的实施修订措辞，使规定与执行工具一致：SEC-061 改为以 `scripts/audit.mjs` 按分发范围检查漏洞（本项目的依赖都是开发依赖，`npm audit --omit=dev` 不检查任何包）；OPS-012 的代码规范一项按棘轮执行，各项检查改为引用规则编号；COD-006 写明不格式化的文件范围；TST-010 写明覆盖率的统计范围；检查清单第 1 节第 2 项补充格式、棘轮与覆盖率检查；规则编号不变 |
| 1.1.4 | 2026-10-03 | 修订 [02-architecture.md](02-architecture.md) 第 1.1 条：main 层允许使用 `preact`，只用于把界面挂到页面上。整改项 P1-16 实施第三方包检查时发现入口 `src/main.tsx` 以 `preact` 的 `render` 挂载界面；把这一调用移入 ui 层后，入口的改动行无法被单元测试覆盖（TST-011），故修订规定而不改代码；规则编号不变 |
