# 独立官网的维护、发布与上线

官网运行于 `/opt/www/yi.lightking.com.cn`，服务名为 `yi-web`，仅监听本机 8444。联机服务继续使用 `yi` 和本机 8443，数据位于 `/var/lib/yi`。依据 [决策 0013](../adr/0013-independent-website.md)；官网更新不执行游戏发版、数据库迁移或联机重启。

## 1 修改正文与页面

文书统一入口为 [文书维护说明](../../server/legal/README.md)。修改三份 Markdown 或 `server/agreementText.ts` 后，按项目流程创建 PR，检查通过后合并。帮助与支持采用“目录 + 独立问题页”：每个问题在 `server/support/` 下各有一份 Markdown，文件头部的 `title` 与 `category` 提供标题和分类；新增文件后在 `server/supportSources/` 的对应分类模块登记一次，即自动进入目录与全文检索。目录检索由 `scripts/support-search.ts` 构建为同源外部脚本，无脚本时仍以原生 GET 表单的 `q` 参数回退检索；页面结构和独立阅读页位于 `server/supportPage.ts`，复用文书布局与受限 Markdown 渲染器。网页渲染代码仍集中在 `server/`，两个程序的构建入口和实际依赖分开；目录名称不代表网站运行于联机进程。

本机用 `npm run build:website` 构建，以 `YI_WEB_FILES=/安装程序目录 node dist-website/web.cjs` 预览。安装程序目录可为空，支持与文书仍应可读。构建时禁止网站引入数据库或账号模块；联机包不再嵌入网页和资源。

## 2 独立发布

1. 确认待发布的 `main` 提交 CI 已成功。
2. 执行 `gh workflow run website.yml --ref main`，等待“官网发布”完成。
3. 网站工作流创建 `web-十二位提交号` 的草稿 Release。核对 `manifest.json` 的完整提交号、`web.cjs` 和两者的 `SHA256SUMS`，预览或实际 HTTP 验证与该产物对应。遵循发布规程的草稿核对要求后发布：`gh release edit web-提交号 --draft=false --latest=false`。
4. 网站发布不更改游戏版本，不重建桌面安装程序，不作为 GitHub 的最新游戏 Release。重复运行前先查看该标签是否已经存在，已有产物不可覆盖。

网站独立变更记录保存在对应网站 Release；游戏内日志只记录游戏版本的变更。只发布网站时不要求重跑桌面安装验证和游戏容量压测；必须通过网站页面、下载、请求限制、构建依赖与回滚检查。

## 3 首次迁移

以下配置安装和公网路由切换以 root 执行，须有项目所有者的生产操作授权（SEC-044）；脚本保留原配置，不修改 Caddy 主配置或其他站点。

1. `npm run deploy:website -- bootstrap`：安装网站专用单元、root 所有的受限部署工具和 sudo 白名单，尚不切换路由。
2. `npm run deploy:website -- downloads 3.1.0`：从已发布游戏 Release 获取校验清单与四个安装程序，核对后独立保存到官网目录；不读取 `/opt/yi`。
3. `npm run deploy:website -- install web-提交号`：只接受已发布的网站 Release；核对内容后切换目录，重启 `yi-web` 并验证完整提交号。首次启动失败则停止网站，已有网站更新失败则恢复旧版。
4. `npm run deploy:website -- activate`：确认网站健康且当前没有联机对局，再安装本仓库的 `yi.caddy`、校验并平滑重载 Caddy；七个公开页面检查失败时恢复旧配置。不重启 `yi`。首次重载可能使旧代理连接重新建立，应选择无玩家时操作。
5. 核对 HTTPS 页面、四个平台下载和校验值、公开健康检查为 404，以及 `wss://yi.lightking.com.cn/ws` 和根路径的 WebSocket 仍可建立。核对游戏健康检查的版本与提交未变。

SSH 使用域名并严格验证已保存的主机密钥，不自动接受新密钥。本机已有服务器密钥以其他名称保存时，可为本次命令设置 `YI_WEB_HOST_KEY_ALIAS` 使用该已验证名称，不修改 SSH 配置或全局信任设置。

## 4 后续更新和回滚

- 更新网站代码或文书：发布新的网站 Release，执行 `npm run deploy:website -- install web-提交号`。无需再次 bootstrap 或 activate，也无需升级游戏数据库。
- 更新可下载的游戏：在游戏 Release 发布后执行 `npm run deploy:website -- downloads 游戏版本`，从该 Release 下载并校验四个安装程序。不切换网站代码，不重启联机程序，也不读取 `/opt/yi`。
- 回滚网站：`npm run deploy:website -- rollback`，只切换网站程序，下载版本保持独立；需要回退下载版本时另执行上一游戏版本的 downloads 命令，从 GitHub 取得旧安装包。
- 状态：`npm run deploy:website -- status`。日志：`ssh deploy@yi.lightking.com.cn journalctl -u yi-web --since yesterday --no-pager`。

站点目录中 `releases/完整提交号` 为不可变网站产物，`current` 与 `previous` 为网站链接；`downloads/releases/游戏版本` 为安装程序，`downloads/current` 单独切换。安装包切换成功后删除服务器上的旧游戏版本，只保留当前一份；历史安装包由 GitHub Release 保存。`config-backup/` 保存配置迁移前的副本，`deploy.log` 只记录网站操作。每次操作仍按运维规程检查磁盘；未成功的 `.incoming-*` 暂存目录须核对所属操作后清理，不能删除 current 或 previous 指向的目录。
