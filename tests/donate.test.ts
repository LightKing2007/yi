/** 支持作者页：真实成本与自愿约定完整可读；未配置收款渠道时不出现虚假付款入口。 */
import { describe, expect, it } from 'vitest';
import { DONATION_URL, donatePage } from '../server/donatePage';
import { startWebsite } from '../server/websiteHost';

const EXPECTED_COPY = [
  '一杯咖啡',
  '让这盘棋继续下去',
  '联机服务',
  '网站与下载',
  '时间与维护',
  '完全自愿',
  '不附带特权',
  '自愿支持，不附带任何权益',
  '捐赠会用在哪里',
  '不捐赠也没有关系',
  '谢谢你',
];

describe('支持作者页', () => {
  it('包含两行中文标题、运营去向、支持约定、常见问题与致谢，装饰不进入无障碍树', () => {
    const html = donatePage('test');
    expect(html).toContain('<title>弈 · 支持作者</title>');
    for (const text of EXPECTED_COPY) expect(html).toContain(text);
    expect(html.match(/class="donate-title-line"/g)).toHaveLength(2);
    expect(html.match(/class="heart-ocean" aria-hidden="true"/g)).toHaveLength(1);
    expect(html).toContain('<details class="donate-question" open>');
    expect(html.match(/<details class="donate-question"/g)).toHaveLength(3);
    for (const removed of [
      'coffee-scene',
      'donate-cue',
      'SUPPORT THE NEXT MOVE',
      'A CUP FOR THE NEXT MOVE',
      'SERVER &amp; UPTIME',
      'DOMAIN &amp; DELIVERY',
      'CARE &amp; MAINTENANCE',
      'donate-finale-mark',
      '支持，应该是一件轻松的事',
      '后盾',
      '--rotate',
      '--drift',
    ])
      expect(html).not.toContain(removed);
    expect(html).toContain('<script defer src="/assets/site-enhance.js?v=test"></script>');
    expect(html).not.toContain('onclick');
  });

  it('收款渠道留空时只显示接入状态；配置后必须显式使用真实外链', () => {
    expect(DONATION_URL).toBe('');
    const html = donatePage('test');
    expect(html.match(/捐赠渠道接入中/g)).toHaveLength(2);
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain('example.com');
    for (const match of html.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) expect(match[0]).toContain('rel="noopener noreferrer"');
  });

  it('无静态目录时也能通过 /donate 阅读，HEAD 与 GET 内容长度一致', async () => {
    const site = await startWebsite({ port: 0, files: '/nonexistent/donate', commit: 'test', now: () => 1 });
    try {
      const response = await fetch(`http://127.0.0.1:${site.port}/donate`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('让这盘棋');
      const head = await fetch(`http://127.0.0.1:${site.port}/donate`, { method: 'HEAD' });
      expect([head.status, head.headers.get('content-length'), await head.text()]).toEqual([200, response.headers.get('content-length'), '']);
    } finally {
      await site.close();
    }
  });
});
