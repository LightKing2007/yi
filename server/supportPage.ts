/** 官网帮助目录与独立问题页：复用文书组件与样式，以原生表单检索构建时嵌入的内容。 */
import { legalMarkdown } from './legalMarkdown';
import { esc, shell } from './page';
import { normalizeSupportQuery, searchSupport, SUPPORT_ARTICLES, SUPPORT_CATEGORIES, type SupportArticle } from './supportContent';
import { supportStyle } from './supportStyle';
import { SEARCH } from './webIcons';
import { documentHero, documentLink, documentToc } from './webUi';

/** 帮助检索词的规范化函数；files.ts 经此复用，避免再次直接引用 supportContent。 */
export { normalizeSupportQuery } from './supportContent';

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
  return documentLink({
    href: `/support/${article.slug}`,
    number,
    title: article.title,
    summary: article.summary,
    heading: 'h3',
    dataName: scripted ? 'support-entry' : undefined,
    dataValue: scripted ? article.slug : undefined,
  });
}

/** 静态目录先包含全部问题，浏览器脚本只切换 hidden；无脚本时完整目录仍可阅读。 */
function catalog(articles: readonly SupportArticle[], query: string, scripted: boolean) {
  const caption = scripted
    ? `<span id="support-result-label" aria-live="polite">全部问题</span><a class="document-back" id="support-clear" href="/support" hidden>清除搜索</a>
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
  const mode = query && !scripted ? '检索' : '目录';
  return `<div class="support-catalog" id="support-catalog"><div class="catalog-caption"><span class="label" id="support-caption">${mode}</span>
${caption}</div>${scripted ? groups + empty : articles.length ? groups : empty}</div>`;
}

/** 默认保留原服务端检索作为兼容回退；静态构建使用 scripted，输出完整目录和同源检索脚本。 */
export function supportPage(assetVersion: string, query = '', scripted = false) {
  const normalized = scripted ? '' : normalizeSupportQuery(query);
  const articles = scripted ? SUPPORT_ARTICLES : searchSupport(normalized);
  const hero = documentHero({
    label: '支持',
    title: '帮助与支持',
    lead: '按分类浏览，或输入关键词查找问题与解决方式。',
    ornaments: supportOrnaments(),
    file: true,
    support: true,
  });
  return shell({
    title: '弈 · 帮助与支持',
    description: '“弈”的帮助目录：检索下载安装、启动与画面、棋规与操作、联机对战、设置与数据等常见问题。',
    assetVersion,
    nav: navigation('#questions'),
    style: supportStyle(),
    script: scripted ? `/assets/support-search.js?v=${assetVersion}` : undefined,
    body: `${hero}<section class="agreement-content shell" id="questions"><div class="document-intro">
<form class="support-search" action="/support" method="get" role="search"><label class="label" for="support-query">检索帮助</label>
<div class="support-search-row"><span class="support-search-icon" aria-hidden="true">${SEARCH}</span>
<input id="support-query" type="search" name="q" value="${esc(normalized)}" maxlength="80" aria-controls="support-catalog"
placeholder="搜索问题、分类或解决方案" autocomplete="off"></div></form>
<p class="document-notice">每个问题都有独立页面。若按相应步骤仍未解决，请记录版本、操作系统与复现步骤，再提交问题反馈。</p></div>
${catalog(articles, normalized, scripted)}</section>`,
  });
}

/** 单个问题使用同一文书阅读布局，并提供返回目录与分类入口。 */
function articlePage(assetVersion: string, article: SupportArticle) {
  const links = [['/support', '全部问题'], ...SUPPORT_CATEGORIES.map(category => [`/support#${categoryId(category)}`, category] as const)] as const;
  const hero = documentHero({
    label: article.category,
    title: article.title,
    lead: '以下是针对该问题的排查步骤与解决方式。',
    ornaments: supportOrnaments(),
    file: true,
    support: true,
  });
  return shell({
    title: `弈 · ${article.title}`,
    description: article.summary,
    assetVersion,
    nav: navigation('/support#questions'),
    style: supportStyle(),
    body: `${hero}<section class="agreement-content shell" id="answer"><div class="document-layout">
${documentToc('浏览帮助', '浏览帮助', links)}
<article class="document-article" aria-label="${esc(article.title)}"><a class="document-back" href="/support">← 返回帮助目录</a>
${legalMarkdown(article.content).html}<div class="document-end"><a class="document-back" href="/support">查看其他问题</a></div>
</article></div></section>`,
  });
}

/** 独立问题页由构建器写入 HTML；兼容回退仍可在启动时生成。 */
export function supportPages(assetVersion: string): ReadonlyMap<string, Buffer> {
  return new Map(SUPPORT_ARTICLES.map(article => [`support/${article.slug}`, Buffer.from(articlePage(assetVersion, article))] as const));
}
