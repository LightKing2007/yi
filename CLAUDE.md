# 弈 · 协作约定

- 开发与发版严格按 [docs/RELEASE.md](docs/RELEASE.md) 走。
  - 不直接改 main。每件事开 `feat/`、`fix/` 等分支，提交说明和 PR 标题都写成 `类型: 说明`。
  - CI 通过后压缩合并，PR 合并不用等人确认，发版要等人在网页上确认草稿 Release。
  - 发版用 `npm run release -- 版本号`，上线用 `npm run deploy -- 版本号`，不手动打标签、不手动传服务端。
- 游戏里的说明文字，包括规则、帮助、更新日志、提示：
  - 平实，只说功能和修复，不写技术细节；
  - 标点只用 、，。；
  - 同时补文言和英文译文（`src/i18n/table.ts`），英文不用长破折号；
  - 改了界面文字后运行 `node scripts/make-fonts.mjs`。
- 玩家能感觉到的改动，在同一个 PR 里把更新日志写进 `src/ui/info.ts` 的 `LOG` 最上面一节。那一节是下一个版本，没有就新建。
- 检查：`npm run typecheck && npm test`。改了画面或动画的，实际运行看一下。
- 分层规则见 `tests/layers.test.ts`。core 只依赖 core，server 只依赖 core 与 shared。
- 仓库只放核心的源码与文档，临时脚本、截图、测试产物不提交。
- 服务器上的操作（重启、改配置）会影响正在下棋的玩家，先看连接数，没人时再做。
