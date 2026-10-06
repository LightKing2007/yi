# 弈 · 安全策略

本文件说明如何报告“弈”的安全漏洞，以及收到报告后的处理时限（工程规范 SEC-063）。English summary at the end.

## 1 支持的版本

只对最新发布的版本修复安全漏洞，见 [Releases](https://github.com/LightKing2007/yi/releases)。玩家的客户端连上联机服务器时会提示更新到最新版本；联机服务器始终运行最新版本。

## 2 报告方式

请通过 GitHub 的私下报告提交：[Report a vulnerability](https://github.com/LightKing2007/yi/security/advisories/new)（仓库 Security 页面中的“Report a vulnerability”）。报告只有维护者可见，后续沟通也在同一页面私下进行。

请勿在公开的 Issue、Pull Request 或讨论中披露漏洞细节。

报告中请尽量写明：

1. 受影响的版本与平台（Windows、macOS、Linux，或联机服务器）；
2. 复现步骤，或可以复现的最小示例；
3. 可能造成的影响，例如执行任意代码、读取他人的数据、篡改段位、使服务端停止响应。

## 3 范围

在范围内：

- 桌面版：各平台的安装程序与游戏本身，包括主进程、预加载脚本与页面；
- 联机服务器：WebSocket 联机服务与同一端口上的安装程序下载页面；
- 本仓库中的构建、发版与上线脚本。

不在范围内：

- 以大流量造成的拒绝服务；
- 社会工程与钓鱼；
- GitHub、阿里云等第三方平台本身的问题；
- 须事先控制玩家的计算机或操作系统账户才能实施的攻击。

测试时请只使用你自己的设备与数据，不要影响其他玩家的对局，不要访问他人的数据，也不要对联机服务器进行压测或大范围扫描；须要在服务器上验证的，请在报告中说明，由维护者配合。

## 4 处理时限

| 阶段 | 时限 |
|---|---|
| 确认收到报告 | 72 小时内 |
| 修复并发布新版本 | 严重 7 日内，高危 30 日内，中危 90 日内，低危随下一个版本（与 SEC-060 的依赖漏洞期限相同） |
| 公开说明 | 修复版本发布后 30 日内，以 GitHub 安全公告说明漏洞、影响范围与修复版本；经报告者同意后致谢 |

严重程度由维护者参照 CVSS 评估，并在确认时告知报告者。确认不构成漏洞的，同样在 72 小时内答复并说明理由。

## 5 English summary

Please report security vulnerabilities privately via GitHub: [Report a vulnerability](https://github.com/LightKing2007/yi/security/advisories/new). Do not disclose details in public issues or pull requests. Only the latest release is supported. We acknowledge reports within 72 hours, fix critical issues within 7 days, high within 30 days, medium within 90 days and low in the next release, and publish a GitHub security advisory within 30 days after the fix is released. In scope: the desktop app, the online server (WebSocket service and download page) and the build, release and deploy scripts in this repository. Out of scope: volumetric denial of service, social engineering, third-party platforms, and attacks that require prior control of the player's computer. Please test only with your own devices and data, and do not load-test or scan the online server.
