# 弈 · 构建、部署与运维规范

| 项目 | 内容 |
|---|---|
| 所属 | 弈 · 工程规范（YI-STD-001），总则见 [00-general.md](00-general.md) |
| 文件版本 | 1.1.6 |
| 修订日期 | 2026-10-05 |
| 规则前缀 | `OPS` |

参考：ISO/IEC/IEEE 12207:2017 第 6.4.10 节至第 6.4.13 节；ISO/IEC 20000-1:2018；ISO/IEC 27035-1:2023；GB/T 20986—2023；RFC 3339；RFC 5424；SLSA v1.0。

## 1 版本控制与提交

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| OPS-001 | A | 提交说明与 PR 标题统一为约定式提交格式 `类型(范围): 说明`，类型限于 `feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`ci`、`build`、`chore`、`revert`、`release` | 满足 |
| OPS-002 | A | 提交说明首行 ≤ 72 个字符（一个汉字按 2 个字符计）；正文与首行之间空一行 | 部分满足（未检查长度） |
| OPS-003 | A | 合并到 `main` 统一采用压缩合并；合并后的提交说明首行统一为 PR 标题加 `(#PR 编号)` | 满足 |
| OPS-004 | A | 每个 PR 只包含一个主题；变更行数（不含锁文件、字体、图像）≤ 800 行，超出时必须拆分，或在 PR 说明中写明不可拆分的理由 | 满足 |
| OPS-005 | A | 严禁直接推送 `main`；唯一例外为 `npm run release` 推送的 `release: v版本号` 提交与标签 | 部分满足（F-05） |
| OPS-006 | A | CI 在每次推送到 `main` 后必须校验提交来源：提交说明首行以 `(#数字)` 结尾，或匹配 `^release: v\d+\.\d+\.\d+$`；不满足时 CI 失败，并必须在 24 小时内说明原因 | 未满足 |

## 2 持续集成

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| OPS-010 | A | 工作流中引用的第三方 Action 必须固定到完整的 40 位提交 SHA，并以注释标明版本号；Dependabot 负责更新 | 未满足（F-27） |
| OPS-011 | A | 每个工作流必须声明顶层 `permissions: contents: read`，需要更高权限的 job 单独声明 | 部分满足（`release.yml` 的 publish 已声明，`ci.yml` 未声明） |
| OPS-012 | A | PR 的 CI 必须依次执行以下检查，任一失败即阻断合并：格式检查（Prettier `--check`，COD-006）→ 代码规范（ESLint 与 jscpd；存量违规清零前按 OPS-015 的棘轮执行，任一项违规数增加即阻断，清零后改为 ESLint `--max-warnings 0`）→ 类型检查 → 测试与覆盖率（TST-010、TST-011）→ 前端构建 → 服务端构建 → 依赖漏洞（SEC-061）→ 许可证检查（COD-071）→ 密钥扫描（SEC-050）→ PR 标题格式 | 部分满足（只有类型检查、测试、构建、标题） |
| OPS-013 | A | 每个 job 必须声明 `timeout-minutes`：检查类 ≤ 15，打包类 ≤ 30 | 满足 |
| OPS-014 | A | CI 必须使用 `.nvmrc` 指定的 Node.js 版本；服务器上的 Node.js 主版本必须与之相同 | 满足 |
| OPS-015 | B | B 级规则的违规数由 CI 统计并与 `docs/audits/baseline.json` 比较，任一项增加即阻断 | 未满足 |
| OPS-016 | A | `main` 上的 CI 失败时，必须在 4 小时内修复或回退引起失败的提交；修复前严禁合并其他 PR | 满足（未成文） |

## 3 发布

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| OPS-020 | A | 发布统一由 `npm run release -- 版本号` 发起，严禁手工修改版本号或手工打标签（紧急修复见 OPS-028） | 满足 |
| OPS-021 | A | 发版脚本必须依次检查以下事项，任一不满足即中止：在 `main` 上；工作区干净；与远端一致；版本号递增且符合 VER-002；标签不存在；更新日志与译文齐全；`HEAD` 提交在 CI 上的结论为成功 | 满足（P1-10，#70：发版脚本查询 CI 在该提交上的结论） |
| OPS-022 | A | 推送标签后，Release 工作流必须先核对标签与 `package.json` 版本一致、更新日志存在，再打包 | 满足 |
| OPS-023 | A | 新版本统一以草稿形式创建，经人工核对附件与说明后才允许发布；严禁自动发布 | 满足 |
| OPS-025 | A | 发布前，`HEAD` 提交的 CI 必须已成功完成；发版脚本以 `gh run list --commit` 查询，结论不是 `success` 时中止 | 满足（P1-10，#70） |
| OPS-028 | A | 紧急修复统一由 `npm run release -- 版本号 --hotfix` 在 `hotfix/*` 分支上发起，脚本强制只允许递增修订号，发布后必须在 24 小时内开 PR 合回 `main` | 满足（P1-10，#70：`npm run release -- 版本号 --hotfix`；CI 在 `hotfix/**` 推送后运行） |
| OPS-030 | A | Release 工作流必须生成 `SHA256SUMS`，并作为附件发布 | 满足（P1-10，#68；首次实际运行为 2.0.5 发版） |
| OPS-031 | A | 上线脚本下载附件后，必须逐一核对 `SHA256SUMS`，任一不符即中止 | 满足（P1-10，#69：下载后与传到服务器后各核对一次） |
| OPS-032 | A | Release 工作流必须以 `npm sbom --sbom-format cyclonedx` 生成软件物料清单，并作为附件发布 | 满足（P1-10，#68：`npm sbom`，CycloneDX） |
| OPS-033 | A | 构建必须可复现：同一提交在同一 Node.js 版本下两次构建的前端与服务端产物逐字节相同（不含时间戳）；构建过程中严禁访问 `package-lock.json` 以外的依赖来源 | 未知 |

## 4 上线与回滚

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| OPS-040 | A | 上线统一由 `npm run deploy -- 版本号` 执行，只接受已发布（非草稿）的 Release；严禁手工替换服务器上的文件 | 满足 |
| OPS-041 | A | 上线脚本必须在服务器上以 `flock /run/yi-deploy.lock` 加锁，同一时间只允许一个上线过程 | 满足（P1-09，#75） |
| OPS-042 | A | 上线版本低于线上版本时，必须以 `--allow-downgrade` 显式确认，否则中止 | 满足（P1-09，#75、#76：上传前与加锁后各检查一次） |
| OPS-043 | A | 上线前必须把以下内容作为一个整体备份为 `/opt/yi/releases/版本号/`：服务端文件、安装程序、`YI_LATEST` 的值；线上目录统一以符号链接 `/opt/yi/current` 指向当前版本。`YI_LATEST` 的值存于版本目录中的 `env` 文件，`yi.service` 以 `EnvironmentFile` 读取；服务器上只保留当前与上一版本的目录，更早的随上线删除 | 满足（P1-09，#75；2026-10-05 服务器改为版本目录） |
| OPS-044 | A | 回滚必须恢复上一版本的服务端文件、安装程序、`YI_LATEST` 三者；回滚本身必须在 10 分钟内完成。回滚统一由 `npm run deploy -- rollback` 执行：`/opt/yi/current` 指回上一版本目录后立即重启，不等待对局结束，重启后按 OPS-046 检查 | 满足（P1-09，#75、#76：`npm run deploy -- rollback`） |
| OPS-045 | A | 重启前必须读取 `/healthz` 中的活跃对局数：为 0 时立即重启；不为 0 时进入维护模式（不再接受新的配对与开房，向在线玩家下发维护通知），等待活跃对局数归零后重启，最长等待 30 分钟，超时后强制重启，并向剩余对局下发 `1001` 关闭码。维护模式统一由 `systemctl kill -s SIGUSR2 yi` 开启，只能以重启结束；开启时取消排队与待确认的配对，此后拒绝排队、开房、加入房间与再来一局（`server.maintenance`），已开始的对局照常进行；维护通知同时下发给此后上线的玩家 | 满足（P1-09，#73 维护模式，#75 上线时等待对局结束） |
| OPS-046 | A | 重启后 30 秒内，`/healthz` 必须返回 200，且其中的版本号与提交号等于目标版本；否则自动回滚到上一版本，写 `deploy.rolled-back` 日志，并在 `deploy.log` 中记结果为 `rolled-back` | 满足（P1-09，#75；2026-10-05 首次以此上线 2.0.5） |
| OPS-047 | A | 以下任一情况发生时，必须在 10 分钟内回滚：服务进程 5 分钟内重启 ≥ 3 次；E5 错误占全部消息的比例 5 分钟内 ≥ 1%；健康检查失败；同一新版本收到 ≥ 3 名玩家报告的同一严重问题 | 部分满足（健康检查失败时自动回滚；重启次数与 E5 比例的监测待 OPS-071、OPS-074） |
| OPS-048 | A | 服务器上的每次上线、回滚、配置修改，必须追加一行记录到 `/var/lib/yi/deploy.log`：时间（RFC 3339）、操作者、操作、版本、结果 | 满足（P1-09，#75：上线、重启、回滚与配置修改各记一行） |
| OPS-050 | C | 除紧急修复外，上线时间统一为北京时间 23:00 至次日 05:00（在线玩家最少的时段；有活跃对局时按 OPS-045 等待对局结束） | 满足（未成文） |
| OPS-052 | A | 进程收到 `SIGTERM` 后，必须在 10 秒内完成：停止接受新连接；向全部连接发送 1001；落盘；退出 | 满足（P1-09，#73：以 1001 断开全部连接） |

## 5 日志

5.1 服务端日志统一为 JSON Lines，每行一个对象。下表以外的字段为事件的附加字段（本文件第 8 节），与下表的字段处于同一层级。字段如下：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `ts` | 字符串 | 是 | RFC 3339 UTC 时间，精确到毫秒，如 `2026-10-02T01:42:17.123Z` |
| `level` | 字符串 | 是 | `error`、`warn`、`info`、`debug` 之一，对应 RFC 5424 的 3、4、6、7 级 |
| `event` | 字符串 | 是 | 事件码，`领域.动作` 格式，见本文件第 8 节 |
| `msg` | 字符串 | 否 | 中文说明，≤ 200 字符 |
| `ver` | 字符串 | 是 | 服务端版本号与提交号，如 `2.0.2+8312961` |
| `playerId`、`roomId`、`gameId` | 整数 | 否 | 关联的玩家、房间、对局编号 |
| `errorId` | 字符串 | 否 | E5 错误的 UUID v4 |
| `err` | 对象 | 否 | `{ name, message, stack }`，仅 `error` 级别 |
| `durMs` | 数值 | 否 | 耗时（毫秒） |
| `truncated` | 布尔 | 否 | 该行超过 8 KB 而被截断时为 `true`（OPS-063） |
| `suppressed` | 整数 | 否 | 汇总行中被合并的行数（OPS-063） |

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| OPS-060 | A | 服务端日志统一按第 5.1 条的格式输出到标准输出，由 journald 收集；严禁写入其他文件。在 systemd 之下运行（存在环境变量 `JOURNAL_STREAM`）时，每行前加 sd-daemon 约定的 `<级别号>` 前缀（error 为 3，warn 为 4，info 为 6，debug 为 7），由 journald 去除并记为该行的优先级，使 `journalctl -p` 按级别筛选可用（OPS-075）；journald 中保存的仍是第 5.1 条格式的 JSON | 满足（P1-08，#63、#64；线上随 2.0.5 上线生效） |
| OPS-061 | A | 机器生成的时间戳统一为 UTC；面向人的日期（发布日期、审计报告）统一为北京时间（UTC+08:00），格式为 `YYYY-MM-DD` | 满足（P1-08：日志时间为 UTC 毫秒，#63） |
| OPS-062 | A | 生产环境的日志级别统一为 `info`；需要 `debug` 时以环境变量 `YI_LOG_LEVEL=debug` 临时开启，排查结束后 24 小时内必须关闭 | 满足（P1-08：`YI_LOG_LEVEL`，不合法时拒绝启动，#64） |
| OPS-063 | A | 单行日志 ≤ 8 KB，超出部分截断并加 `"truncated": true`；同一事件码每秒 ≤ 100 行，超出部分合并为一条带计数的汇总：汇总行沿用该事件码与级别，以 `suppressed` 记被合并的行数，在该秒结束后输出 | 满足（P1-08，#63） |
| OPS-064 | A | 日志严禁包含 L4 数据；L3 数据必须脱敏（DAT-073）；昵称（L1）允许记录 | 满足 |
| OPS-065 | A | journald 必须配置 `SystemMaxUse=1G`、`MaxRetentionSec=90day` | 满足（P1-08，#65；2026-10-05 安装到服务器，见 `deploy.log`） |
| OPS-066 | A | 桌面端错误日志保留现有规则：写入 `userData/logs/yi.log`，超过 1 MB 时轮转为 `yi.old.log`，只保留这两个文件；格式改为与第 5.1 条相同的 JSON Lines | 部分满足 |
| OPS-067 | A | 客户端严禁向任何服务器上传日志、遥测或使用统计；玩家主动导出日志除外 | 满足 |

## 6 监控埋点与告警

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| OPS-070 | D | 联机服务的服务等级目标（SLO）统一为：月可用率 ≥ 99.5%（每月不可用时间 ≤ 3.6 小时），计划内维护不计入，但每月计划内维护 ≤ 2 小时 | 未知 |
| OPS-071 | A | 服务端必须在 `/metrics`（仅本机可访问）以 Prometheus 文本格式输出本文件第 9 节定义的指标，并每 60 秒在日志中输出一条 `metrics.snapshot` 事件 | 未满足 |
| OPS-072 | A | 指标名统一为 `yi_` 前缀的 snake_case，计数器以 `_total` 结尾，时长以 `_seconds` 结尾，字节以 `_bytes` 结尾；标签基数 ≤ 50 | 不适用 |
| OPS-073 | A | 必须配置外部可用性探测：每 60 秒请求一次下载页面，连续 3 次失败即通知维护者 | 未满足（决策项 D-4） |
| OPS-074 | A | 以下情况必须触发告警：服务进程退出；磁盘使用率 ≥ 80%；内存 ≥ `MemoryMax` 的 80%；事件循环延迟 p99 ≥ 200 毫秒持续 5 分钟；备份任务失败；证书剩余有效期 ≤ 14 日 | 未满足 |
| OPS-075 | D | 告警未建立自动通知前，维护者必须每日检查一次 `journalctl -u yi -p warning --since yesterday`，结果为空或已处理 | 未满足 |

## 7 事件管理

7.1 生产事件统一按 GB/T 20986—2023 的思路分为四级：

| 级别 | 判定条件 | 响应时限 | 复盘 |
|---|---|---|---|
| SEV1 | 联机服务完全不可用；数据丢失或泄露；安装程序被篡改 | 30 分钟内开始处理 | 72 小时内提交复盘报告 |
| SEV2 | 联机部分功能不可用（如排位无法配对）；新版本导致崩溃 | 4 小时内开始处理 | 7 日内提交复盘报告 |
| SEV3 | 单项功能异常，有替代方式 | 3 日内开始处理 | 不要求 |
| SEV4 | 显示、文字等不影响使用的问题 | 下一个版本处理 | 不要求 |

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| OPS-080 | C | SEV1、SEV2 事件必须建 Issue，并加标签 `incident`；复盘报告存入 `docs/incidents/YYYY-MM-DD-标题.md`，统一包括：时间线、影响范围、根因、处置、整改项（带期限） | 未满足 |
| OPS-081 | C | 复盘统一采用无责原则：只分析流程与系统缺陷，严禁追究个人 | 满足 |

## 8 日志事件码

| 事件码 | 级别 | 说明 | 附加字段 |
|---|---|---|---|
| `server.start` | info | 服务启动 | `ports`、`protoRange`、`dataFile` |
| `server.stop` | info | 服务停止 | `reason` |
| `server.listen-failed` | error | 端口无法监听，服务未启动 | `ports`、`err` |
| `server.config-invalid` | error | 配置校验失败，拒绝启动 | `variable`、`expected` |
| `server.maintenance` | info | 进入维护模式（OPS-045） | `games`、`players` |
| `store.load-failed` | error | 存档无法读取或解析，拒绝启动 | `file`、`err` |
| `store.write-failed` | warn、error | 写盘失败，数据保留在内存中并退避重试：连续第 1、2 次为 warn，第 3 次起为 error（DAT-052） | `file`、`attempts`、`retryMs`；error 级别另含 `err` |
| `store.write-recovered` | info | 写盘在失败后恢复成功 | `file`、`attempts` |
| `store.records-invalid` | warn | 存档中有记录损坏，已按新玩家处理，原文件另存 | `file`、`count`、`copy` |
| `store.dumped` | error | 退出前写盘失败，段位数据已转储到另一文件 | `file`、`dump` |
| `store.dump-failed` | error | 退出前写盘与转储都失败，本次运行后的段位变化丢失 | `file`、`dump`、`err` |
| `player.online` | info | 玩家上线 | `playerId` |
| `player.offline` | info | 玩家断开 | `playerId`、`code` |
| `player.resumed` | info | 玩家重连成功 | `playerId`、`roomId` |
| `match.paired` | info | 配对成功 | `mode`、`playerId`、`opponentId` |
| `room.created` | info | 开房 | `roomId`、`playerId` |
| `game.start` | info | 开局 | `roomId`、`gameId`、`kind` |
| `game.over` | info | 终局 | `roomId`、`gameId`、`winner`、`reason`、`moves` |
| `rating.changed` | info | 段位变化 | `playerId`、`before`、`after` |
| `proto.invalid` | warn | 非法消息 | `playerId`、`reason` |
| `rate.limited` | warn | 触发限流；同一连接每秒至多一行 | `playerId`、`count`（60 秒内累计的违规次数，API-045） |
| `conn.kicked` | warn | 累计违规断开 | `playerId`、`code` |
| `http.download` | info | 下载开始 | `file`、`range` |
| `deploy.done` | info | 上线完成（写入 `deploy.log`） | `version`、`commit` |
| `deploy.rolled-back` | error | 上线后健康检查不通过，已自动回滚（OPS-046）；由上线脚本以 `systemd-cat -t yi-deploy` 写入 journald，可被 `journalctl -p warning` 筛出 | `version`、`target`、`reason` |
| `metrics.snapshot` | info | 每 60 秒的指标快照 | 本文件第 9 节的全部指标 |
| `internal.error` | error | 未预期的异常 | `errorId`、`err` |

## 9 监控指标

| 指标 | 类型 | 标签 | 说明 |
|---|---|---|---|
| `yi_build_info` | gauge | `version`、`commit`、`proto` | 恒为 1 |
| `yi_connections` | gauge | — | 当前 WebSocket 连接数 |
| `yi_players_online` | gauge | — | 已握手的在线玩家数 |
| `yi_rooms_active` | gauge | `kind`、`state` | 房间数，`state` 为 `wait`、`play`、`scoring`、`over` |
| `yi_queue_waiting` | gauge | `mode`、`type` | 匹配队列中的人数 |
| `yi_games_finished_total` | counter | `kind`、`reason` | 已结束的对局数 |
| `yi_messages_total` | counter | `type` | 入站消息数 |
| `yi_errors_total` | counter | `code` | 下发的错误码数 |
| `yi_rate_limited_total` | counter | — | 触发限流的次数 |
| `yi_message_handle_seconds` | histogram | — | 单条消息处理耗时，桶为 0.001、0.005、0.01、0.05、0.1 |
| `yi_event_loop_lag_seconds` | gauge | — | 事件循环延迟 p99 |
| `yi_store_write_failures_total` | counter | — | 写盘失败次数 |
| `yi_downloads_active` | gauge | — | 进行中的下载数 |
| `process_resident_memory_bytes` | gauge | — | 常驻内存 |
