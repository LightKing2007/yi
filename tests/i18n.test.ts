/**
 * 译文的完整性与英文的写法（实现 I18N-010、I18N-012、I18N-013，见 docs/standards/09-text-and-i18n.md 第 10 章）：
 * 译文表没有重复的键、每行都有文言与英文译文、三种语言的格式占位符一致；英文不用长破折号、缩写形式与美式拼写；
 * src/ 与 server/ 中显示在界面上的每一处中文都在译文表中。
 * 界面上的中文包括 T()、TF() 的参数、禁着提示表、服务端下发的提示与“更多”页面的文字，它们都以字面量写在源码中，所以逐一扫描全部含汉字的字面量，
 * 只排除诊断信息（tests/uiText.ts）与下面两张清单中不翻译的文字。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABLE } from '../src/i18n/table';
import { sourceFiles } from './importGraph';
import { hanTextsOf, type HanText } from './uiText';

const ROOT = path.resolve(__dirname, '..');
const keys = new Set(TABLE.map(r => r[0]));

/** 不扫描的文件：其中的中文不显示在游戏界面上，或本身就是译文表 */
const SKIPPED_FILES: Record<string, string> = {
  'src/i18n/table.ts': '译文表本身',
  'src/i18n/index.ts': '文言数字的写法（零、十、又半等），由 TF() 拼接',
  'src/app/scenarios.ts': '画面回归的场景脚本，以网址参数启用，只在开发与截图时运行',
  'src/app/storage.ts': '本地存储损坏时的诊断信息，只写入日志',
  'src/shared/parse.ts': '消息校验失败的原因，只写入日志',
  'server/store.ts': '段位存档的诊断信息，只写入服务端日志',
  'server/log.ts': '日志模块本身，文字只写入服务端日志',
  'server/main.ts': '服务端入口，文字只写入服务端日志',
  'server/page.ts': '下载页面只有中文，标点由 I18N-011 检查',
  'server/pageStyle.ts': '下载页面的样式',
  'server/files.ts': '下载页面的 HTTP 应答，只有中文',
};

/** 不翻译的文字：文件 → { 文字: 原因 }。清单中的每一项都须仍在源码中 */
const UNTRANSLATED: Record<string, Record<string, string>> = {
  'src/ui/panels.tsx': {
    未有所提: '文言专用的说法，只在界面语言为文言时显示',
    文言: '语言选项以各自的语言书写',
    中文: '语言选项以各自的语言书写',
  },
  'src/main.tsx': {
    '`无法启动：${(e as Error).message}`': '启动失败时显示的诊断信息，此时界面与设置可能都未建立',
  },
};

/** 格式占位符的类型序列，与 TF() 的写法一致：%d %s %f 及 %.1f 等精度写法，%% 不计 */
const placeholders = (text: string) => [...text.matchAll(/%(%|(?:\.\d+)?[dsfiu])/g)].map(m => m[1].slice(-1)).filter(conv => conv !== '%');

describe('译文表', () => {
  it('中文原文键没有重复（I18N-013）', () => {
    const dup = TABLE.map(r => r[0]).filter((k, i, all) => all.indexOf(k) !== i);
    expect(dup).toEqual([]);
  });

  it('每一行的文言与英文译文都不为空', () => {
    expect(TABLE.filter(r => !r[1].trim() || !r[2].trim())).toEqual([]);
  });

  it('三种语言的格式占位符种类与顺序一致，TF() 按顺序代入参数时不会错位', () => {
    const bad = TABLE.filter(r => placeholders(r[1]).join() !== placeholders(r[0]).join() || placeholders(r[2]).join() !== placeholders(r[0]).join());
    expect(bad).toEqual([]);
  });
});

/** 缩写形式（I18N-012 列出的 n't 're 'll 've 'm 'd，以及代词与疑问词后的 's）；名词所有格的 's 不算。直撇号与弯撇号都查 */
const CONTRACTION = /n['’]t\b|['’](?:re|ll|ve|m|d)\b|\b(?:it|that|there|here|what|who|where|how|let|he|she)['’]s\b/i;

/** I18N-012 列出的美式拼写词及其屈折形式，英国拼写为 colour、centre、organise、recognise、behaviour、favourite、analyse、cancelled、grey */
const AMERICAN = /\b(?:colors?|colored|coloring|centers?|centered|organiz\w*|recogniz\w*|behaviors?|favorites?|analyz\w*|cancel(?:ed|ing)|gray\w*)\b/i;

/** 长破折号（I18N-082）：— 与 – */
const DASH = /[—–]/;

/** 一条英文译文违反的写法 */
export const englishIssues = (text: string) =>
  [DASH.test(text) && '长破折号', CONTRACTION.test(text) && '缩写形式', AMERICAN.test(text) && '美式拼写'].filter(issue => issue !== false);

describe('英文译文的写法（I18N-012、I18N-080 至 I18N-082）', () => {
  it('不含长破折号、缩写形式与美式拼写', () => {
    expect(TABLE.filter(r => englishIssues(r[2]).length).map(r => `${englishIssues(r[2]).join('、')}：${r[2]}`)).toEqual([]);
  });

  it('检查能发现每一类写法', () => {
    for (const text of ['A — B', 'A – B']) expect(englishIssues(text), text).toEqual(['长破折号']);
    for (const text of ["can't", 'isn’t', "you're", "we'll", "I've", "I'm", "you'd", "It's", "that's", "who's", "Let's"])
      expect(englishIssues(text), text).toEqual(['缩写形式']);
    for (const text of ['color', 'Colors', 'centered', 'organize', 'Recognized', 'behaviors', 'favorite', 'analyzing', 'canceled', 'gray'])
      expect(englishIssues(text), text).toEqual(['美式拼写']);
  });

  it('名词所有格、英国拼写与例外的 dialog 不误报', () => {
    const fine = [
      "Black's turn",
      "the opponent's stones",
      "one's own",
      'colour',
      'centre',
      'organise',
      'recognise',
      'behaviour',
      'favourite',
      'analyse',
      'cancelled',
      'grey',
      'dialog',
    ];
    for (const text of fine) expect(englishIssues(text), text).toEqual([]);
  });
});

describe('界面文字的静态扫描（I18N-010）', () => {
  const files = [...sourceFiles(ROOT, 'src'), ...sourceFiles(ROOT, 'server')].filter(file => !(file in SKIPPED_FILES));
  const found = files.flatMap(file => hanTextsOf(fs.readFileSync(path.join(ROOT, file), 'utf8'), file).map(hit => ({ file, ...hit })));
  const exempt = (hit: HanText & { file: string }) => hit.diagnostic || UNTRANSLATED[hit.file]?.[hit.text] !== undefined;

  it('扫描到了界面文字：T() 的参数、禁着提示、服务端下发的提示、“更多”页面', () => {
    const at = (file: string, text: string) => found.some(hit => hit.file === file && hit.text === text && !exempt(hit));
    expect(at('src/ui/panels.tsx', '单人游戏')).toBe(true);
    expect(at('src/shared/reject.ts', '这里是禁着点，落下后没有气')).toBe(true);
    expect(at('server/rooms.ts', '房号不存在，或房间已经开始')).toBe(true);
    expect(at('src/ui/info.ts', '对局模式')).toBe(true);
  });

  it('src/ 与 server/ 中显示在界面上的每一处中文都在译文表中，且不在含插值的模板字符串中', () => {
    const bad = found
      .filter(hit => !exempt(hit) && (hit.template || !keys.has(hit.text)))
      .map(hit => `${hit.file}:${hit.line} ${hit.template ? '含插值，无法查译文表' : '缺译文'}：${hit.text}`);
    expect(bad).toEqual([]);
  });

  it('不扫描的文件与不翻译的文字清单中没有过时的条目', () => {
    const stale = [
      ...Object.keys(SKIPPED_FILES).filter(file => !fs.existsSync(path.join(ROOT, file))),
      ...Object.entries(UNTRANSLATED).flatMap(([file, texts]) => Object.keys(texts).filter(text => !found.some(hit => hit.file === file && hit.text === text))),
    ];
    expect(stale).toEqual([]);
  });
});

describe('扫描工具 hanTextsOf', () => {
  const scan = (source: string, file = 'a.tsx') => hanTextsOf(source, file).map(hit => [hit.text, hit.template, hit.diagnostic]);

  it('找出字符串字面量、无插值的模板字符串与 JSX 文本，不计注释与不含汉字的文字', () => {
    const source = "// 注释\nconst a = T('甲'), b = `乙`, c = 'abc';\n/** 文档注释 */\nconst d = <div title=\"丙\">\n  丁\n</div>;";
    expect(scan(source)).toEqual([
      ['甲', false, false],
      ['乙', false, false],
      ['丙', false, false],
      ['丁', false, false],
    ]);
  });

  it('汉字在模板的固定部分时报告整个模板；只在插值中的字面量单独报告', () => {
    expect(scan("const a = `第 ${n} 手`, b = `${T('棋手')}${n}`;")).toEqual([
      ['`第 ${n} 手`', true, false],
      ['棋手', false, false],
    ]);
  });

  it('日志函数、Error 一类构造的参数与 throw 语句中的文字是诊断信息', () => {
    const source = [
      "logError('甲', e);",
      'this.log(`乙 ${x}`);',
      "console.warn('丙');",
      "throw new StoreLoadError(f, 1, '丁');",
      "if (bad) throw '戊';",
      "Promise.reject(new Error('己'));",
    ].join('\n');
    expect(scan(source, 'a.ts').every(([, , diagnostic]) => diagnostic)).toBe(true);
    expect(scan(source, 'a.ts')).toHaveLength(6);
  });

  it('其他调用中的文字，以及日志参数里回调函数中的文字，都不是诊断信息', () => {
    const source = "send(p, { t: 'error', text: '甲' });\nlogError('x', () => flash('乙'));\ncatalog('丙');";
    expect(scan(source, 'a.ts')).toEqual([
      ['甲', false, false],
      ['乙', false, false],
      ['丙', false, false],
    ]);
  });
});
