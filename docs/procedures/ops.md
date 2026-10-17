# 弈 · 运维规程

| 项目 | 内容 |
|---|---|
| 性质 | 规程，强制执行；依据 [07-operations.md](../standards/07-operations.md)、[03-data.md](../standards/03-data.md)、[05-security.md](../standards/05-security.md) |
| 文件版本 | 1.2.0 |
| 修订日期 | 2026-10-17 |
| 适用范围 | 线上服务器 47.108.181.240 的日常检查、备份与恢复、回滚、应急处置 |
| 相关文档 | [release.md](release.md)（发版与上线）、[README.md](../../README.md) 第 5.3、5.4 节（部署结构） |

本规程只规定操作步骤。各步骤须满足的要求以规则编号引用，规则内容以 `docs/standards/` 为准。文中 `ssh deploy` 指以部署用户登录（`ssh deploy@47.108.181.240`），用于第 2 章的日常检查：部署用户属 `systemd-journal` 组，可直接查看日志，上线、重启、回滚与查看状态经 `npm run deploy` 以 sudo 白名单执行（SEC-044）；`ssh yi` 指以 root 登录（`ssh root@47.108.181.240`），只用于第 3 章至第 5 章的恢复、回滚与应急处置，以及经项目所有者同意的配置修改；本机命令在仓库根目录执行。

本规程按 3.0.0 及以后的版本编写。3.0.0 上线之前线上仍为 2.0.7，第 2 章中的“备份任务”一项与第 3 章按该版本的本规程执行（`git show v2.0.7:docs/procedures/ops.md`）。

## 1 服务器概况

1.1 部署结构见 [README.md](../../README.md) 第 5.3 节，要点如下：

| 位置 | 内容 |
|---|---|
| `/opt/yi/current`、`/opt/yi/previous` | 指向当前与上一版本目录 `/opt/yi/releases/版本号/` 的符号链接（OPS-043） |
| `/etc/systemd/system/yi.service` | 常驻服务，源文件为仓库中的 `scripts/server/yi.service`，原文件备份为 `/opt/yi/yi.service.prev`（SEC-045） |
| `/var/lib/yi/yi.db` | 数据库（WAL 模式，运行时另有 `yi.db-wal`、`yi.db-shm`），表结构见 [roadmap.md](../plan/roadmap.md) 第 5.2.2 节 |
| `/var/lib/yi/backup/` | 每小时的本地备份 `yi-UTC时间.db`，保留最新的 24 份与最近 7 天各一份，每份附 `.sha256`（DAT-061、DAT-064）；另有启动迁移前的备份 `pre-migrate-版本号-时间.db`（DAT-042） |
| 阿里云 OSS 存储桶 | 异地加密备份：`daily/` 下为每日一份（当天最新的一份，保留 30 日），`monthly/` 下为每月一份（保留 365 日），均以 age 加密（DAT-061、DAT-063） |
| `/var/lib/yi/deploy.log` | 上线、回滚及配置修改的记录（OPS-048）；`deploy-last.log` 为最近一次上线的完整输出 |
| 部署用户 `deploy`、`/usr/local/sbin/yi-deploy`、`/etc/sudoers.d/yi-deploy` | 日常运维的身份（SEC-044）：只能经 sudo 执行 root 所有的 `yi-deploy`（`scripts/server/deploy-remote.sh` 的副本），且只限 preflight、install、restart、rollback、status；由 `npm run deploy -- install-deploy-user` 以 root 安装，该脚本改动后须重新执行 |
| 用户 `admin` | 阿里云 Workbench 一键连接建立的用户，已失效、无法登录；按项目所有者 2026-10-13 的决定保留，不是可疑账号 |

1.2 服务器上的改动统一经 `npm run deploy` 的各子命令执行。本规程第 3 章、第 5 章中须手工执行的步骤，执行前必须先手工备份数据库（DAT-066），执行后必须按第 6.1 条追加部署日志。

## 2 日常检查

2.1 告警建立自动通知前（OPS-074），维护者每日检查一次，结果为空或已处理（OPS-075、DAT-064）：

| 项目 | 命令 | 正常结果 |
|---|---|---|
| 服务状态与版本 | `npm run deploy -- status` | 显示当前版本号与提交号，且与最新 Release 一致 |
| 服务端警告及以上 | `ssh deploy journalctl -u yi -p warning --since yesterday --no-pager` | 无输出，或均已处理 |
| 备份任务 | `ssh deploy journalctl -u yi-backup --since yesterday --no-pager -o cat` | 每小时一行 `db.backup-done`，无 `db.backup-failed` |
| 异地备份 | `ssh deploy journalctl -u yi-offsite --since yesterday --no-pager -o cat` | 每小时一行“异地备份已上传……”，无“异地备份失败” |
| 上线过程的错误 | `ssh deploy journalctl -t yi-deploy --since yesterday --no-pager -o cat` | 无输出；有 `deploy.rolled-back` 时按第 5.3 条处理 |
| 磁盘 | `ssh deploy df -h /` | 使用率 < 80%（OPS-074） |
| 待重启的更新 | `ssh deploy 'ls -l --time-style=long-iso /var/run/reboot-required && cat /var/run/reboot-required.pkgs'` | 文件不存在。存在时自文件的时间起 7 日内，于 23:00 至 05:00 之间、以 `npm run deploy -- status` 确认没有对局后，以 root 执行 `reboot`，随后核对服务、健康检查与站点，并按第 6.1 条追加部署日志（SEC-043、OPS-050） |

2.2 发现异常时，按第 5 章判定事件级别并处置。

## 3 备份与恢复

3.1 备份由 `yi-backup.timer` 每小时第 7 分钟自动执行（`node /opt/yi/current/server.cjs backup`）：以 `VACUUM INTO` 生成一致的快照（DAT-062），做完整性检查并统计各表的条数，写入 `/var/lib/yi/backup/yi-UTC时间.db` 及其 `.sha256`（DAT-064），保留最新的 24 份与最近 7 天各一份（DAT-061）；结果写 `db.backup-done` 日志，附校验和与各表的条数。成功后由 `yi-offsite.service` 加密上传到 OSS：`daily/yi-年月日.db.age` 为当天最新的一份，`monthly/yi-年月.db.age` 为当月最新的一份（日期为 UTC）。无须人工操作。手工备份一次（含异地备份）：

```bash
ssh yi systemctl start yi-backup.service
```

3.2 以下情况须从备份恢复数据库：服务端因数据库损坏拒绝启动（退出码 65 或 74，事件码 `db.open-failed`）；数据被误改。恢复会丢失备份时刻之后的变化（RPO ≤ 1 小时，DAT-060），步骤如下：

1. 选定恢复来源，按优先次序为：`/var/lib/yi/backup/` 中最新的一份 `yi-时间.db`、OSS 上的异地备份（按第 3.3 条取得）。`backup/` 中的 `pre-migrate-版本号-时间.db` 是该版本启动时迁移前的备份，只在回到迁移前的版本时使用。从备份恢复时先核对校验和：

   ```bash
   ssh yi 'cd /var/lib/yi/backup && ls && sha256sum -c yi-时间.db.sha256'
   ```

2. 服务端仍在运行时，先让对局结束再停止：执行 `ssh yi systemctl kill -s SIGUSR2 yi` 进入维护模式，以 `npm run deploy -- status` 查看活跃对局数，归零后执行 `ssh yi systemctl stop yi`。服务端已因数据库损坏停止时，跳过本项；
3. 把现有的数据库连同 `yi.db-wal`、`yi.db-shm` 一并移到新建的目录中留存（DAT-066）。WAL 文件中可能有尚未写回数据库的数据，必须与数据库放在一起；不移走而直接替换数据库时，旧的 WAL 会被套用到恢复的数据库上：

   ```bash
   ssh yi 'cd /var/lib/yi && d=before-restore-$(date -u +%Y%m%dT%H%M%SZ) && mkdir -m 700 $d && for f in yi.db yi.db-wal yi.db-shm; do if [ -e $f ]; then mv $f $d/; fi; done && chown -R yi:yi $d && ls $d'
   ```

4. 以恢复来源作为数据库，属主为 `yi`、权限 600：

   ```bash
   ssh yi install -o yi -g yi -m 600 /var/lib/yi/backup/yi-时间.db /var/lib/yi/yi.db
   ```

5. 启动并检查：执行 `ssh yi systemctl start yi`，再执行 `npm run deploy -- status`，健康检查返回当前版本，且 `ssh yi journalctl -u yi -n 20 --no-pager -o cat` 中有 `db.opened`、`server.start`，无 `db.open-failed`。备份时尚未终局的对局在启动时记为服务端放弃（`db.games-aborted`）；
6. 按第 6.1 条记入部署日志，操作为 `config`，版本一栏写恢复来源的文件名。

3.3 服务器上的文件不可用时，从 OSS 的异地备份恢复：在阿里云控制台的 OSS 存储桶中下载 `daily/` 下最新的 `.age` 文件，在本机仓库根目录解密（私钥文件只在本机，DAT-063）：

```bash
npm run offsite -- decrypt 下载的文件.age 私钥文件 ~/Downloads/yi.db
```

输出文件须在项目目录以外，脚本会拒绝写入项目目录（数据库的明文可能被误提交）。脚本对解出的数据库做完整性检查，打出各表的条数与 SHA-256；未通过时删除输出文件并报错。随后以 `scp` 传到服务器的 `/var/lib/yi/backup/`，按第 3.2 条第 2 项至第 6 项恢复。恢复时间目标为 1 小时（DAT-060）。

3.4 每季度演练一次恢复（DAT-065）：从 OSS 下载最新的日备，按第 3.3 条解密到本机临时目录；以打出的 SHA-256 在服务器的备份日志中找到对应的一次备份，核对各表的条数一致：

```bash
ssh deploy "journalctl -u yi-backup --since -2days --no-pager -o cat | grep 解密打出的SHA-256"
```

结果记入 `docs/audits/`，演练后删除本机解出的文件。演练不得改动服务器上的文件。

## 4 回滚

4.1 新版本出现 OPS-047 所列情况之一时，立即回滚，服务端、安装程序与 `YI_LATEST` 一并恢复为上一版本（OPS-044），步骤见 [release.md](release.md) 第 6.5 条：

```bash
npm run deploy -- rollback
```

4.2 上线时健康检查不通过的，或上线后 60 分钟内上线脚本的检查发现重启过频、健康检查连续失败、内部错误占比过高的，已自动回滚（OPS-046、OPS-047），部署日志中结果为 `rolled-back`（后者的操作者为 `watch`）。以 `npm run deploy -- status` 确认版本后，按第 5 章判定事件级别。上线 60 分钟以后出现 OPS-047 所列情况的，由每日检查（第 2 章）发现后按第 4.1 条手动回滚。

4.3 安装 `yi.service` 后服务异常、而安装脚本未能自动恢复的，以原文件恢复后重启：

```bash
ssh yi 'cp -p /opt/yi/yi.service.prev /etc/systemd/system/yi.service && systemctl daemon-reload'
npm run deploy -- restart
```

完成后按第 6.1 条记入部署日志，并开 PR 修正仓库中的 `scripts/server/yi.service`。

## 5 应急处置

5.1 事件级别、响应时限与复盘要求见 [07-operations.md](../standards/07-operations.md) 第 7 节：SEV1 30 分钟内、SEV2 4 小时内开始处理；SEV1、SEV2 事件必须建标签为 `incident` 的 Issue，并提交复盘报告 `docs/incidents/YYYY-MM-DD-标题.md`（OPS-080），复盘统一采用无责原则（OPS-081）。

5.2 服务端停止或不断重启（SEV1）：

1. 查看状态与最近的日志：`ssh yi 'systemctl status yi --no-pager; journalctl -u yi -n 50 --no-pager -o cat'`；
2. 按退出码处置：

   | 退出码 | 含义 | 处置 |
   |---|---|---|
   | 65、74 | 数据库无法打开、已损坏、结构版本高于程序支持或迁移失败，拒绝启动（`db.open-failed`）；systemd 不再自动重启 | 新版本上线后出现的，按第 4.1 条回滚；否则按第 3.2 条恢复数据库 |
   | 78 | 环境变量取值不合法，拒绝启动（如 `YI_LOG_LEVEL`），日志中有 `server.config-invalid` | 修正 `yi.service` 或附加配置后重启 |
   | 1 | 端口无法监听（`server.listen-failed`），如端口被占用 | 以 `ss -tlnp` 找出占用端口的进程并处理 |
   | 其他 | 未预期的异常（`internal.error`） | 新版本上线后出现的，按第 4.1 条回滚；否则保留日志后重启，并建 Issue |

3. 恢复后以 `npm run deploy -- status` 确认。

5.3 上线后自动回滚（`deploy.rolled-back`，SEV2）：线上已是上一版本，不须紧急处置。查看 `ssh yi cat /var/lib/yi/deploy-last.log` 与新版本启动时的日志，找出原因，修复后发布新的修订版本。

5.4 磁盘使用率 ≥ 80%：以 `ssh yi 'du -xh --max-depth=2 / | sort -h | tail -20'` 找出占用；journald 的日志总量已限制为 1 GB（OPS-065）；`/opt/yi/releases/` 只保留两个版本。须删除文件时，先确认文件的用途，不得删除数据库及其备份。

5.5 安装程序疑似被篡改（SEV1）：以 Release 的 `SHA256SUMS` 核对线上的安装程序：

```bash
gh release download v版本号 -p SHA256SUMS -O - | ssh yi 'cd /opt/yi/current/download && sha256sum --check --ignore-missing'
```

不一致时立即重新上线该版本（版本相同时先执行 `npm run deploy -- rollback`，再执行 `npm run deploy -- 版本号`），在下载页面与游戏内通知玩家，并按第 5.1 条复盘。

5.6 服务器疑似被入侵（SEV1）：在阿里云控制台的安全组中只保留维护者当前 IP 的 22 端口，保留现场后再排查；更换 SSH 密钥（SEC-040）；从备份恢复数据库前，先核对备份的校验和与内容；按第 5.1 条复盘。

## 6 记录

6.1 本规程中手工执行的服务器操作，完成后必须追加一行部署日志（OPS-048），格式与上线脚本一致，为“时间 操作者 操作 版本或对象 结果”：

```bash
ssh yi 'echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) LightKing config restore-yi-时间.db ok" >> /var/lib/yi/deploy.log'
```

6.2 应急处置的经过记入对应的 Issue；复盘报告按第 5.1 条提交。
