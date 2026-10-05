# 弈 · 运维规程

| 项目 | 内容 |
|---|---|
| 性质 | 规程，强制执行；依据 [07-operations.md](../standards/07-operations.md)、[03-data.md](../standards/03-data.md)、[05-security.md](../standards/05-security.md) |
| 文件版本 | 1.1.3 |
| 修订日期 | 2026-10-05 |
| 适用范围 | 线上服务器 47.108.181.240 的日常检查、备份与恢复、回滚、应急处置 |
| 相关文档 | [release.md](release.md)（发版与上线）、[README.md](../../README.md) 第 5.3、5.4 节（部署结构） |

本规程只规定操作步骤。各步骤须满足的要求以规则编号引用，规则内容以 `docs/standards/` 为准。文中 `ssh yi` 指 `ssh root@47.108.181.240`；本机命令在仓库根目录执行。

## 1 服务器概况

1.1 部署结构见 [README.md](../../README.md) 第 5.3 节，要点如下：

| 位置 | 内容 |
|---|---|
| `/opt/yi/current`、`/opt/yi/previous` | 指向当前与上一版本目录 `/opt/yi/releases/版本号/` 的符号链接（OPS-043） |
| `/etc/systemd/system/yi.service` | 常驻服务，源文件为仓库中的 `scripts/server/yi.service`，原文件备份为 `/opt/yi/yi.service.prev`（SEC-045） |
| `/var/lib/yi/yi-ratings.json` | 段位存档；每次写盘前上一版另存为 `yi-ratings.json.prev`（DAT-054） |
| `/var/lib/yi/backup/` | 每日本地备份，保留 7 份，每份附 `.sha256`（DAT-061、DAT-064） |
| 阿里云 OSS 存储桶 | 异地加密备份：`daily/` 下为每日一份（保留 30 日），`monthly/` 下为每月一份（保留 365 日），均以 age 加密（DAT-061、DAT-063） |
| `/var/lib/yi/deploy.log` | 上线、回滚及配置修改的记录（OPS-048）；`deploy-last.log` 为最近一次上线的完整输出 |

1.2 服务器上的改动统一经 `npm run deploy` 的各子命令执行。本规程第 3 章、第 5 章中须手工执行的步骤，执行前必须先手工备份存档（DAT-066），执行后必须按第 6.1 条追加部署日志。

## 2 日常检查

2.1 告警建立自动通知前（OPS-074），维护者每日检查一次，结果为空或已处理（OPS-075、DAT-064）：

| 项目 | 命令 | 正常结果 |
|---|---|---|
| 服务状态与版本 | `npm run deploy -- status` | 显示当前版本号与提交号，且与最新 Release 一致 |
| 服务端警告及以上 | `ssh yi journalctl -u yi -p warning --since yesterday --no-pager` | 无输出，或均已处理 |
| 备份任务 | `ssh yi journalctl -u yi-backup --since yesterday --no-pager -o cat` | 有一行“段位存档已备份到……”，无“备份失败” |
| 异地备份 | `ssh yi journalctl -u yi-offsite --since yesterday --no-pager -o cat` | 有一行“异地备份已上传……”，无“异地备份失败” |
| 上线过程的错误 | `ssh yi journalctl -t yi-deploy --since yesterday --no-pager -o cat` | 无输出；有 `deploy.rolled-back` 时按第 5.3 条处理 |
| 磁盘 | `ssh yi df -h /` | 使用率 < 80%（OPS-074） |

2.2 发现异常时，按第 5 章判定事件级别并处置。

## 3 备份与恢复

3.1 备份由 `yi-backup.timer` 每天北京时间 04:30 前后自动执行，成功后由 `yi-offsite.service` 加密上传到 OSS，无须人工操作。手工备份一次（含异地备份）：

```bash
ssh yi systemctl start yi-backup.service
```

3.2 以下情况须从备份恢复段位存档：服务端因存档损坏拒绝启动（退出码 65 或 74，事件码 `store.load-failed`，DAT-050）；存档内容被误改。恢复步骤如下：

1. 选定恢复来源，按优先次序为：`/var/lib/yi/yi-ratings.json.prev`（上一次写盘前的版本）、`/var/lib/yi/backup/` 中最新的一份、退出前写盘失败时转储的 `/var/lib/yi/emergency-时间.json`（事件码 `store.dumped`）、OSS 上的异地备份（按第 3.3 条取得）。从备份恢复时先核对校验和：

   ```bash
   ssh yi 'cd /var/lib/yi/backup && ls && sha256sum -c yi-ratings-时间.json.sha256'
   ```

2. 服务端仍在运行时，先让对局结束再停止：执行 `ssh yi systemctl kill -s SIGUSR2 yi` 进入维护模式，以 `npm run deploy -- status` 查看活跃对局数，归零后执行 `ssh yi systemctl stop yi`。服务端已因存档损坏停止时，跳过本项；
3. 手工备份现有存档（DAT-066），原文件保持不动：

   ```bash
   ssh yi 'cd /var/lib/yi && cp -p yi-ratings.json yi-ratings.json.before-restore-$(date -u +%Y%m%dT%H%M%SZ)'
   ```

4. 以恢复来源替换存档，属主与权限不变：

   ```bash
   ssh yi install -o yi -g yi -m 600 /var/lib/yi/backup/yi-ratings-时间.json /var/lib/yi/yi-ratings.json
   ```

5. 启动并检查：执行 `ssh yi systemctl start yi`，再执行 `npm run deploy -- status`，健康检查返回当前版本，且 `ssh yi journalctl -u yi -n 20 --no-pager -o cat` 中有 `server.start`、无 `store.load-failed`；
6. 按第 6.1 条记入部署日志，操作为 `config`，版本一栏写恢复来源的文件名。

3.3 服务器上的文件不可用时，从 OSS 的异地备份恢复：在阿里云控制台的 OSS 存储桶中下载 `daily/` 下最新的 `.age` 文件，在本机仓库根目录解密（私钥文件只在本机，DAT-063）：

```bash
npm run offsite -- decrypt 下载的文件.age 私钥文件 ~/Downloads/yi-ratings.json
```

输出文件须在项目目录以外，脚本会拒绝写入项目目录（段位数据的明文可能被误提交）。脚本确认解出的内容为合法 JSON，并打出记录条数。随后以 `scp` 传到服务器的 `/var/lib/yi/backup/`，按第 3.2 条第 2 项至第 6 项恢复。恢复时间目标为 1 小时，恢复点目标为 24 小时（DAT-060）。

3.4 每季度演练一次恢复（DAT-065）：从 OSS 下载最新的异地备份，按第 3.3 条解密到本机临时目录，与服务器上同一天的本地备份比较内容，记下记录条数，结果记入 `docs/audits/`。演练不得改动服务器上的文件。

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
   | 65、74 | 存档无法解析或读取，拒绝启动（DAT-050）；systemd 不再自动重启 | 按第 3.2 条恢复存档 |
   | 78 | 环境变量取值不合法，拒绝启动（如 `YI_LOG_LEVEL`），日志中有 `server.config-invalid` | 修正 `yi.service` 或附加配置后重启 |
   | 1 | 端口无法监听（`server.listen-failed`），如端口被占用 | 以 `ss -tlnp` 找出占用端口的进程并处理 |
   | 其他 | 未预期的异常（`internal.error`） | 新版本上线后出现的，按第 4.1 条回滚；否则保留日志后重启，并建 Issue |

3. 恢复后以 `npm run deploy -- status` 确认。

5.3 上线后自动回滚（`deploy.rolled-back`，SEV2）：线上已是上一版本，不须紧急处置。查看 `ssh yi cat /var/lib/yi/deploy-last.log` 与新版本启动时的日志，找出原因，修复后发布新的修订版本。

5.4 磁盘使用率 ≥ 80%：以 `ssh yi 'du -xh --max-depth=2 / | sort -h | tail -20'` 找出占用；journald 的日志总量已限制为 1 GB（OPS-065）；`/opt/yi/releases/` 只保留两个版本。须删除文件时，先确认文件的用途，不得删除段位存档及其备份。

5.5 安装程序疑似被篡改（SEV1）：以 Release 的 `SHA256SUMS` 核对线上的安装程序：

```bash
gh release download v版本号 -p SHA256SUMS -O - | ssh yi 'cd /opt/yi/current/download && sha256sum --check --ignore-missing'
```

不一致时立即重新上线该版本（版本相同时先执行 `npm run deploy -- rollback`，再执行 `npm run deploy -- 版本号`），在下载页面与游戏内通知玩家，并按第 5.1 条复盘。

5.6 服务器疑似被入侵（SEV1）：在阿里云控制台的安全组中只保留维护者当前 IP 的 22 端口，保留现场后再排查；更换 SSH 密钥（SEC-040）；从备份恢复段位存档前，先核对备份的校验和与内容；按第 5.1 条复盘。

## 6 记录

6.1 本规程中手工执行的服务器操作，完成后必须追加一行部署日志（OPS-048），格式与上线脚本一致，为“时间 操作者 操作 版本或对象 结果”：

```bash
ssh yi 'echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) LightKing config restore-yi-ratings-时间.json ok" >> /var/lib/yi/deploy.log'
```

6.2 应急处置的经过记入对应的 Issue；复盘报告按第 5.1 条提交。
