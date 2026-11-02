/** esbuild 插件：以 `?raw` 结尾的导入按文本内联（与 Vite 的写法一致），迁移 SQL 与官网文书由此打包。build-node.mjs、bench.mjs 与 test-accounts.mjs 共用 */
import fs from 'node:fs';
import path from 'node:path';

export const rawText = {
  name: 'raw-text',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)), namespace: 'raw-text' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
  },
};
