/** 官网静态验收：检查所有生成页面的脚本边界、页内导航与基本可达性。 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist-website/site');
const scripts = new Set(['/assets/site-enhance.js', '/assets/support-search.js']);
const errors = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function attribute(source, name) {
  const match = source.match(new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|$)`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

const pages = walk(root).filter(file => file.endsWith('.html'));
for (const file of pages) {
  const name = path.relative(root, file);
  const html = fs.readFileSync(file, 'utf8');
  const tags = [...html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)];
  const ids = new Set();
  const fragments = [];
  let scriptTags = 0;

  for (const match of tags) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    if (/\son[a-z]+\s*=/i.test(attrs)) errors.push(`${name}：${tag} 含内联事件`);
    const id = attribute(attrs, 'id');
    if (id !== null) {
      if (ids.has(id)) errors.push(`${name}：重复 ID ${id}`);
      ids.add(id);
    }
    if (tag === 'script') scriptTags++;
    if (tag === 'a') {
      const href = attribute(attrs, 'href');
      if (href?.startsWith('#')) fragments.push(href.slice(1));
      const rel = new Set((attribute(attrs, 'rel') ?? '').split(/\s+/));
      const isolated = rel.has('noopener') && rel.has('noreferrer');
      if (attribute(attrs, 'target') === '_blank' && !isolated) errors.push(`${name}：新窗口链接缺少 noopener noreferrer`);
    }
    if (tag === 'img' && attribute(attrs, 'alt') === null) errors.push(`${name}：图片缺少 alt`);
  }

  const scriptElements = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scriptElements.length !== scriptTags) errors.push(`${name}：script 标签不完整`);
  for (const match of scriptElements) {
    const attrs = match[1];
    const src = attribute(attrs, 'src');
    if (src === null || attribute(attrs, 'defer') === null || match[2].trim()) {
      errors.push(`${name}：脚本必须是外部 defer 文件且不得含内联代码`);
      continue;
    }
    const url = new URL(src, 'https://yi.lightking.com.cn');
    if (url.origin !== 'https://yi.lightking.com.cn' || !scripts.has(url.pathname)) errors.push(`${name}：未登记脚本 ${src}`);
  }
  for (const fragment of fragments) {
    if (!fragment || !ids.has(fragment)) errors.push(`${name}：页内锚点 #${fragment} 不存在`);
  }
}

if (!pages.length) errors.push('未找到待检查的 HTML 页面');
if (errors.length) {
  console.error(`官网静态检查失败：\n${errors.map(error => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`官网静态检查通过：${pages.length} 份 HTML`);
}
