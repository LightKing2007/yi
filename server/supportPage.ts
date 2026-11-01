/** 官网帮助目录与独立问题页：复用文书样式，以原生表单检索构建时嵌入的内容。 */
import { agreementStyle } from './agreementStyle';
import { legalMarkdown } from './legalMarkdown';
import { esc, shell } from './page';
import { minify } from './pageStyle';
import { normalizeSupportQuery, searchSupport, SUPPORT_ARTICLES, SUPPORT_CATEGORIES, type SupportArticle } from './supportContent';

const STYLE = `
.support-hero { background: radial-gradient(54% 96% at 82% 48%, rgb(214 169 100 / 0.065), transparent 74%); }
.support-ornaments { position: absolute; z-index: 1; inset: 0; overflow: hidden; pointer-events: none; }
.support-grid { position: absolute; inset: 0 0 0 34%;
  background: linear-gradient(rgb(236 231 221 / 0.08) 1px, transparent 1px) 0 0 / 56px 56px,
    linear-gradient(90deg, rgb(236 231 221 / 0.08) 1px, transparent 1px) 0 0 / 56px 56px;
  -webkit-mask: radial-gradient(ellipse 78% 96% at 80% 46%, #000 8%, transparent 74%);
  mask: radial-gradient(ellipse 78% 96% at 80% 46%, #000 8%, transparent 74%); }
.support-rain { position: absolute; inset: 0 -2% 0 38%; overflow: hidden;
  -webkit-mask: linear-gradient(90deg, transparent, #000 48%); mask: linear-gradient(90deg, transparent, #000 48%); }
.support-stream { position: absolute; top: -360px; display: flex; flex-direction: column; align-items: center; gap: 13px;
  color: var(--kaya); font: 400 16px/1.2 var(--serif); opacity: 0; text-shadow: 0 0 14px rgb(214 169 100 / 0.18);
  animation: support-rain 16s linear infinite; }
.support-stream i { font-style: normal; opacity: 0.045; }
.support-stream i:nth-last-child(5) { opacity: 0.09; }
.support-stream i:nth-last-child(4) { opacity: 0.16; }
.support-stream i:nth-last-child(3) { opacity: 0.26; }
.support-stream i:nth-last-child(2) { opacity: 0.44; }
.support-stream i:last-child { opacity: 0.88; }
.support-stream:nth-child(1) { left: 1%; animation-duration: 15s; animation-delay: -8s; }
.support-stream:nth-child(2) { left: 10%; animation-duration: 18s; animation-delay: -2s; }
.support-stream:nth-child(3) { left: 19%; animation-duration: 13s; animation-delay: -11s; }
.support-stream:nth-child(4) { left: 28%; animation-duration: 20s; animation-delay: -6s; }
.support-stream:nth-child(5) { left: 37%; animation-duration: 16s; animation-delay: -14s; }
.support-stream:nth-child(6) { left: 46%; animation-duration: 19s; animation-delay: -4s; }
.support-stream:nth-child(7) { left: 55%; animation-duration: 14s; animation-delay: -10s; }
.support-stream:nth-child(8) { left: 64%; animation-duration: 17s; animation-delay: -7s; }
.support-stream:nth-child(9) { left: 73%; animation-duration: 21s; animation-delay: -16s; }
.support-stream:nth-child(10) { left: 82%; animation-duration: 15s; animation-delay: -3s; }
.support-stream:nth-child(11) { left: 91%; animation-duration: 18s; animation-delay: -12s; }
.support-stream:nth-child(12) { left: 97%; animation-duration: 14s; animation-delay: -5s; }
@keyframes support-rain { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 0.72; }
  86% { opacity: 0.72; } 100% { transform: translateY(1040px); opacity: 0; } }
.support-search { max-width: 840px; margin-bottom: 36px; }
.support-search label { display: block; margin-bottom: 12px; }
.support-search-row { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 14px; align-items: center;
  min-height: 66px; padding: 8px 22px; border: 1px solid rgb(20 18 16 / 0.13); border-radius: 20px;
  background: rgb(255 255 255 / 0.4); box-shadow: 0 8px 24px rgb(40 32 22 / 0.045), inset 0 1px 0 rgb(255 255 255 / 0.5);
  transition: border-color 0.3s var(--ease), box-shadow 0.3s var(--ease), background 0.3s var(--ease); }
.support-search-row:focus-within { border-color: rgb(181 132 67 / 0.65); background: rgb(255 255 255 / 0.54);
  box-shadow: 0 0 0 3px rgb(181 132 67 / 0.09), 0 10px 28px rgb(40 32 22 / 0.055); }
.support-search-icon { display: grid; place-items: center; width: 22px; height: 22px; color: var(--faint); }
.support-search-icon svg { width: 22px; height: 22px; }
.support-search input { width: 100%; min-width: 0; height: 48px; padding: 0; border: 0; border-radius: 0;
  color: var(--fg); background: transparent; font: 16px/1.5 var(--sans); color-scheme: light; }
.support-search input::placeholder { color: var(--faint); }
.support-search input:focus { outline: none; }
.support-catalog { max-width: var(--max); margin: 0 auto; }
@media (min-width: 721px) {
  .support-catalog .document-description { width: calc(100% - 32px); transition: width 0.55s var(--ease); }
  .support-catalog .document-link:hover .document-description { width: 100%; }
}
.support-group { margin-top: 64px; }
.support-group:first-child { margin-top: 0; }
.support-group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; padding-bottom: 16px;
  border-bottom: 1px solid var(--fg); scroll-margin-top: 96px; }
.support-group-head h2 { font: 900 clamp(24px, 2.8vw, 34px)/1.5 var(--serif); }
.support-group-head span { color: var(--faint); font-size: 13px; }
.document-description h3 { font: 900 clamp(21px, 2.4vw, 30px)/1.5 var(--serif); text-wrap: balance; }
.support-empty { max-width: var(--max); margin: 0 auto; padding: 56px 0; border-top: 1px solid var(--line); }
.support-empty h2 { font: 900 clamp(26px, 3vw, 38px)/1.5 var(--serif); }
.support-empty p { margin: 16px 0 28px; color: var(--dim); }
@media (max-width: 720px) {
  .support-grid { left: 18%; background-size: 44px 44px; }
  .support-rain { left: 24%; opacity: 0.65; }
  .support-stream { font-size: 14px; }
  .support-search-row { grid-template-columns: 20px minmax(0, 1fr); gap: 10px; min-height: 58px; padding: 6px 16px; border-radius: 16px; }
  .support-search-icon, .support-search-icon svg { width: 20px; height: 20px; }
  .support-search input { height: 44px; }
  .support-group { margin-top: 48px; }
  .support-group-head { scroll-margin-top: 136px; }
}
@media (prefers-reduced-motion: reduce) {
  .support-stream { animation: none; opacity: 0.16; transform: translateY(340px); }
}
@media print {
  .support-search, .support-ornaments { display: none; }
}
`;

function navigation(searchHref: string): [string, string][] {
  return [
    [searchHref, '查找问题'],
    ['/agreement', '政策与条款'],
  ];
}

/** 下载页同源棋盘格与纯 CSS 汉字数字雨；字符向标题方向渐隐。 */
function supportOrnaments() {
  const streams = [
    '下载后无法打开怎么办',
    '先检查系统版本与安装权限',
    '黑屏时请确认浏览器支持',
    '棋钟暂停时请检查对局状态',
    '联机失败可以先检查网络',
    '如何恢复默认的游戏设置',
    '更新前会自动保留本地数据',
    '声音太小可以调整音量',
    '如何确认下载文件完整',
    '使用校验值核对安装文件',
    '反馈问题时请附上复现步骤',
    '隐私数据仅按政策说明处理',
  ];
  const rain = streams.map(stream => `<span class="support-stream">${[...stream].map(character => `<i>${character}</i>`).join('')}</span>`).join('');
  return `<div class="support-ornaments" aria-hidden="true"><i class="support-grid"></i><div class="support-rain">${rain}</div></div>`;
}

function categoryId(category: string) {
  return `support-category-${SUPPORT_CATEGORIES.indexOf(category) + 1}`;
}

function entry(article: SupportArticle, scripted: boolean) {
  const number = String(SUPPORT_ARTICLES.indexOf(article) + 1).padStart(2, '0');
  const marker = scripted ? ` data-support-entry="${esc(article.slug)}"` : '';
  return `<a class="document-link"${marker} href="/support/${esc(article.slug)}"><span class="document-number idx" aria-hidden="true">${number}</span>
<div class="document-description"><h3>${esc(article.title)}</h3><p>${esc(article.summary)}</p></div>
<span class="document-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
<path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></a>`;
}

/** 静态目录先包含全部问题，浏览器脚本只切换 hidden；无脚本时完整目录仍可阅读。 */
function catalog(articles: readonly SupportArticle[], query: string, scripted: boolean) {
  const caption = scripted
    ? `<span id="support-result-label">全部问题</span><a class="document-back" id="support-clear" href="/support" hidden>清除搜索</a>
<span id="support-result-count">${SUPPORT_ARTICLES.length} 篇帮助</span>`
    : query
      ? `<span>“${esc(query)}”的搜索结果</span><a class="document-back" href="/support">清除搜索</a>`
      : `<span>全部问题</span><span>${SUPPORT_ARTICLES.length} 篇帮助</span>`;
  const groups = SUPPORT_CATEGORIES.map(category => {
    const matches = articles.filter(article => article.category === category);
    if (!matches.length) return '';
    const id = categoryId(category);
    return `<section class="support-group" id="${id}"${scripted ? ` data-support-group="${id}"` : ''}><div class="support-group-head"><h2>${esc(category)}</h2>
<span>${matches.length} 个问题</span></div>${matches.map(article => entry(article, scripted)).join('')}</section>`;
  }).join('');
  const empty = `<div class="support-empty" id="support-empty"${scripted && articles.length ? ' hidden' : ''}><h2>没有找到相关问题</h2><p>可以尝试更短的关键词，或浏览全部问题。</p>
<a class="document-back" href="/support">← 查看全部 ${SUPPORT_ARTICLES.length} 个问题</a></div>`;
  return `<div class="support-catalog"><div class="catalog-caption"><span class="label" id="support-caption">${query && !scripted ? '检索' : '目录'}</span>
${caption}</div>${scripted ? groups + empty : articles.length ? groups : empty}</div>`;
}

/** 默认保留原服务端检索作为兼容回退；静态构建使用 scripted，输出完整目录和同源检索脚本。 */
export function supportPage(assetVersion: string, query = '', scripted = false) {
  const normalized = scripted ? '' : normalizeSupportQuery(query);
  const articles = scripted ? SUPPORT_ARTICLES : searchSupport(normalized);
  return shell({
    title: '弈 · 帮助与支持',
    description: '“弈”的帮助目录：检索下载安装、启动与画面、棋规与操作、联机对战、设置与数据等常见问题。',
    assetVersion,
    nav: navigation('#questions'),
    style: agreementStyle() + minify(STYLE),
    script: scripted ? `/assets/support-search.js?v=${assetVersion}` : undefined,
    body: `<section class="agreement-hero agreement-file support-hero ink" id="top">${supportOrnaments()}<div class="agreement-hero-in">
<div class="agreement-kicker"><span class="label">支持</span></div><h1>帮助与支持</h1>
<p class="agreement-lead">按分类浏览，或输入关键词查找问题与解决方式。</p>
</div></section><section class="agreement-content shell" id="questions"><div class="document-intro">
<form class="support-search" action="/support" method="get" role="search"><label class="label" for="support-query">检索帮助</label>
<div class="support-search-row"><span class="support-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
stroke-width="1.4"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></span>
<input id="support-query" type="search" name="q" value="${esc(normalized)}" maxlength="80"
placeholder="搜索问题、分类或解决方案" autocomplete="off"></div></form>
<p class="document-notice">每个问题都有独立页面。若按相应步骤仍未解决，请记录版本、操作系统与复现步骤，再提交问题反馈。</p></div>
${catalog(articles, normalized, scripted)}</section>`,
  });
}

/** 单个问题使用同一文书阅读布局，并提供返回目录与分类入口。 */
function articlePage(assetVersion: string, article: SupportArticle) {
  return shell({
    title: `弈 · ${article.title}`,
    description: article.summary,
    assetVersion,
    nav: navigation('/support#questions'),
    style: agreementStyle() + minify(STYLE),
    body: `<section class="agreement-hero agreement-file support-hero ink" id="top">${supportOrnaments()}<div class="agreement-hero-in">
<div class="agreement-kicker"><span class="label">${esc(article.category)}</span></div><h1>${esc(article.title)}</h1>
<p class="agreement-lead">以下是针对该问题的排查步骤与解决方式。</p>
</div></section><section class="agreement-content shell" id="answer"><div class="document-layout">
<aside class="document-toc"><span class="label">浏览帮助</span><nav aria-label="浏览帮助"><a href="/support">全部问题</a>
${SUPPORT_CATEGORIES.map(category => `<a href="/support#${categoryId(category)}">${esc(category)}</a>`).join('')}</nav></aside>
<article class="document-article" aria-label="${esc(article.title)}"><a class="document-back" href="/support">← 返回帮助目录</a>
${legalMarkdown(article.content).html}<div class="document-end"><a class="document-back" href="/support">查看其他问题</a></div>
</article></div></section>`,
  });
}

/** 独立问题页由构建器写入 HTML；兼容回退仍可在启动时生成。 */
export function supportPages(assetVersion: string): ReadonlyMap<string, Buffer> {
  return new Map(SUPPORT_ARTICLES.map(article => [`support/${article.slug}`, Buffer.from(articlePage(assetVersion, article))] as const));
}
