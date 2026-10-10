/**
 * 面向玩家的文字：标点合乎 GB/T 15834，更新日志的版本号与 package.json 对得上（实现 I18N-060、I18N-061、I18N-064、I18N-070，
 * 见 docs/standards/09-text-and-i18n.md；译文是否齐全与英文的写法由 i18n.test.ts 检查）。
 * 标点的检查范围按 I18N-011：“更多”页面、译文表中的全部中文原文与文言译文（含禁着提示与服务端下发的提示）、安装程序文字、下载页面文字。
 * 错误码表随整改项 P2-03 建立，届时其原文同样是译文表的键，由译文表的检查覆盖。
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { downloadPage, PLATFORMS, type PagePkg } from '../server/page';
import { TABLE } from '../src/i18n/table';
import { INFO_PAGES, releasedLog, type InfoLine } from '../src/ui/info';
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { changelog } from '../scripts/changelog.mjs';
import { must } from './must';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const han = (s: string) => /[一-鿿]/.test(s);

/** 成对的标点（I18N-061）：开 → 合 */
const PAIRS: Record<string, string> = { '“': '”', '‘': '’', '（': '）', '《': '》' };
const CLOSING = new Set(Object.values(PAIRS));

/**
 * 一段中文的标点问题：混用半角的逗号、分号、冒号、叹号、问号、括号、引号（I18N-060）；引号、书名号、括号不成对或次序颠倒（I18N-061）。
 * 不含汉字的文字（命令、文件名、英文）不检查
 */
export function punctuationIssues(text: string): string[] {
  if (!han(text)) return [];
  const issues: string[] = [];
  if (/[,;:!?()"']/.test(text)) issues.push(`半角标点：${text}`);
  const open: string[] = [];
  for (const ch of text) {
    const closing = PAIRS[ch];
    if (closing !== undefined) open.push(closing);
    else if (CLOSING.has(ch) && open.pop() !== ch) return [...issues, `不成对：${text}`];
  }
  return open.length ? [...issues, `不成对：${text}`] : issues;
}

/** 段落以句号结尾（I18N-064） */
const paragraphIssues = (text: string) => [...punctuationIssues(text), ...(han(text) && !text.endsWith('。') ? [`没有以句号结尾：${text}`] : [])];
const cmp = (a: string, b: string) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const xi = x[i] ?? 0,
      yi = y[i] ?? 0;
    if (xi !== yi) return xi - yi;
  }
  return 0;
};

describe('说明文字', () => {
  it('中文与文言的标点合乎 GB/T 15834：不混用半角标点，引号与括号成对，段落以句号结尾', () => {
    const wy = new Map(TABLE.map(r => [r[0], r[1]]));
    const bad = INFO_PAGES.flatMap(page =>
      page.lines.flatMap(line => {
        const texts = (line.slice(1) as string[]).flatMap(text => [text, wy.get(text) ?? '']);
        return texts.flatMap(text => (line[0] === 'P' ? paragraphIssues(text) : punctuationIssues(text)));
      }),
    );
    expect(bad).toEqual([]);
  });
});

/** 安装程序的文字：`!define 名称 "值"`，值中的 `$\r$\n` 为换行；名称以 PAGE_TEXT 结尾的是正文，按空行分段 */
function installerTexts(source: string) {
  const defines = [...source.matchAll(/^\s*!define\s+(\w+)\s+"(.*)"\s*$/gm)].map(m => ({ name: m[1] ?? '', value: (m[2] ?? '').replaceAll('$\\r$\\n', '\n') }));
  return {
    paragraphs: defines.filter(def => def.name.endsWith('PAGE_TEXT')).flatMap(def => def.value.split('\n\n')),
    labels: defines.filter(def => !def.name.endsWith('PAGE_TEXT')).map(def => def.value),
  };
}

/** 下载页面不是段落的 <p>：首屏的棋种与标语 */
const PAGE_TAGLINES = ['kinds', 'motto'];

/** 下载页面的文字：页面由服务端生成，结构固定，按标签切分即可。段落为 <p> 与 <li>（标语除外），其余为标题、按钮、表格与属性中的文字 */
function pageTexts(html: string) {
  const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
  const decode = (text: string) => text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))).trim();
  const paragraphs = [...body.matchAll(/<(p|li)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(m => !PAGE_TAGLINES.some(cls => (m[2] ?? '').includes(`class="${cls}"`)))
    .map(m => decode((m[3] ?? '').replace(/<[^>]+>/g, '')));
  const segments = body.split(/<[^>]+>/).map(decode);
  const attributes = [...body.matchAll(/\s(?:content|alt|aria-label|title)="([^"]*)"/g)].map(m => decode(m[1] ?? ''));
  return { paragraphs, others: [...segments, ...attributes].filter(han) };
}

describe('标点的检查范围（I18N-011）', () => {
  it('译文表中的全部中文原文与文言译文：界面文字、禁着提示与服务端下发的提示', () => {
    expect(TABLE.flatMap(r => [...punctuationIssues(r[0]), ...punctuationIssues(r[1])])).toEqual([]);
  });

  it('Windows 安装程序的文字：正文每段以句号结尾', () => {
    const { paragraphs, labels } = installerTexts(fs.readFileSync(new URL('../build-res/installer.nsh', import.meta.url), 'utf8'));
    expect(paragraphs.length).toBeGreaterThanOrEqual(6);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect([...paragraphs.flatMap(paragraphIssues), ...labels.flatMap(punctuationIssues)]).toEqual([]);
  });

  it('下载页面的文字（有安装程序与尚无安装程序两种情况）：段落以句号结尾', () => {
    const pkgs: PagePkg[] = Object.keys(PLATFORMS).map((platform, i) => ({
      file: `Yi-${platform}`,
      version: '2.0.4',
      platform,
      size: 1e8,
      sha256: i ? 'ab' : null,
    }));
    for (const html of [downloadPage(pkgs, 'v'), downloadPage([], 'v')]) {
      const { paragraphs, others } = pageTexts(html);
      expect(paragraphs.length).toBeGreaterThanOrEqual(15);
      expect(paragraphs).toContain('为下载的文件添加执行权限：chmod +x Yi-*.AppImage。'); // 段落内的标签去掉后连成一段
      expect(others.some(text => text.endsWith('下载 macOS、Windows 及 Linux 版本。'))).toBe(true); // 页面描述等属性中的文字
      expect([...paragraphs.flatMap(paragraphIssues), ...others.flatMap(punctuationIssues)]).toEqual([]);
    }
  });
});

describe('标点检查 punctuationIssues', () => {
  it('不混用半角标点；不含汉字的文字不检查', () => {
    expect(punctuationIssues('落子，提子；停一手：好')).toEqual([]);
    for (const ch of [',', ';', ':', '!', '?', '(', ')', '"', "'"]) expect(punctuationIssues(`落子${ch}提子`), ch).toHaveLength(1);
    expect(punctuationIssues('chmod +x "Yi-*.AppImage"; ls')).toEqual([]);
  });

  it('引号、单引号、书名号、括号须成对且次序正确', () => {
    expect(punctuationIssues('点击“查看‘棋局’”（V 键），见《规则》')).toEqual([]);
    for (const text of ['点击“查看', '点击查看”', '（甲', '甲）', '”甲“', '“甲‘乙”’', '《甲']) expect(punctuationIssues(text), text).toHaveLength(1);
  });

  it('段落以句号结尾', () => {
    expect(paragraphIssues('单击“下一步”继续。')).toEqual([]);
    expect(paragraphIssues('单击“下一步”继续')).toHaveLength(1);
  });
});

describe('更新日志', () => {
  const log: { version: string; lines: string[] }[] = changelog();

  it('版本号从新到旧排列，每一节都有内容', () => {
    for (const [i, section] of log.entries()) {
      expect(section.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(section.lines.length, section.version).toBeGreaterThan(0);
      const prev = log[i - 1];
      if (prev) expect(cmp(prev.version, section.version), `${prev.version} 应在 ${section.version} 之后`).toBeGreaterThan(0);
    }
  });

  it('每一条以表明变更类别的动词开头（I18N-070）', () => {
    const bad = log.flatMap(s => s.lines).filter(l => !/^(新增|优化|改进|增强|调整|更新|重新|修复|发布)/.test(l));
    expect(bad).toEqual([]);
  });

  it('最上面一节是当前版本，或者是正在准备的下一个版本', () => {
    expect(cmp(must(log[0], '更新日志的第一节').version, pkg.version)).toBeGreaterThanOrEqual(0);
    expect(
      log.some(s => s.version === pkg.version),
      `更新日志里没有当前版本 ${pkg.version}`,
    ).toBe(true);
  });
});

describe('日志页中尚未发布的版本', () => {
  const LOG: InfoLine[] = [['H', '2.0.5'], ['P', '新增甲。'], ['G'], ['H', '2.0.4'], ['P', '修复乙。'], ['G'], ['H', '2.0.3'], ['P', '调整丙。']];

  it('开发时比当前版本新的一节保留内容，小标题改为待发布', () => {
    expect(releasedLog(LOG, '2.0.4', true)).toEqual([['U', '2.0.5'], ...LOG.slice(1)]);
  });

  it('打包时比当前版本新的一节连同其后的间距一并不显示，最上面一节即当前版本', () => {
    expect(releasedLog(LOG, '2.0.4', false)).toEqual(LOG.slice(3));
  });

  it('发版改了版本号之后，该节按已发布的版本正常显示', () => {
    expect(releasedLog(LOG, '2.0.5', false)).toEqual(LOG);
    expect(releasedLog(LOG, '2.0.5', true)).toEqual(LOG);
  });
});
