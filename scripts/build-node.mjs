/** 打包 Node 端：桌面版主进程与预加载（dist-electron/），独立联机服务端（dist-server/server.cjs，单文件、无需 npm install） */
import { build } from 'esbuild';

const common = {
  bundle: true, platform: 'node', target: 'node20', format: 'cjs', legalComments: 'none', logLevel: 'info',
  external: ['bufferutil', 'utf-8-validate'],            // ws 的可选加速模块，没有也能用
};

await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', external: [...common.external, 'electron'] }),
  build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['server/main.ts'], outfile: 'dist-server/server.cjs', banner: { js: '#!/usr/bin/env node' } }),
]);
