/** 启动时读取构建产物中的静态 HTML；目录不完整时由调用方使用兼容回退。 */
import fs from 'node:fs';
import path from 'node:path';

/** 一个完整静态发布目录中的页面、404 与外部资源。 */
export interface StaticSite {
  pages: ReadonlyMap<string, Buffer>;
  missing: Buffer;
  assets: ReadonlyMap<string, Buffer>;
}

/** 只读取常规文件，不跟随目录中的符号链接；路由来自构建产物的相对文件名。 */
export function readStaticSite(root: string): StaticSite | null {
  const pages = new Map<string, Buffer>();
  const assets = new Map<string, Buffer>();
  try {
    const visit = (directory: string, prefix = '') => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const name = prefix + entry.name;
        if (entry.isDirectory()) visit(file, `${name}/`);
        else if (entry.isFile() && name.endsWith('.html')) pages.set(name.slice(0, -'.html'.length), fs.readFileSync(file));
      }
    };
    visit(root);
    const script = path.join(root, 'assets/support-search.js');
    if (fs.statSync(script).isFile()) assets.set('support-search.js', fs.readFileSync(script));
  } catch {
    return null;
  }
  const missing = pages.get('404');
  pages.delete('404');
  if (!missing || !pages.has('agreement') || !pages.has('support') || !assets.has('support-search.js')) return null;
  return { pages, missing, assets };
}
