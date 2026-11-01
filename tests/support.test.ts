/** 帮助目录：独立问题文件、全文检索、固定路由与全站入口保持完整。 */
import { expect, it } from 'vitest';
import { searchSupport, SUPPORT_ARTICLES, SUPPORT_CATEGORIES } from '../server/supportContent';
import { supportPage, supportPages } from '../server/supportPage';
import { startWebsite } from '../server/websiteHost';

it('目录复用文书布局，六类三十四个问题分别链接到独立页面', () => {
  const html = supportPage('test');
  expect(SUPPORT_ARTICLES).toHaveLength(34);
  expect(SUPPORT_CATEGORIES).toEqual(['下载与安装', '启动、画面与声音', '棋规与操作', '联机对战', '设置、更新与数据', '反馈与隐私']);
  expect(html).toContain('<title>弈 · 帮助与支持</title>');
  expect(html).toContain('class="agreement-hero agreement-file support-hero ink"');
  expect(html).toContain('class="support-ornaments" aria-hidden="true"');
  expect(html).toContain('class="support-grid"');
  expect(html).toContain('class="support-rain"');
  expect(html.match(/class="support-stream"/g)).toHaveLength(12);
  const rainText = (/<div class="support-rain">(.*?)<\/div>/.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '');
  expect(rainText).toContain('下载后无法打开怎么办');
  expect(rainText).toContain('反馈问题时请附上复现步骤');
  expect(html).not.toContain('class="support-lens"');
  expect(html).not.toContain('class="support-route"');
  expect(html).not.toContain('class="agreement-ornaments"');
  expect(html).not.toContain('class="burst"');
  expect(html).toContain('<form class="support-search" action="/support" method="get" role="search">');
  expect(html).toContain('type="search" name="q"');
  expect(html).not.toContain('support-search-submit');
  expect(html).not.toContain('<kbd>');
  expect(html.match(/class="document-link"/g)).toHaveLength(34);
  expect(html.match(/<section class="support-group"/g)).toHaveLength(6);
  for (const [index, article] of SUPPORT_ARTICLES.entries()) {
    expect(html).toContain(`href="/support/${article.slug}"`);
    expect(html).toContain(article.title);
    if (index % 7 === 0) expect(html).toContain(article.summary);
  }
  expect(html).not.toContain('<nav aria-label="问题分类">');
  expect(html).not.toContain('data-support-category');
  expect(html).not.toContain('<script');
});

it('检索匹配标题、分类和答案，支持多个关键词、空结果与安全转义', () => {
  expect(searchSupport('webgl2').map(article => article.slug)).toEqual(['black-screen-webgl']);
  expect(searchSupport('围棋 计时').map(article => article.slug)).toEqual(['timer-paused']);
  expect(searchSupport('反馈与隐私')).toHaveLength(3);
  const result = supportPage('test', '  WebGL2  ');
  expect(result).toContain('value="WebGL2"');
  expect(result.match(/class="document-link"/g)).toHaveLength(1);
  expect(result).toContain('href="/support/black-screen-webgl"');
  expect(result).not.toContain('href="/support/mobile-tablet"');
  const empty = supportPage('test', '没有这个问题');
  expect(empty).toContain('没有找到相关问题');
  expect(empty).toContain('查看全部 34 个问题');
  expect(empty).not.toContain('class="document-link"');
  expect(supportPage('test', '<"&')).toContain('value="&#60;&#34;&#38;"');
  expect(empty).not.toContain('<script');
});

it('三十四份 Markdown 均生成独立阅读页，答案、相关链接与返回目录完整', () => {
  const pages = supportPages('test');
  expect(pages.size).toBe(SUPPORT_ARTICLES.length);
  expect(new Set(SUPPORT_ARTICLES.map(article => article.slug)).size).toBe(SUPPORT_ARTICLES.length);
  for (const article of SUPPORT_ARTICLES) {
    const html = pages.get(`support/${article.slug}`)?.toString() ?? '';
    expect(html).toContain(`<title>弈 · ${article.title}</title>`);
    expect(html).toContain(`<h1>${article.title}</h1>`);
    expect(html).toContain(article.summary);
    expect(html).toContain('class="support-ornaments" aria-hidden="true"');
    expect(html).toContain('href="/support">← 返回帮助目录</a>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<form');
  }
  expect(pages.get('support/report-issue')?.toString()).toContain('href="https://github.com/LightKing2007/yi/issues"');
  expect(pages.get('support/security-vulnerability')?.toString()).toContain('/security/advisories/new');
  expect(pages.get('support/online-privacy')?.toString()).toContain('href="/agreement/privacy-policy"');
});

it('目录搜索与独立问题页保持安全头、HEAD 和规范路径语义', async () => {
  const site = await startWebsite({ port: 0, files: '/nonexistent/website-support', commit: 'test', now: () => 1 });
  const base = `http://127.0.0.1:${site.port}`;
  try {
    const response = await fetch(`${base}/support`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'");
    expect(response.headers.get('accept-ch')).toBeNull();
    expect(await (await fetch(`${base}/support?from=download`)).text()).toBe(html);
    const result = await fetch(`${base}/support?q=WebGL2`);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('“WebGL2”的搜索结果');
    const moved = await fetch(`${base}/support/?q=WebGL2&from=download`, { redirect: 'manual' });
    expect([moved.status, moved.headers.get('location')]).toEqual([301, '/support?q=WebGL2']);
    const head = await fetch(`${base}/support?q=WebGL2`, { method: 'HEAD' });
    expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([200, result.headers.get('content-length'), '']);
    const article = await fetch(`${base}/support/black-screen-webgl`);
    expect(article.status).toBe(200);
    expect(await article.text()).toContain('<h1>启动后黑屏或提示不支持 WebGL2</h1>');
    const canonical = await fetch(`${base}/support/black-screen-webgl/`, { redirect: 'manual' });
    expect([canonical.status, canonical.headers.get('location')]).toEqual([301, '/support/black-screen-webgl']);
    const post = await fetch(`${base}/support`, { method: 'POST' });
    expect([post.status, post.headers.get('allow')]).toEqual([405, 'GET, HEAD']);
    expect((await fetch(`${base}/support/private`)).status).toBe(404);
    for (const route of ['/', '/download/', '/support', '/support/black-screen-webgl', '/agreement']) {
      const page = await (await fetch(base + route)).text();
      expect(page.slice(page.indexOf('<footer'))).toContain('href="/support">帮助与支持</a>');
    }
  } finally {
    await site.close();
  }
});
