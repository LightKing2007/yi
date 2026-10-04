# 弈 · 安全规范

| 项目 | 内容 |
|---|---|
| 所属 | 弈 · 工程规范（YI-STD-001），总则见 [00-general.md](00-general.md) |
| 文件版本 | 1.1.3 |
| 修订日期 | 2026-10-05 |
| 规则前缀 | `SEC` |

参考：ISO/IEC 27001:2022、ISO/IEC 27002:2022；GB/T 22239—2019（第二级）；GB/T 20984—2022；OWASP ASVS 5.0；Electron Security Checklist；CIS Ubuntu Linux 24.04 LTS Benchmark；ISO/IEC 29147:2018、ISO/IEC 30111:2019。

## 1 威胁模型

1.1 本项目按 STRIDE 方法识别的主要威胁与对应规则如下。威胁模型必须在每个主版本发布前复审：

| 资产 | 威胁 | 类别 | 对应规则 |
|---|---|---|---|
| 玩家段位 | 窃取 `uid` 冒用他人段位 | 仿冒 | SEC-010、SEC-020 |
| 玩家段位 | 刷分、对局操纵 | 篡改 | 阶段 8 反作弊 |
| 对局 | 伪造落子、重放消息 | 篡改 | API-010、API-052 |
| 联机服务 | 消息洪泛、连接耗尽 | 拒绝服务 | API-040 至 API-047 |
| 服务器主机 | SSH 爆破、服务进程被攻破后横向移动 | 权限提升 | SEC-040 至 SEC-045 |
| 段位数据 | 损坏、丢失、误删 | 篡改 / 拒绝服务 | DAT-050 至 DAT-066 |
| 安装程序 | 传输中被替换 | 篡改 | SEC-070、OPS-030 |
| 玩家主机 | 渲染进程漏洞、导航到恶意页面 | 权限提升 | SEC-030 至 SEC-036 |
| 玩家昵称 | 双向控制符伪造显示、冒充他人 | 仿冒 | API-014 |
| 个人信息 | IP、邮箱泄露 | 信息泄露 | DAT-070 至 DAT-076 |

## 2 传输安全

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| SEC-010 | A | 3.0 版本起，联机统一使用 `wss://`，HTTP 统一使用 `https://`，TLS 版本 ≥ 1.2，证书由 Caddy 自动续期；客户端严禁回退到明文连接 | 未满足（F-08，已接受风险至 3.0） |
| SEC-011 | A | 启用 TLS 后，服务端监听地址必须为 127.0.0.1，公网只开放 80、443（80 只用于证书申请与跳转至 HTTPS）；8443 端口必须在安全组与主机防火墙中同时关闭 | 不适用 |
| SEC-012 | A | 严禁在明文通道上传输口令、邮箱验证码、登录令牌；账号系统（阶段 6）必须在 SEC-010 满足之后才允许上线 | 满足 |
| SEC-013 | A | `index.html` 的 CSP 中 `connect-src` 必须收紧为生产服务器的确切地址（开发模式另行注入），严禁使用通配的 `ws:`、`wss:` | 未满足 |

## 3 身份与会话

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| SEC-020 | A | 令牌统一以 `crypto.getRandomValues` 生成，长度 ≥ 128 位；重连令牌在每次重连成功后必须轮换 | 部分满足（未轮换） |
| SEC-021 | A | 登录会话有效期 ≤ 30 日，闲置 7 日失效；修改口令后，该账号的全部会话必须立即失效 | 不适用 |
| SEC-022 | A | 令牌比较统一使用常量时间比较 `crypto.timingSafeEqual`；按令牌查找时，统一以令牌的散列为键查表，严禁线性遍历 | 未满足（F-21） |
| SEC-023 | A | 登录失败按账号与 IP 双维度限速：同一账号 15 分钟内失败 5 次锁定 15 分钟；同一 IP 每分钟 ≤ 10 次登录请求 | 不适用 |

## 4 桌面端安全

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| SEC-030 | A | 所有 `BrowserWindow` 必须设置 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true` | 满足 |
| SEC-031 | A | 必须拦截 `will-navigate` 与新窗口，只允许应用自身协议与开发服务器地址；外部链接只允许 `https:` 与 `http:`，统一交由系统浏览器打开 | 满足 |
| SEC-032 | A | 预加载脚本暴露的函数 ≤ 10 个，每个函数的参数必须在主进程中校验类型与长度；严禁暴露 `ipcRenderer` 本身 | 满足 |
| SEC-033 | A | 必须启用 Electron Fuses：`RunAsNode` 关闭、`EnableNodeOptionsEnvironmentVariable` 关闭、`EnableNodeCliInspectArguments` 关闭、`EnableEmbeddedAsarIntegrityValidation` 开启、`OnlyLoadAppFromAsar` 开启 | 未满足 |
| SEC-034 | A | 页面的 CSP 严禁含 `unsafe-eval`；`script-src` 统一为 `'self'` | 满足 |
| SEC-035 | A | 严禁加载远程代码；页面上的全部脚本与样式必须打包在 asar 中 | 满足 |
| SEC-036 | A | 只允许单实例运行（现有）；第二个实例传入的命令行参数严禁被执行 | 满足 |

## 5 服务器基线

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| SEC-040 | A | SSH 统一为 `PasswordAuthentication no`、`PermitRootLogin prohibit-password`、`KbdInteractiveAuthentication no`、`MaxAuthTries 3`；只允许 Ed25519 密钥 | 未满足（F-04） |
| SEC-041 | A | 主机防火墙（UFW）必须启用，默认拒绝入站，只放行 22、8443（启用 TLS 后改为 22、80、443）；放行清单必须与云安全组一致 | 未满足 |
| SEC-042 | A | 必须安装 fail2ban，SSH 10 分钟内失败 5 次封禁 1 小时 | 未满足 |
| SEC-043 | A | 必须启用 `unattended-upgrades` 自动安装安全更新；需要重启的内核更新，必须在 7 日内择无对局时重启 | 未知 |
| SEC-044 | C | 日常运维统一使用非 root 的部署用户 `deploy`，以 `sudo` 白名单执行 `systemctl restart yi` 等命令；root 登录只允许用于应急 | 未满足 |
| SEC-045 | A | `systemd-analyze security yi` 的评分必须 ≤ 4.0。除现有选项外，必须增加：`PrivateDevices=yes`、`ProtectKernelTunables=yes`、`ProtectKernelModules=yes`、`ProtectKernelLogs=yes`、`ProtectControlGroups=yes`、`ProtectClock=yes`、`ProtectHostname=yes`、`RestrictNamespaces=yes`、`RestrictRealtime=yes`、`RestrictSUIDSGID=yes`、`LockPersonality=yes`、`MemoryDenyWriteExecute=no`（V8 需要 JIT）、`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`、`CapabilityBoundingSet=`、`SystemCallFilter=@system-service`、`SystemCallArchitectures=native`、`UMask=0077`、`MemoryMax=512M`、`TasksMax=64`、`LimitNOFILE=65536` | 未满足（评分 8.3） |

## 6 密钥与凭据

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| SEC-050 | A | 严禁在仓库中提交任何密钥、令牌、口令、私钥、`.env` 文件；CI 必须运行密钥扫描（gitleaks），发现即阻断 | 部分满足（`.gitignore` 已排除 `.env`；未扫描） |
| SEC-051 | A | 服务器上的密钥文件权限统一为 `0600`，属主为使用它的服务用户；环境变量中的密钥统一通过 systemd 的 `LoadCredential=` 传入，严禁写入 `Environment=` | 不适用 |
| SEC-052 | A | CI 中的密钥只允许存放在 GitHub Secrets，并只授予需要它的 job；发布用的 SSH 部署密钥必须是仅能执行上线命令的受限密钥（`command=` 限制） | 不适用 |
| SEC-053 | D | 所有密钥每 365 日轮换一次；人员变动或疑似泄露时，必须在 24 小时内轮换 | 不适用 |

## 7 漏洞管理

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| SEC-060 | A | 依赖漏洞的修复期限统一为：严重 7 日、高危 30 日、中危 90 日、低危在下一次依赖升级时修复；运行时依赖与随安装程序分发的组件（Electron）不允许豁免 | 未满足（F-03） |
| SEC-061 | A | CI 必须运行 `scripts/audit.mjs`：读取 `npm audit --json` 的结果，随游戏与服务端分发的依赖（`preact`、`@preact/signals`、`ws` 及其下级依赖，以及 `electron` 包本身）存在高危及以上漏洞即阻断；其余依赖的漏洞只列出，每周汇总一次。本项目的依赖全部登记在 `devDependencies`，`npm audit --omit=dev` 不检查任何包，严禁以它代替；新增随程序分发的依赖时必须同时加入该脚本的分发范围 | 未满足 |
| SEC-062 | A | 必须启用 Dependabot（或等效工具），每周检查一次 npm 与 GitHub Actions 的更新 | 未满足 |
| SEC-063 | C | 仓库根目录必须提供 `SECURITY.md`，写明漏洞报告方式与响应时限：72 小时内确认，按 SEC-060 的期限修复，修复后 30 日内公开说明 | 未满足 |

## 8 分发完整性

| 编号 | 等级 | 规定 | 现状 |
|---|---|---|---|
| SEC-070 | A | 每个发布版本必须生成 `SHA256SUMS`，列出全部安装程序与服务端文件的 SHA-256；下载页面必须展示每个安装程序的 SHA-256 | 满足（下载页面展示 SHA-256，#15；Release 附带 `SHA256SUMS`，#68；上线核对，#69） |
| SEC-071 | C | 具备条件时，macOS 安装程序必须使用 Developer ID 签名并公证，Windows 安装程序必须使用代码签名证书签名；未签名期间，发布说明与下载页面必须写明首次打开的方法 | 部分满足 |
