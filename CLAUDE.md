# 弈 · 协作约定

本项目的全部规范在 `docs/standards/`（工程规范 YI-STD-001），以规则编号引用（如 `API-043`）。开始任何变更前，按下表阅读与本次任务相关的文件，并遵守其中的全部规则；只读相关文件，不必通读全部。

| 任务 | 必读（均在 `docs/standards/` 下） |
|---|---|
| 任何代码变更 | `01-coding.md`、`checklists.md` 第 1 节 |
| 新增模块、跨层引用 | `02-architecture.md` |
| 段位存档、数据库、本地存储、个人信息 | `03-data.md`、`05-security.md` |
| 联机协议、服务端消息、HTTP 接口、错误码 | `04-api.md`、`10-edge-cases.md` |
| 身份、令牌、Electron 配置、服务器配置 | `05-security.md` |
| 编写测试、性能相关 | `06-testing.md` |
| CI、发版、上线、日志、监控 | `07-operations.md`，以及 `docs/procedures/release.md` |
| 版本号、依赖升级、协议或数据版本 | `08-versioning.md` |
| 界面文字、更新日志、译文、任何文档 | `09-text-and-i18n.md` |
| 新功能设计、网络或并发相关的缺陷 | `10-edge-cases.md` |
| 规则冲突、例外、规范本身的修订 | `00-general.md` |

- 流程：分支 → PR → CI 通过后压缩合并 → `npm run release` → 人工确认草稿 → `npm run deploy`，步骤见 `docs/procedures/release.md`，严禁绕过。
- 整改：`docs/plan/remediation.md` 中的整改项按期限实施，完成后更新其状态。
- 审查与授权：PR 的审查方式见 GEN-010；生产环境操作、新增依赖、下载、在项目外写入文件，必须先向项目所有者说明并取得同意（GEN-011、GEN-012）。
- 文档目录与索引：`docs/README.md`。
