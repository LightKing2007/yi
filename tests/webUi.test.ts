/** 官网自建组件库：统一语义、属性转义、渐进增强与当前导航状态。 */
import { describe, expect, it } from 'vitest';
import { shell } from '../server/page';
import { badge, btn, chapterIndex, codeLine, documentHero, documentLink, documentToc, factTags, secHead, siteNavigation, statNum } from '../server/webUi';

describe('官网共享组件', () => {
  it('章节、按钮、标签、数据、命令与徽章使用统一结构并转义动态文字', () => {
    expect(chapterIndex(1)).toBe('壹');
    expect(chapterIndex(10)).toBe('拾');
    expect(chapterIndex(11)).toBe('11');
    expect(secHead({ index: 1, label: '章节', title: '标题', lede: '导语。' })).toContain('<h2 class="rv">标题</h2>');
    expect(secHead({ index: 1, label: '章节', title: '标题', reveal: false })).toContain('<h2>标题</h2>');
    const button = btn({ href: '/download/?a=1&b=2', text: '下载<', icon: '<svg></svg>', download: true });
    expect(button).toContain('href="/download/?a=1&#38;b=2" download');
    expect(button).toContain('<svg></svg><span>下载&#60;</span>');
    expect(btn({ href: 'https://example.com', text: '外部', external: true })).toContain('target="_blank" rel="noopener noreferrer"');
    expect(factTags(['黑方禁手', '<禁着>'])).toContain('&#60;禁着&#62;');
    expect(statNum({ num: '7.5', unit: '目', label: '贴目。' })).toContain('class="stat rv"');
    expect(codeLine('a && b')).toContain('a &#38;&#38; b');
    expect(badge('推荐')).toBe('<span class="badge">推荐</span>');
  });

  it('文书页首、目录和侧边目录复用统一语义，数据属性名受限', () => {
    const hero = documentHero({ label: '支持', title: '帮助<', lead: '导语。', file: true, support: true, ornaments: '<i></i>' });
    expect(hero).toContain('class="agreement-hero agreement-file support-hero ink"');
    expect(hero).toContain('<h1>帮助&#60;</h1>');
    const link = documentLink({
      href: '/support/a?x=1&y=2',
      number: '01',
      title: '问题',
      summary: '答案。',
      heading: 'h3',
      dataName: 'support-entry',
      dataValue: 'a',
    });
    expect(link).toContain('data-support-entry="a" href="/support/a?x=1&#38;y=2"');
    expect(link).toContain('<h3>问题</h3>');
    expect(() => documentLink({ href: '/', number: '1', title: '标题', summary: '摘要。', dataName: 'x" onclick' })).toThrow('非法 data 属性');
    expect(documentToc('本篇目录', '本篇目录', [['#a&b', '第一节']])).toContain('href="#a&#38;b"');
  });

  it('全站导航复用同一份链接并转义内容，手机折叠菜单不依赖脚本', () => {
    const navigation = siteNavigation([['/download/?a=1&b=2', '下载<']], '/download/?a=1&b=2');
    expect(navigation.match(/aria-current="page"/g)).toHaveLength(2);
    expect(navigation.match(/href="\/download\/\?a=1&#38;b=2"/g)).toHaveLength(2);
    expect(navigation.match(/>下载&#60;<\/a>/g)).toHaveLength(2);
    expect(navigation).toContain('<details class="nav-menu"><summary aria-label="打开或关闭页面导航">');
    expect(navigation).not.toContain('onclick');
  });

  it('文档外壳转义元信息、标记当前导航并预加载标题字体', () => {
    const html = shell({
      title: '弈 <测试>',
      description: '说明 "文字"',
      assetVersion: 'v1',
      nav: [['/download/', '下载']],
      current: '/download/',
      style: '',
      body: '<p>正文。</p>',
    });
    expect(html).toContain('<title>弈 &#60;测试&#62;</title>');
    expect(html).toContain('content="说明 &#34;文字&#34;"');
    expect(html).toContain('href="/download/" aria-current="page"');
    expect(html).toContain('rel="preload" href="/assets/yi-serif-900.woff2?v=v1"');
    expect(html).toContain('<script defer src="/assets/site-enhance.js?v=v1"></script>');
  });
});
