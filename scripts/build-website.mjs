/** 独立打包官网；构建输入禁止包含账号、数据库或联机模块。 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { pageAssets } from './page-assets.mjs';

const CACHE_ID_LENGTH = 12;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const textPlugin = {
  name: 'website-text',
  setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)), namespace: 'text' }));
    builder.onLoad({ filter: /.*/, namespace: 'text' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};
const version = `web-${commit.slice(0, CACHE_ID_LENGTH)}`;
const result = await build({
  entryPoints: ['scripts/website.ts'],
  outfile: 'dist-website/web.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  metafile: true,
  write: false,
  plugins: [textPlugin],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
    __PAGE_ASSETS__: JSON.stringify(pageAssets(new URL('../', import.meta.url))),
  },
});
const inputs = Object.keys(result.metafile.inputs);
const allowed = new Set([
  'websiteConfig',
  'websiteHost',
  'clientIp',
  'files',
  'http',
  'ratelimit',
  'agreementPage',
  'agreementStyle',
  'agreementText',
  'supportPage',
  'supportContent',
  'supportSources/download',
  'supportSources/display',
  'supportSources/rules',
  'supportSources/online',
  'supportSources/settings',
  'notFoundPage',
  'legalMarkdown',
  'downloadPage',
  'downloadStyle',
  'homePage',
  'homeStyle',
  'board',
  'geometry',
  'ring',
  'page',
  'pageStyle',
  'pageResponse',
  'platform',
  'staticSite',
]);
for (const input of inputs) {
  if (input === '<define:__PAGE_ASSETS__>' || input === 'scripts/website.ts') continue;
  const text = input.startsWith('text:') ? input.slice('text:'.length) : '';
  const legalText = ['privacy-policy.md', 'terms-of-service.md', 'minors-privacy-rules.md'].includes(path.basename(text));
  const supportText = text.endsWith('.md') && path.dirname(path.resolve(text)) === path.resolve('server/support');
  if (text && (legalText || supportText)) continue;
  if (!allowed.has(input.slice('server/'.length, -'.ts'.length)) || !input.startsWith('server/') || !input.endsWith('.ts'))
    throw new Error(`官网包含未经允许的运行依赖：${input}`);
}
fs.mkdirSync('dist-website', { recursive: true });
fs.writeFileSync('dist-website/web.cjs', result.outputFiles[0].contents);
fs.writeFileSync('dist-website/manifest.json', JSON.stringify({ service: 'yi-web', commit, inputs }, null, 2) + '\n');

// 固定内容单独生成真实 HTML；生成器不是运行进程或发布产物的依赖。
await build({
  entryPoints: ['scripts/website-static.ts'],
  outfile: 'dist-website/static-pages.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  plugins: [textPlugin],
  define: { __APP_VERSION__: JSON.stringify(version) },
});
execFileSync(process.execPath, ['dist-website/static-pages.cjs']);
await build({
  entryPoints: ['scripts/support-search.ts'],
  outfile: 'dist-website/site/assets/support-search.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  plugins: [textPlugin],
});
execFileSync('tar', ['-cf', 'dist-website/site.tar', '-C', 'dist-website/site', '.']);

// 部署工具独立打包，永远不作为官网进程的依赖或运行代码。
await build({
  entryPoints: ['scripts/website-remote.ts'],
  outfile: 'dist-website/deploy.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
});
