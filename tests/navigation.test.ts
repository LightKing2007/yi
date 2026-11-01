/** 顶栏信息架构：标志返回主页，下载只属于主页，子页导航不重复全局入口。 */
import { expect, it } from 'vitest';
import { startWebsite } from '../server/websiteHost';

const CASES = [
  [
    '/',
    [
      ['#games', '玩法'],
      ['#modes', '对局'],
      ['#features', '功能'],
      ['#details', '细节'],
      ['/download/', '下载'],
    ],
  ],
  [
    '/download/',
    [
      ['#guide', '安装'],
      ['#all', '全部版本'],
      ['#verify', '校验'],
      ['/support', '帮助与支持'],
    ],
  ],
  [
    '/agreement',
    [
      ['/agreement/privacy-policy', '隐私政策'],
      ['/agreement/terms-of-service', '用户服务条款'],
      ['/agreement/minors-privacy-rules', '未成年人个人信息保护规则'],
      ['/support', '帮助与支持'],
    ],
  ],
  [
    '/agreement/privacy-policy',
    [
      ['/agreement/privacy-policy', '隐私政策'],
      ['/agreement/terms-of-service', '用户服务条款'],
      ['/agreement/minors-privacy-rules', '未成年人个人信息保护规则'],
      ['/support', '帮助与支持'],
    ],
  ],
  [
    '/support',
    [
      ['#questions', '查找问题'],
      ['/agreement', '政策与条款'],
    ],
  ],
  [
    '/support/black-screen-webgl',
    [
      ['/support#questions', '查找问题'],
      ['/agreement', '政策与条款'],
    ],
  ],
  [
    '/not-a-page',
    [
      ['/support', '帮助与支持'],
      ['/agreement', '政策与条款'],
    ],
  ],
] as const;

it('所有页面使用确认的导航内容和顺序，非主页顶栏没有主页或下载链接', async () => {
  const site = await startWebsite({ port: 0, files: '/nonexistent/navigation', commit: 'test', now: () => 1 });
  try {
    for (const [route, expected] of CASES) {
      const response = await fetch(`http://127.0.0.1:${site.port}${route}`);
      const html = await response.text();
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      const nav = /<nav aria-label="页面导航">(.*?)<\/nav>/.exec(header)?.[1] ?? '';
      const links = [...nav.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(match => [match[1], match[2]]);
      expect(links, route).toEqual(expected);
      expect(header, route).toContain('<a class="logo" href="/"');
      if (route !== '/') {
        expect(nav, route).not.toContain('href="/"');
        expect(nav, route).not.toContain('href="/download/"');
      }
    }
  } finally {
    await site.close();
  }
});
