/** 打包 Node 端：桌面版主进程与预加载（dist-electron/），独立联机服务端（dist-server/server.cjs，单文件、无需 npm install），异地备份（dist-server/offsite.cjs） */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { build } from 'esbuild';
import { pageAssets } from './page-assets.mjs';

// 版本号与提交号写进程序里：服务端启动时打出来，线上跑的是哪一版一看便知
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let commit = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
if (!commit)
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    commit = 'unknown';
  }

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'info',
  external: ['bufferutil', 'utf-8-validate'], // ws 的可选加速模块，没有也能用
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_COMMIT__: JSON.stringify(commit) },
};

await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', external: [...common.external, 'electron'] }),
  build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', external: ['electron'] }),
  build({
    ...common,
    entryPoints: ['server/main.ts'],
    outfile: 'dist-server/server.cjs',
    banner: { js: '#!/usr/bin/env node' },
    define: { ...common.define, __PAGE_ASSETS__: JSON.stringify(pageAssets(new URL('../', import.meta.url))) }, // 下载页面的标题图、图标与字体
  }),
  build({ ...common, entryPoints: ['scripts/offsite.ts'], outfile: 'dist-server/offsite.cjs' }), // 异地加密备份，在服务器上由 yi-offsite.service 运行（P1-13）
]);
