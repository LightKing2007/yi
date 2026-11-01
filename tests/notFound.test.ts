/** 默认 404：未知页面使用官网同源页面，状态、安全头与 HEAD 语义保持正确。 */
import { expect, it } from 'vitest';
import { notFoundPage } from '../server/notFoundPage';
import { startWebsite } from '../server/websiteHost';

it('404 页面复用官网外壳与首页终章样式，提供明确的返回入口', () => {
  const html = notFoundPage('test');
  expect(html).toContain('<title>弈 · 页面未找到</title>');
  expect(html).toContain('<span class="label">页面未找到</span>');
  expect(html).toContain('<h1 class="finale-title">404</h1>');
  expect(html).toContain('class="finale ink not-found"');
  expect(html).toContain('class="burst"');
  expect(html).not.toContain('agreement-hero');
  expect(html).not.toContain('document-notice');
  for (const link of ['href="/"', 'href="/download/"', 'href="/support"']) expect(html).toContain(link);
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<form');
});

it('未知页面及旧文书根地址返回同一份 404，HEAD 不带正文，未知资源仍为纯文本', async () => {
  const site = await startWebsite({ port: 0, files: '/nonexistent/website-not-found', commit: 'test', now: () => 1 });
  const base = `http://127.0.0.1:${site.port}`;
  try {
    const response = await fetch(`${base}/missing/page?from=test`);
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'");
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('accept-ch')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    expect(html).toContain('<h1 class="finale-title">404</h1>');
    const head = await fetch(`${base}/missing/page`, { method: 'HEAD' });
    expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([404, response.headers.get('content-length'), '']);
    for (const route of ['/privacy-policy', '/terms-of-service', '/minors-privacy-rules']) {
      const old = await fetch(base + route, { redirect: 'manual' });
      expect([old.status, old.headers.get('location'), await old.text()]).toEqual([404, null, html]);
    }
    const asset = await fetch(`${base}/assets/missing.png`);
    expect([asset.status, asset.headers.get('content-type'), await asset.text()]).toEqual([404, 'text/plain; charset=utf-8', '未找到所请求的文件。']);
  } finally {
    await site.close();
  }
});
