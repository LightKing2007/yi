# 弈 · 升级演练记录（2026-11-02，数据库结构 1 升 5）

| 项目 | 内容 |
|---|---|
| 演练日期 | 2026-11-02（北京时间） |
| 依据 | [ops.md](../procedures/ops.md) 第 8.1 条（打开账号功能前须通过 4.0 的数据库升级与恢复演练）；[next-development.md](../plan/next-development.md) 批次 G |
| 参与 | Claude（本机执行）。为赶当晚上线，未下载线上备份，以本机构造的 3.1.0 数据库代替（第 2.2 条）；游客数据按项目所有者 2026-11-02 的决定不做认领 |
| 对象 | 以 v3.1.0 源码打包的服务端建立的数据库（第 3 版协议的两名游客下完一局排位赛）；待发布的 `main` 提交 `32c925f` 打包的服务端 |
| 结论 | 通过：结构由第 1 版升到第 5 版，原有各表的数据完整保留、完整性检查通过；打开账号功能后正常启动；3.1.0 拒绝打开升级后的数据库，恢复升级前的备份后 3.1.0 正常启动 |
| 性质 | 资料性，只增不改 |

## 1 步骤与结果

| 步骤 | 做法 | 结果 |
|---|---|---|
| 1 建立 3.1.0 的数据库 | v3.1.0 的服务端以 `YI_DB` 指向临时文件启动，两个第 3 版客户端匹配排位并下完一局（五连） | `users` 2、`devices` 2、`ratings` 2、`games` 1、`rating_changes` 2；`/healthz` 为 3.1.0、协议 3 |
| 2 备份 | 停止服务端后复制数据库文件 | 备份的 SHA-256 前缀 `e69775566a4625ed` |
| 3 以 4.0 启动 | `main` 的服务端（账号功能关闭）以同一文件启动 | 日志依次为 `db.migrating`、`db.migrated`（“由版本 1 升到 5”）、`db.opened`、`server.start`；`meta.schema_version` 为 5，新增 `accounts`、`consents`、`sessions`、`auth_limits`、`email_challenges`；原有各表条数不变，`PRAGMA integrity_check` 为 ok；`/healthz` 协议 4 |
| 4 打开账号功能 | 以只用于本次的随机密钥与格式合格的发信配置（`scripts/test-accounts.mjs`，不发信）在升级后的副本上启动 | 日志出现 `account.enabled`；`GET /api/v1/consents/required` 返回 200 |
| 5 旧版打开新库 | v3.1.0 的服务端以升级后的文件启动 | 写 `db.open-failed` 后退出，不提供服务 |
| 6 恢复 | 以第 2 步的备份替换数据库文件，再以 v3.1.0 启动 | `db.opened`、`server.start`，`/healthz` 为 3.1.0 |
| 7 清理 | 临时目录中的数据库、备份与凭据移至废纸篓 | 已清理 |

## 2 对上线的要求

2.1 第 5 步说明：4.0 一旦启动即把线上数据库升到第 5 版，此后切回 3.1.0（上线脚本的自动回滚 OPS-046、OPS-047，或手动的 `npm run deploy -- rollback`）时，3.1.0 无法启动。上线前须先手工备份一次（`systemctl start yi-backup`）；4.0 启动迁移前也会自动留存 `backup/pre-migrate-4.0.0-时间.db`。

2.2 4.0 上线后须回到 3.1.0 时，按以下顺序执行，严禁在 `current` 仍指向 4.0 时启动服务端（4.0 会把恢复的第 1 版数据库再次升到第 5 版）：

1. 按 [ops.md](../procedures/ops.md) 第 3.2 条第 2 项停止服务端（服务端已停止或已被自动回滚而起不来时跳过）；
2. 按第 3.2 条第 3 项，把 `yi.db` 连同 `yi.db-wal`、`yi.db-shm` 移到新建的目录中留存；
3. 按第 3.2 条第 4 项，以上线前的手工备份或 `pre-migrate-4.0.0-时间.db` 作为数据库；
4. `current` 仍指向 4.0 时执行 `npm run deploy -- rollback`：切到 3.1.0 并立即启动；已被自动回滚、`current` 已指向 3.1.0 时，执行 `ssh root@yi.lightking.com.cn systemctl start yi`。不执行第 3.2 条第 5 项；
5. 按第 3.2 条第 5 项的检查核对：健康检查返回 3.1.0，日志中有 `db.opened`、`server.start`，无 `db.open-failed`。

2.3 本次演练以本机构造的数据库代替线上备份，未覆盖线上数据的规模与内容；线上数据库在 2026-10-29 的恢复演练中为 `users` 3、`devices` 3、其余 0 条（[2026-10-29-restore-drill.md](2026-10-29-restore-drill.md)），结构与本次相同。
