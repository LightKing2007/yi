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
// 例外 COD-055：Vite 只读取配置文件的默认导出
export default defineConfig({
  base: './',
  plugins: [shots()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version), // 版本号只写在 package.json 一处
    __PAGE_ASSETS__: JSON.stringify(pageAssets(new URL('./', import.meta.url))), // 只有服务端的下载页面引用（测试中用到）
  },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } }, // Vite 8 起以 Oxc 转换 TypeScript 与 JSX（原 esbuild 选项已弃用）
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 测试覆盖率（TST-010）：npm run test:coverage。render、fx、scene、ui、audio 与场景脚本以画面回归覆盖，不计入（TST-012）
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/render/**', 'src/fx/**', 'src/scene/**', 'src/ui/**', 'src/audio/**', 'src/app/scenarios.ts'],
      reportsDirectory: '.vitest/coverage',
      reporter: ['text-summary', 'json'], // json 即 coverage-final.json，供 scripts/diff-coverage.mjs 计算改动行的覆盖率（TST-011）
      thresholds: {
        lines: 75, // 全项目（不含上述五个目录）
        'src/core/**': { lines: 90, branches: 85 },
        'src/shared/**': { lines: 90, branches: 85 },
        'server/**': { lines: 85, branches: 75 },
        'src/session/**': { lines: 85, branches: 75 },
        'src/online/**': { lines: 75, branches: 65 },
      },
    },
  },
} as any);
