/** 官网文书目录与独立草案页：纯 CSS 动效，不记录同意动作（API-063）。 */
import { agreementStyle } from './agreementStyle';
import { AGREEMENT_DOCUMENTS, AGREEMENT_INFO, type AgreementDocument } from './agreementText';
import { esc, shell } from './page';
import { legalMarkdown } from './legalMarkdown';

/** 取自隐私、约定、守护与儿童主题的单字及偏旁；只作装饰，不参与阅读或点击。 */
function ornaments() {
  return `<div class="agreement-ornaments" aria-hidden="true">
<span class="depth-near">私</span><span class="depth-middle">护</span><span class="depth-far">约</span><span class="depth-near">知</span>
<span class="depth-middle">童</span><span class="depth-far">责</span><span class="depth-middle">允</span><span class="depth-near">宀</span>
<span class="depth-far">讠</span><span class="depth-middle">扌</span><span class="depth-near">丶</span><span class="depth-far">丨</span></div>`;
}

/** 目录中每一行都可点击，链接文字与独立页面标题保持一致。 */
function catalog() {
  const entries = AGREEMENT_DOCUMENTS.map(
    doc => `<a class="document-link rv" href="/${esc(doc.slug)}"><span class="document-number idx" aria-hidden="true">${doc.number}</span>
<div class="document-description"><h2>${esc(doc.name)}</h2><p>${esc(doc.summary)}</p>
<span class="document-status">${esc(AGREEMENT_INFO.status)} · ${esc(AGREEMENT_INFO.statusNote)}</span></div>
<span class="document-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
<path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></a>`,
  ).join('');
  return `<section class="agreement-catalog shell" id="documents" aria-label="文书目录"><div class="agreement-catalog-in">
<div class="catalog-caption rv"><span class="label">目录</span></div>${entries}</div></section>`;
}

/** 长文目录只使用普通文字，正文保留草案状态与尚未开放功能的明确说明。 */
function documentBody(document: AgreementDocument) {
  const rendered = legalMarkdown(document.content);
  const index = rendered.headings
    .filter(heading => heading.level === 2)
    .map(heading => `<a href="#${heading.id}">${esc(heading.text)}</a>`)
    .join('');
  const updated = new Date(`${AGREEMENT_INFO.updated}T00:00:00Z`).toLocaleDateString('zh-CN', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `<section class="agreement-content shell" id="document"><div class="document-intro">
<div class="document-meta"><span>${esc(AGREEMENT_INFO.status)} ${esc(AGREEMENT_INFO.version)} · ${esc(AGREEMENT_INFO.statusNote)}</span>
<time datetime="${esc(AGREEMENT_INFO.updated)}">更新于 ${esc(updated)}</time><span>${esc(AGREEMENT_INFO.operator)}</span></div>
<p class="document-notice">${esc(AGREEMENT_INFO.notice)}</p></div>
<div class="document-layout"><aside class="document-toc"><span class="label">本篇目录</span><nav aria-label="本篇目录">${index}</nav></aside>
<article class="document-article" aria-label="${esc(document.name)}正文"><a class="document-back" href="/agreement">← 返回文书目录</a>
${rendered.html}<div class="document-end"><a class="document-back" href="#top">返回顶部</a></div></article></div></section>`;
}

/** 复用官网外壳与动效，标题上方只保留“文书”。 */
export function agreementPage(assetVersion: string, doc?: AgreementDocument) {
  const title = doc?.name ?? AGREEMENT_INFO.title;
  return shell({
    title: `弈 · ${title}`,
    description: doc ? `阅读“弈”的《${doc.name}》草案，了解相关规则与待完善事项。` : '“弈”的文书目录：隐私政策、用户服务条款与未成年人个人信息保护规则。',
    assetVersion,
    nav: AGREEMENT_DOCUMENTS.map(document => [`/${document.slug}`, document.name]),
    action: doc ? ['/agreement', '文书目录'] : ['#documents', '查看文书'],
    style: agreementStyle(),
    body: `<section class="agreement-hero ink${doc ? ' agreement-file' : ''}" id="top">${ornaments()}<div class="agreement-hero-in">
<div class="agreement-kicker"><span class="label">文书</span></div><h1>${esc(title)}</h1>
<p class="agreement-lead">${esc(doc?.summary ?? AGREEMENT_INFO.introduction)}</p>
</div></section>${doc ? documentBody(doc) : catalog()}`,
  });
}

/** 目录与三份文件均在启动时生成，不依赖安装包目录或数据库。键为已解码的根路径。 */
export function agreementPages(assetVersion: string): ReadonlyMap<string, Buffer> {
  return new Map([
    ['agreement', Buffer.from(agreementPage(assetVersion))],
    ...AGREEMENT_DOCUMENTS.map(doc => [doc.slug, Buffer.from(agreementPage(assetVersion, doc))] as const),
  ]);
}
