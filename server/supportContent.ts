/** 帮助问题清单：每篇 Markdown 自含标题、分类与答案，构建时嵌入官网。 */
import { SOURCES as DOWNLOAD_SOURCES } from './supportSources/download';
import { SOURCES as DISPLAY_SOURCES } from './supportSources/display';
import { SOURCES as RULES_SOURCES } from './supportSources/rules';
import { SOURCES as ONLINE_SOURCES } from './supportSources/online';
import { SOURCES as SETTINGS_SOURCES } from './supportSources/settings';

/** 一篇帮助文章的地址、目录信息与受限 Markdown 正文。 */
export interface SupportArticle {
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
}

const SOURCES: readonly (readonly [string, string])[] = [...DOWNLOAD_SOURCES, ...DISPLAY_SOURCES, ...RULES_SOURCES, ...ONLINE_SOURCES, ...SETTINGS_SOURCES];

/** 每篇文件只使用三个固定头部字段；摘要不把 Markdown 标记暴露到目录。 */
function parseArticle(slug: string, source: string): SupportArticle {
  const match = /^---\ntitle: ([^\n]+)\ncategory: ([^\n]+)\n---\n+([\s\S]+)$/.exec(source.replaceAll('\r\n', '\n').trim());
  if (!match) throw new Error(`帮助问题文件格式不正确：${slug}`);
  const content = match[3]?.trim() ?? '';
  const summary = (content.split(/\n\s*\n/)[0] ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replaceAll('**', '')
    .replace(/\s+/g, ' ')
    .trim();
  return { slug, title: match[1] ?? '', category: match[2] ?? '', summary, content };
}

/** 按分类源文件的登记顺序解析出的全部帮助文章。 */
export const SUPPORT_ARTICLES: readonly SupportArticle[] = SOURCES.map(([slug, source]) => parseArticle(slug, source));
/** 按首次出现顺序排列的帮助分类。 */
export const SUPPORT_CATEGORIES: readonly string[] = [...new Set(SUPPORT_ARTICLES.map(article => article.category))];
const MAX_QUERY_LENGTH = 80;

/** 搜索输入只保留前 80 个 Unicode 字符，避免生成无意义的长页面。 */
export const normalizeSupportQuery = (query: string) => Array.from(query.trim()).slice(0, MAX_QUERY_LENGTH).join('');

/** 多个空白分隔的关键词须同时命中；标题、分类和答案均参与检索。 */
export function searchSupport(query: string): readonly SupportArticle[] {
  const terms = normalizeSupportQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return SUPPORT_ARTICLES;
  return SUPPORT_ARTICLES.filter(article => {
    const text = `${article.title}\n${article.category}\n${article.content}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
}
