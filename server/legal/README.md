# 文书维护入口

以后修改官网文书，从本页开始。正文、目录信息和修改说明都集中在这里；这是项目内的维护入口。

## 打开正文

| 文件 | 编辑入口 | 网站地址 |
|---|---|---|
| 隐私政策 | [修改正文](privacy-policy.md) | `/agreement/privacy-policy` |
| 用户服务条款 | [修改正文](terms-of-service.md) | `/agreement/terms-of-service` |
| 未成年人个人信息保护规则 | [修改正文](minors-privacy-rules.md) | `/agreement/minors-privacy-rules` |

## 修改目录与公共信息

打开 [文书配置](../agreementText.ts)。

- `AGREEMENT_INFO`：统一修改目录标题、版本、更新日期、开发者名称、草案状态、目录引言和提示文字。目录页、网站页脚及正文页会复用这些信息。
- `AGREEMENT_DOCUMENTS`：修改三份文件的名称、摘要、编号和排列顺序。顶部导航与文书目录自动跟随。
- `updated` 按 `YYYY-MM-DD` 填写，例如 `2026-10-31`；页面显示日期自动生成。
- `slug` 对应既有网站地址，正文的导入对应本目录里的 Markdown 文件；日常改字无需修改它们。

正文中的运营者、联系方式、条款版本说明等属于法律文本本身，变更时也要检查三份正文的相关章节。公共显示配置不会自动改写正文，也不会开通账号或修改认证系统使用的同意版本。

## 修改步骤

1. 打开上面的正文链接并编辑，按需要同步目录信息和日期。
2. 运行格式、类型和测试检查；修改界面或正文文字后重新生成字体子集。
3. 重新构建服务端，查看电脑和手机预览，再按项目规程提交与发布。仅编辑文件不会直接改变线上内容。

在项目规定的 Node.js 24 环境中执行：

```sh
npm run format:check
npm run typecheck
npm test -- tests/agreement.test.ts tests/legalMarkdown.test.ts tests/text.test.ts tests/i18n.test.ts
node scripts/make-fonts.mjs
npm run build:node
```

## 正文格式

支持 `##` 章节、`###` 子章节、普通段落、`-` 项目列表、`1.` 编号列表、`**加粗**`。

站内文书链接可以写为 `[《隐私政策》](/agreement/privacy-policy)`，另外支持其余两份文书、文书目录和项目现有 GitHub 反馈地址。其他链接按普通文字显示；原始 HTML、图片和脚本不会执行。

章节目录由正文标题自动生成。正文保持普通章节样式；文书目录的编号直接复用 [官网共用样式](../pageStyle.ts) 的 `.idx`，不在文书样式中另设渐变或交替配色。

正式生效前需要补齐的内容，见 [文书发布事项](../../docs/plan/agreement-publication.md)。

## 官网独立运行

官网可用 `npm run build:website` 单独构建；产物为 `dist-website/web.cjs` 与构建清单。以 `YI_WEB_FILES=/安装包目录 node dist-website/web.cjs` 运行，仅监听本机 8444，不启动联机或打开数据库。正式目录为 `/opt/www/yi.lightking.com.cn`，后续发布、部署与回滚见[独立官网规程](../../docs/procedures/website.md)（[决策 0013](../../docs/adr/0013-independent-website.md)）。
