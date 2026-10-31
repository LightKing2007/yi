/** 协议页面的真实 HTTP：空安装目录也可阅读，正文不执行脚本，主页与下载页入口可达。 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AGREEMENT_INFO } from '../server/agreementText';
import { fileServer } from '../server/files';

/** 目录不实际创建：阅读协议不应依赖存在安装程序，也不需要生成或清理用户文件。 */
async function withAgreement(run: (base: string) => Promise<void>) {
  const server = createServer(fileServer(path.join(os.tmpdir(), `yi-agreement-${randomUUID()}`)));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test-address-invalid');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

const DOCUMENTS = [
  { slug: 'privacy-policy', name: '隐私政策' },
  { slug: 'terms-of-service', name: '用户服务条款' },
  { slug: 'minors-privacy-rules', name: '未成年人个人信息保护规则' },
];
const ROUTES = [{ slug: 'agreement', name: '隐私政策与服务条款' }, ...DOCUMENTS];

it('文书目录与三个英文文件名草案分别可读，正文不使用棋子装饰，尾斜杠规范化并忽略查询参数', async () => {
  await withAgreement(async base => {
    for (const { slug, name } of ROUTES) {
      const route = `/${slug}`;
      const response = await fetch(base + route);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<div class="agreement-kicker"><span class="label">文书</span></div>');
      expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
      expect(response.headers.get('accept-ch')).toBeNull();
      if (slug === 'agreement') {
        expect(html).toContain('<h1>隐私政策与服务条款</h1>');
        expect(html.match(/class="document-link rv"/g)).toHaveLength(3);
        for (const document of DOCUMENTS) expect(html).toContain(`href="/${document.slug}"`);
        expect(html).not.toContain('id="document"');
      } else {
        expect(html).toContain(`<h1>${name}</h1>`);
        const content = html.slice(html.indexOf('<section class="agreement-content'));
        expect(content).toContain('草案 0.1 · 尚未生效');
        expect(content).toContain('个人开发者王耀（LightKing）');
        expect(content).toContain('<article class="document-article"');
        expect(content).toContain('id="section-1"');
        expect(content).toContain('尚未开放');
        expect(content).not.toContain('正文待补充');
        expect(content).not.toContain('发布前核对清单');
        expect(content).not.toContain('class="document-number');
        expect(content).not.toContain('class="idx');
        expect(html).not.toContain('class="document-link rv"');
      }
      const other = await fetch(`${base}${route}?start&next=%3Cscript%3E`, { headers: { 'user-agent': 'Mobile' } });
      expect(await other.text()).toBe(html);
      const moved = await fetch(`${base}${route}/?start`, { redirect: 'manual' });
      expect([moved.status, moved.headers.get('location')]).toEqual([301, route]);
    }
  });
});

it('目录与文书页均保持无脚本安全头和 HEAD 语义，拒绝写入方法及未知子路径', async () => {
  await withAgreement(async base => {
    for (const { slug } of ROUTES) {
      const route = `/${slug}`;
      const response = await fetch(base + route);
      const html = await response.text();
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'");
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<form');
      const head = await fetch(base + route, { method: 'HEAD' });
      expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([200, response.headers.get('content-length'), '']);
      const post = await fetch(base + route, { method: 'POST' });
      expect([post.status, post.headers.get('allow')]).toEqual([405, 'GET, HEAD']);
      expect((await fetch(`${base}${route}/private`)).status).toBe(404);
    }
    for (const doc of DOCUMENTS) expect((await fetch(`${base}/${encodeURIComponent(doc.name)}`)).status).toBe(404);
    expect((await fetch(`${base}/privacy-policy-copy`)).status).toBe(404);
    expect((await fetch(`${base}/%E9%ZZ`)).status).toBe(400);
  });
});

it('主页导航不显示协议，页脚使用完整名称且移除校验清单链接，下载说明直达隐私文件', async () => {
  await withAgreement(async base => {
    const home = await (await fetch(base)).text();
    const header = home.slice(home.indexOf('<header'), home.indexOf('</header>'));
    expect(header).not.toContain('href="/agreement"');
    for (const route of ['/', '/download/', ...ROUTES.map(doc => `/${doc.slug}`)]) {
      const html = await (await fetch(`${base}${route}`)).text();
      const footer = html.slice(html.indexOf('<footer'));
      expect(footer).toContain('href="/agreement">隐私政策与服务条款</a>');
      expect(footer).not.toContain('href="/SHA256SUMS"');
    }
    const download = await (await fetch(`${base}/download/`)).text();
    expect(download).toContain('href="/privacy-policy">隐私政策（草案）</a>');
    expect(download).toContain('对局记录');
  });
});

it('统一配置的修改同步到目录、页脚和正文信息，日期只填写一次且显示信息经过转义', async () => {
  const original = { ...AGREEMENT_INFO };
  Object.assign(AGREEMENT_INFO, {
    title: '文书维护用例',
    version: '0.2',
    updated: '2026-11-01',
    operator: '维护用例 <甲>',
    status: '校对稿',
    statusNote: '测试中',
    introduction: '统一目录引言。',
    notice: '统一草案提示。',
  });
  try {
    await withAgreement(async base => {
      const home = await (await fetch(base)).text();
      expect(home).toContain('href="/agreement">文书维护用例</a>');
      const catalog = await (await fetch(`${base}/agreement`)).text();
      expect(catalog).toContain('<h1>文书维护用例</h1>');
      expect(catalog).toContain('统一目录引言。');
      expect(catalog).toContain('校对稿 · 测试中');
      for (const doc of DOCUMENTS) {
        const html = await (await fetch(`${base}/${doc.slug}`)).text();
        expect(html).toContain('校对稿 0.2 · 测试中');
        expect(html).toContain('<time datetime="2026-11-01">更新于 2026年11月1日</time>');
        expect(html).toContain('维护用例 &#60;甲&#62;');
        expect(html).toContain('<p class="document-notice">统一草案提示。</p>');
      }
    });
  } finally {
    Object.assign(AGREEMENT_INFO, original);
  }
});
