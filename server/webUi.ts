/**
 * 官网共享 UI 组件：纯函数，输入数据、输出 HTML 字符串，不在客户端运行。
 * 动态文本与属性一律经 esc()；icon 与 ornaments 只接受项目内可信的静态 SVG / HTML。
 * 组件不包含内联事件，不依赖客户端脚本；共享样式集中在 pageStyle.ts 或文书样式模块。
 */
import { esc } from './webHtml';
import { ARROW_RIGHT } from './webIcons';

/** 全站导航：桌面横向链接与手机原生折叠面板共用同一份链接数据，无脚本也可展开。 */
export function siteNavigation(links: readonly (readonly [href: string, text: string])[], current?: string) {
  const items = links.map(([href, text]) => `<a href="${esc(href)}"${href === current ? ' aria-current="page"' : ''}>${esc(text)}</a>`).join('');
  return `<nav aria-label="页面导航">${items}</nav>
<details class="nav-menu"><summary aria-label="打开或关闭页面导航"><span class="menu-lines" aria-hidden="true"><i></i><i></i><i></i></span></summary>
<nav class="nav-panel" aria-label="手机页面导航">${items}</nav></details>`;
}

const CN_NUM = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'];
/** 章节编号：壹贰叁肆……；超过十章时用阿拉伯数字。 */
export const chapterIndex = (n: number) => CN_NUM[n - 1] ?? String(n);

/** 章节头：编号圆点 + 宽字距标签 + 宋体大标题 + 可选导语。 */
export function secHead(spec: { index: number; label: string; title: string; lede?: string; reveal?: boolean }) {
  const reveal = spec.reveal === false ? '' : ' class="rv"';
  return `<div class="sec-head"><span class="idx">${chapterIndex(spec.index)}</span><span class="label">${esc(spec.label)}</span>
<h2${reveal}>${esc(spec.title)}</h2>
${spec.lede ? `<p${reveal}>${esc(spec.lede)}</p>` : ''}</div>`;
}

/** 主按钮：胶囊、图标圆点、悬停时榧木色棋子铺开；ghost 为描边次要按钮。 */
export function btn(spec: { href: string; text: string; icon?: string; ghost?: boolean; external?: boolean; download?: boolean }) {
  const cls = spec.ghost ? 'btn ghost' : 'btn';
  const ext = spec.external ? ' target="_blank" rel="noopener noreferrer"' : '';
  const download = spec.download ? ' download' : '';
  return `<a class="${cls}" href="${esc(spec.href)}"${download}${ext}>${spec.icon ?? ''}<span>${esc(spec.text)}</span></a>`;
}

/** 要点标签：短语式列表，不是段落。 */
export const factTags = (items: readonly string[]) =>
  `<div class="facts" role="list">${items.map(item => `<span role="listitem">${esc(item)}</span>`).join('')}</div>`;

/** 大数字：15 路 / 60 秒 / 7.5 目等数据展示。 */
export function statNum(spec: { num: string; unit: string; label: string; reveal?: boolean }) {
  const reveal = spec.reveal === false ? '' : ' rv';
  return `<div class="stat${reveal}"><div class="stat-num"><b>${esc(spec.num)}</b><span>${esc(spec.unit)}</span></div><p>${esc(spec.label)}</p></div>`;
}

/** 等宽命令行：校验命令、房号、版本号等。 */
export const codeLine = (text: string) => `<code class="code-line">${esc(text)}</code>`;

/** 状态徽章：草案 / 推荐 / 最新等。 */
export const badge = (text: string) => `<span class="badge">${esc(text)}</span>`;

/** 文书与帮助共用的页首；ornaments 只能是项目内的装饰 HTML。 */
export function documentHero(spec: { label: string; title: string; lead: string; ornaments?: string; file?: boolean; support?: boolean }) {
  const classes = ['agreement-hero', spec.file ? 'agreement-file' : '', spec.support ? 'support-hero' : '', 'ink'].filter(Boolean).join(' ');
  return `<section class="${classes}" id="top">${spec.ornaments ?? ''}<div class="agreement-hero-in">
<div class="agreement-kicker"><span class="label">${esc(spec.label)}</span></div><h1>${esc(spec.title)}</h1>
<p class="agreement-lead">${esc(spec.lead)}</p></div></section>`;
}

/** 文书与帮助目录中的一行；dataName 只允许小写字母、数字与短横线。 */
export function documentLink(spec: {
  href: string;
  number: string;
  title: string;
  summary: string;
  status?: string;
  heading?: 'h2' | 'h3';
  reveal?: boolean;
  dataName?: string;
  dataValue?: string;
}) {
  if (spec.dataName && !/^[a-z][a-z0-9-]*$/.test(spec.dataName)) throw new Error(`非法 data 属性：${spec.dataName}`);
  const heading = spec.heading ?? 'h2';
  const reveal = spec.reveal ? ' rv' : '';
  const data = spec.dataName ? ` data-${spec.dataName}="${esc(spec.dataValue ?? '')}"` : '';
  return `<a class="document-link${reveal}"${data} href="${esc(spec.href)}"><span class="document-number idx" aria-hidden="true">${esc(spec.number)}</span>
<div class="document-description"><${heading}>${esc(spec.title)}</${heading}><p>${esc(spec.summary)}</p>${
    spec.status
      ? `
<span class="document-status">${esc(spec.status)}</span>`
      : ''
  }</div>
<span class="document-arrow" aria-hidden="true">${ARROW_RIGHT}</span></a>`;
}

/** 文书正文或帮助文章的文字目录。 */
export function documentToc(label: string, ariaLabel: string, links: readonly (readonly [href: string, text: string])[]) {
  return `<aside class="document-toc"><span class="label">${esc(label)}</span><nav aria-label="${esc(ariaLabel)}">${links
    .map(([href, text]) => `<a href="${esc(href)}">${esc(text)}</a>`)
    .join('')}</nav></aside>`;
}
