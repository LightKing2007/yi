/**
 * 文档相对链接检查（DOC-004）：`docs/` 与仓库根部的全部 Markdown 文档，其相对链接与页内锚点必须指向存在的文件或标题。
 * 检查范围与要求见 docs/README.md 第 10.2 条；外部网址（`http`、`https`、`mailto` 等）与纯页内跳转不在检查范围。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** 仓库根目录：本文件位于 tests/ 下 */
const ROOT = path.resolve(__dirname, '..');
/** 需要递归遍历的文档目录（DOC-004 的检查范围） */
const DOC_DIRS = ['docs'];
/** 位于仓库根部、同样属于项目文档的 Markdown 文件 */
const ROOT_FILES = ['README.md', 'SECURITY.md', 'CLAUDE.md'];
/** 文档文件的后缀 */
const MARKDOWN_SUFFIX = '.md';
/** Markdown 行内链接或图片，捕获括号内的目标 */
const LINK = /!?\[[^\]]*\]\(([^)]+)\)/g;
/** 带协议的绝对网址，外部链接不检查 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Markdown 标题行，捕获井号与标题文本 */
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
/** 代码围栏：围栏内的行不是正文，其中的井号不是标题 */
const FENCE = /^\s*```/;
/** 链接目标与标题之间的空白，如 `(a.md "标题")` */
const TARGET_END = /\s/;
/** 文档数与链接数的最小值：防止正则或路径出错后测试空跑通过 */
const MIN_DOC_FILES = 40;
const MIN_LINKS = 400;

/** 一个待检查的相对链接：所在文件（相对仓库根目录）与原始目标 */
interface DocLink {
  file: string;
  target: string;
}

/** 递归收集目录下的 Markdown 文件，返回相对仓库根目录的路径；目录不存在时返回空列表 */
function markdownFiles(dir: string): string[] {
  const absolute = path.resolve(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    // 以点开头的目录（如 .git）不存放项目文档
    if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : markdownFiles(path.join(dir, entry.name));
    return entry.name.endsWith(MARKDOWN_SUFFIX) ? [path.join(dir, entry.name)] : [];
  });
}

/** 去掉链接两侧的尖括号与可选的标题，返回相对目标；外部网址、纯锚点与空目标返回 undefined */
function relativeTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  const withoutBrackets = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
  const titleAt = withoutBrackets.search(TARGET_END);
  const target = titleAt < 0 ? withoutBrackets : withoutBrackets.slice(0, titleAt);
  if (target === '' || SCHEME.test(target) || target.startsWith('#')) return undefined;
  return target;
}

/** 收集全部文档中的相对链接；解析失败的目标按原样保留，交给存在性检查报告 */
function relativeLinks(files: readonly string[]): DocLink[] {
  return files.flatMap(file => {
    const text = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
    return [...text.matchAll(LINK)].flatMap(match => {
      const raw = match[1];
      if (raw === undefined) return [];
      const target = relativeTarget(raw);
      return target === undefined ? [] : [{ file, target }];
    });
  });
}

/** 链接目标中的百分号编码；编码非法时保留原样，由存在性检查报告 */
function decoded(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** 标题文本生成 GitHub 的页内锚点：去掉行内代码与链接语法，保留文字、数字、标记、连字符与空格，空格改为连字符 */
function slugify(heading: string): string {
  const plain = heading.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return plain
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** 文件中的全部标题锚点；重复标题按出现顺序追加 `-1`、`-2`，与 GitHub 的做法一致 */
function headingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    const match = fenced ? null : HEADING.exec(line);
    const heading = match?.[2];
    if (heading === undefined) continue;
    const base = slugify(heading);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** 链接目标拆为文件部分与页内锚点；没有锚点时 anchor 为 undefined */
function splitAnchor(target: string): { file: string; anchor: string | undefined } {
  const hash = target.indexOf('#');
  const file = hash < 0 ? target : target.slice(0, hash);
  const anchor = hash < 0 ? undefined : target.slice(hash + 1);
  return { file, anchor: anchor === '' ? undefined : anchor };
}

/** 以链接所在文件为基准，得到目标的绝对路径 */
function resolvedTarget(link: DocLink, file: string): string {
  return path.resolve(path.dirname(path.resolve(ROOT, link.file)), decoded(file));
}

describe('文档相对链接（DOC-004）', () => {
  const files = [...ROOT_FILES, ...DOC_DIRS.flatMap(dir => markdownFiles(dir))];
  const links = relativeLinks(files);

  it('检查范围覆盖 docs 与仓库根部的全部 Markdown 文档', () => {
    // 排除本测试自身所在目录之外的缓存与构建产物后，文档数与链接数不应低于下限
    expect(files.length).toBeGreaterThanOrEqual(MIN_DOC_FILES);
    expect(links.length).toBeGreaterThanOrEqual(MIN_LINKS);
  });

  it('每个相对链接都指向存在的文件或目录', () => {
    const issues = links.flatMap(link => {
      const { file } = splitAnchor(link.target);
      const target = resolvedTarget(link, file);
      const ok = fs.existsSync(target) && (file.endsWith('/') ? fs.statSync(target).isDirectory() : true);
      return ok ? [] : [`${link.file}: 链接目标不存在：${link.target}`];
    });
    expect(issues).toEqual([]);
  });

  it('每个页内锚点都指向目标文件中存在的标题', () => {
    const issues = links.flatMap(link => {
      const { file, anchor } = splitAnchor(link.target);
      if (anchor === undefined) return [];
      const target = resolvedTarget(link, file);
      if (!fs.existsSync(target) || !target.endsWith(MARKDOWN_SUFFIX)) return [];
      const anchors = headingAnchors(fs.readFileSync(target, 'utf8'));
      return anchors.has(decoded(anchor)) ? [] : [`${link.file}: 页内锚点不存在：${link.target}`];
    });
    expect(issues).toEqual([]);
  });
});
