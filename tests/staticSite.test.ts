/** 静态官网产物：真实 HTML、渐进增强检索脚本与 404 均从指定目录读取。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readStaticSite } from '../server/staticSite';
import { supportPage, supportPages } from '../server/supportPage';
import { agreementPages } from '../server/agreementPage';
import { startWebsite } from '../server/websiteHost';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-static-site-'));
  for (const [route, body] of agreementPages('static-test')) {
    const file = path.join(root, `${route}.html`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  fs.writeFileSync(path.join(root, 'support.html'), supportPage('static-test', '', true));
  fs.mkdirSync(path.join(root, 'support'));
  for (const [route, body] of supportPages('static-test')) fs.writeFileSync(path.join(root, `${route}.html`), body);
  fs.writeFileSync(path.join(root, '404.html'), '<!doctype html><title>static-missing</title>');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets/support-search.js'), 'static-search-script');
  return root;
}

it('只接受完整的静态目录，并把 HTML 文件名还原成现有干净路由', () => {
  const root = fixture();
  try {
    const site = readStaticSite(root);
    expect(site?.pages.has('agreement/privacy-policy')).toBe(true);
    expect(site?.pages.has('support/black-screen-webgl')).toBe(true);
    expect(site?.pages.has('404')).toBe(false);
    expect(site?.missing.toString()).toContain('static-missing');
    expect(site?.assets.get('support-search.js')?.toString()).toBe('static-search-script');
    fs.rmSync(path.join(root, '404.html'));
    expect(readStaticSite(root)).toBeNull();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('静态目录响应保留搜索地址、CSP、HEAD、404 状态以及动态主页和下载页', async () => {
  const root = fixture();
  const site = await startWebsite({ port: 0, files: path.join(root, 'none'), pages: root, commit: 'test', now: () => 1 });
  const base = `http://127.0.0.1:${site.port}`;
  try {
    const response = await fetch(`${base}/support`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(html).toContain('<script defer src="/assets/support-search.js?v=static-test"></script>');
    expect(html.match(/class="document-link"/g)).toHaveLength(supportPages('static-test').size);
    expect(html).toContain('id="support-empty" hidden');
    const fallback = await fetch(`${base}/support?q=WebGL2`);
    const fallbackHtml = await fallback.text();
    expect(fallback.headers.get('content-security-policy')).not.toContain('script-src');
    expect(fallbackHtml.match(/class="document-link"/g)).toHaveLength(1);
    expect(fallbackHtml).toContain('“WebGL2”的搜索结果');
    const head = await fetch(`${base}/support`, { method: 'HEAD' });
    expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([200, response.headers.get('content-length'), '']);
    const script = await fetch(`${base}/assets/support-search.js?v=static-test`);
    expect([script.status, script.headers.get('content-type'), await script.text()]).toEqual([200, 'text/javascript; charset=utf-8', 'static-search-script']);
    const missing = await fetch(`${base}/not-a-page`);
    expect([missing.status, await missing.text()]).toEqual([404, '<!doctype html><title>static-missing</title>']);
    for (const route of ['/', '/download/']) {
      const dynamic = await fetch(base + route);
      expect(dynamic.status).toBe(200);
      expect(dynamic.headers.get('content-security-policy')).not.toContain('script-src');
    }
  } finally {
    await site.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
