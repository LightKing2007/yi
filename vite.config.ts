import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { pageAssets } from './scripts/page-assets.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** 开发用：场景脚本（src/app/scenarios.ts）把截图 POST 到 /__shot，这里存成 .shots/<组名>/<名字>.png */
const shots = (): Plugin => ({
  name: 'yi-shots',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      const q = new URL(req.url ?? '', 'http://x').searchParams;
      const safe = (v: string | null) => (v ?? '').replace(/[^\w@.\-]/g, '_').slice(0, 120);
      const set = safe(q.get('set')) || 'now',
        name = safe(q.get('name'));
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const url = Buffer.concat(chunks).toString('utf8'),
          m = /^data:image\/png;base64,(.*)$/.exec(url);
        if (!name || !m) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const dir = new URL(`./.shots/${set}/`, import.meta.url);
        mkdirSync(dir, { recursive: true });
        writeFileSync(new URL(`${name}.png`, dir), Buffer.from(m[1], 'base64'));
        res.end('ok');
      });
    });
  },
});

// 相对路径：打包进 Electron 后从 file:// 载入
export default defineConfig({
  base: './',
  plugins: [shots()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version), // 版本号只写在 package.json 一处
    __PAGE_ASSETS__: JSON.stringify(pageAssets(new URL('./', import.meta.url))), // 只有服务端的下载页面引用（测试中用到）
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
