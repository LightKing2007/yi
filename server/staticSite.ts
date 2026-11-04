/** 启动时读取构建产物中的静态 HTML；目录不完整时由调用方使用兼容回退。 */
import fs from 'node:fs';
import path from 'node:path';

/** 一个完整静态发布目录中的页面、404 与外部资源。 */
export interface StaticSite {
  pages: ReadonlyMap<string, Buffer>;
  missing: Buffer;
  assets: ReadonlyMap<string, Buffer>;
}

/** 静态目录允许直接提供的增强脚本；白名单与 server/files.ts 的 ASSET_TYPES 对应。 */
const STATIC_SCRIPTS = ['support-search.js', 'site-enhance.js'] as const;

/**
 * 读取静态目录 `assets/` 下的增强脚本；目录或单个脚本缺失时跳过，不抛异常。
 * 静态页面不完整时仍可用它提供增强脚本，避免回退到动态页面后脚本 404（R7）。
 */
export function readStaticAssets(root: string): ReadonlyMap<string, Buffer> {
  const assets = new Map<string, Buffer>();
  for (const name of STATIC_SCRIPTS) {
    try {
      const file = path.join(root, 'assets', name);
      if (fs.statSync(file).isFile()) assets.set(name, fs.readFileSync(file));
    } catch {
      // 脚本不存在或目录不可读：增强效果不出现，页面内容与功能不受影响
    }
  }
  return assets;
}

/** 只读取常规文件，不跟随目录中的符号链接；路由来自构建产物的相对文件名。 */
export function readStaticSite(root: string): StaticSite | null {
  const pages = new Map<string, Buffer>();
  let assets: ReadonlyMap<string, Buffer>;
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
    assets = readStaticAssets(root);
  } catch {
    return null;
  }
  const missing = pages.get('404');
  pages.delete('404');
  if (!missing || !pages.has('agreement') || !pages.has('support') || !pages.has('donate') || !assets.has('support-search.js')) return null;
  return { pages, missing, assets };
}
