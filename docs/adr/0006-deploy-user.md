# 0006 部署用户与 sudo 白名单

| 项目 | 内容 |
|---|---|
| 状态 | 接受 |
| 日期 | 2026-10-13 |
| 决定者 | 项目所有者（SEC-044 选方案 A） |
| 相关 | 整改项 P2-14；#129、#130、#131；SEC-044 |

## 1 背景

1.1 SEC-044 原文要求日常运维以非 root 的部署用户 `deploy`、经 sudo 白名单执行，root 登录只用于应急。此前全部运维都以 root 登录。

1.2 上线脚本原本把 `deploy-remote.sh` 连同文件上传到服务器，再以 root 执行这份上传的脚本。若白名单放行“以 root 执行上传的脚本”，部署用户就能执行任意命令，白名单形同虚设。

1.3 上线脚本中有一类命令安装以 root 身份运行的配置：`install-service`、`install-caddy`、`install-backup`、`install-journald`、`install-offsite`、`migrate-layout`。部署用户若能安装 systemd 单元，就能借它以 root 执行任意命令。

## 2 决策

2.1 上线、重启、回滚、查看状态以部署用户 `deploy` 登录，执行 `sudo -n /usr/local/sbin/yi-deploy <命令>`。

2.2 `yi-deploy` 为 `deploy-remote.sh` 的 root 所有的副本，部署用户不能改动；它从 sudo 设置的 `SUDO_USER` 识别出经 sudo 调用，此时只接受 preflight、install、restart、rollback、status。白名单只放行这一个文件，sudo 清空环境变量，只保留部署日志用的 `YI_OPERATOR`。

2.3 部署用户上传的文件放在其主目录下的 `incoming/`；`yi-deploy` 校验目录后，以部署用户的身份（`runuser`）逐个读出白名单内的文件名，复制到 root 所有的临时目录后才使用。

2.4 本机脚本上线前核对服务器上 `yi-deploy` 的 SHA-256 与仓库中的 `deploy-remote.sh` 一致，不一致时在上传前中止。

2.5 **方案 A**：安装或修改以 root 身份运行的配置（含 `yi-deploy` 与白名单本身，以 `install-deploy-user` 安装）仍以 root 执行，每次须经项目所有者同意；root 登录还用于应急。SEC-044 的措辞据此修订（#129）。

2.6 部署用户属 `systemd-journal` 组，可直接查看日志；只放入 root 现有的 Ed25519 公钥，不设口令。不改 sshd，root 的密钥登录照旧（SEC-040）。

## 3 备选方案

| 方案 | 不采用的原因 |
|---|---|
| 方案 B：全部命令纳入白名单 | SEC-044 字面上满足，但部署用户可借安装 systemd 单元取得 root 权限，白名单没有约束力 |
| 白名单放行 `systemctl restart yi` 等具体命令，上线的其余步骤由部署用户自己完成 | 补录时整理，当时未讨论：版本目录、符号链接与部署日志都归 root 所有，须放宽目录权限；上线的加锁、维护模式、自动回滚分散到多条命令中，难以保证原子性 |
| 维持以 root 运维 | 违反 SEC-044；本机密钥泄露即等于服务器的 root 权限泄露 |

## 4 后果

4.1 2026-10-13 经项目所有者同意以 root 安装到服务器，核对：`sudo -l` 只列出 `yi-deploy`；以部署用户执行 `npm run deploy -- status` 成功；白名单以外的命令与配置类命令均被拒。

4.2 `deploy-remote.sh` 每次改动后，须由项目所有者同意并以 root 执行 `install-deploy-user`，否则日常上线会因版本不一致而中止。

4.3 设 `YI_DEPLOY_SSH=root@…` 时仍按以 root 执行的方式上线，供应急使用。

4.4 用户 `admin`（阿里云 Workbench 一键连接建立，已失效、无法登录）按项目所有者的决定保留。
