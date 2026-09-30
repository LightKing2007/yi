import { defineConfig } from 'vite';

// 相对路径：打包进 Electron 后从 file:// 载入
export default defineConfig({
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
