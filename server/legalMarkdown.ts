/** 文书 Markdown 的受限渲染：支持标题、段落、列表、加粗和明确链接；原始 HTML 始终转义。 */
import { esc } from './page';

/** 正文标题及其锚点，供纯文字目录复用。 */
export interface LegalHeading {
  id: string;
  text: string;
  level: number;
}

/** 文书之间及项目反馈的固定入口；不执行任意协议、外部图片或内嵌 HTML。 */
const LINKS = new Set([
  '/agreement',
  '/download/',
  '/agreement/privacy-policy',
  '/agreement/terms-of-service',
  '/agreement/minors-privacy-rules',
  'https://github.com/LightKing2007/yi/issues',
  'https://github.com/LightKing2007/yi/security/advisories/new',
]);

/** 链接的标签与普通文字分别转义，仅白名单地址生成可点击链接。 */
function linked(text: string) {
  let html = '',
    position = 0;
  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    const label = match[1] ?? '',
      target = match[2] ?? '';
    html += esc(text.slice(position, match.index));
    html += LINKS.has(target) ? `<a href="${esc(target)}">${esc(label)}</a>` : esc(match[0]);
    position = match.index + match[0].length;
  }
  return html + esc(text.slice(position));
}

/** 成对的双星号生成强调；不完整标记保留原文，内容仍按普通文字处理。 */
function inline(text: string) {
  const pieces = text.split('**');
  if (pieces.length % 2 === 0) return linked(text);
  return pieces.map((piece, index) => (index % 2 ? `<strong>${linked(piece)}</strong>` : linked(piece))).join('');
}

/** 按空行划分的块：标题生成稳定编号锚点，列表仅处理同一类型的完整行。 */
function blockHtml(block: string, headings: LegalHeading[]) {
  const heading = /^(#{2,3}) (.+)$/.exec(block);
  if (heading) {
    const level = heading[1]?.length ?? 2,
      text = heading[2] ?? '',
      id = `section-${headings.length + 1}`;
    headings.push({ id, text, level });
    return `<h${level} id="${id}">${inline(text)}</h${level}>`;
  }
  const lines = block.split('\n');
  const unordered = lines.every(line => line.startsWith('- '));
  const ordered = lines.every(line => /^\d+\. /.test(line));
  if (unordered || ordered) {
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag}>${lines.map(line => `<li>${inline(line.replace(/^(?:- |\d+\. )/, ''))}</li>`).join('')}</${tag}>`;
  }
  return `<p>${inline(lines.join(' '))}</p>`;
}

/** 内容与目录一次生成；正文不含棋子编号装饰，空白文件也不会产生空段落。 */
export function legalMarkdown(source: string) {
  const headings: LegalHeading[] = [];
  const blocks = source
    .replaceAll('\r\n', '\n')
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean);
  return { html: blocks.map(block => blockHtml(block, headings)).join('\n'), headings };
}
