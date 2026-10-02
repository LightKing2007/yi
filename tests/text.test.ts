/** 游戏里的说明文字（规则、帮助、更新日志、关于）：都有文言和英文译文，标点合乎 GB/T 15834，更新日志的版本号与 package.json 对得上（实现 I18N-060、I18N-061、I18N-064、I18N-070、I18N-082 及 I18N-010 的一部分，见 docs/standards/09-text-and-i18n.md） */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TABLE } from '../src/i18n/table';
import { INFO_PAGES } from '../src/ui/info';
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { changelog } from '../scripts/changelog.mjs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const keys = new Set(TABLE.map(r => r[0]));
const han = (s: string) => /[一-鿿]/.test(s);
const cmp = (a: string, b: string) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

describe('说明文字', () => {
  it('每一条都有文言和英文译文', () => {
    const missing: string[] = [];
    for (const page of INFO_PAGES)
      for (const l of page.lines) {
        for (const s of l.slice(1) as string[]) if (han(s) && !keys.has(s)) missing.push(s);
      }
    expect(missing).toEqual([]);
  });

  it('中文标点合乎 GB/T 15834：不混用半角标点，引号与括号成对，段落以句号结尾', () => {
    const bad: string[] = [];
    for (const page of INFO_PAGES)
      for (const l of page.lines) {
        for (const s of l.slice(1) as string[]) {
          if (!han(s)) continue;
          if (/[,;:!?()"']/.test(s)) bad.push(`半角标点：${s}`);
          if (s.split('“').length !== s.split('”').length || s.split('（').length !== s.split('）').length) bad.push(`不成对：${s}`);
        }
        if (l[0] === 'P' && han(l[1]) && !l[1].endsWith('。')) bad.push(`没有以句号结尾：${l[1]}`);
      }
    expect(bad).toEqual([]);
  });

  it('英文译文里没有长破折号', () => {
    const bad = TABLE.filter(r => /[—–]/.test(r[2])).map(r => r[2]);
    expect(bad).toEqual([]);
  });
});

describe('更新日志', () => {
  const log: { version: string; lines: string[] }[] = changelog();

  it('版本号从新到旧排列，每一节都有内容', () => {
    for (let i = 0; i < log.length; i++) {
      expect(log[i].version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(log[i].lines.length, log[i].version).toBeGreaterThan(0);
      if (i) expect(cmp(log[i - 1].version, log[i].version), `${log[i - 1].version} 应在 ${log[i].version} 之后`).toBeGreaterThan(0);
    }
  });

  it('每一条以表明变更类别的动词开头（I18N-070）', () => {
    const bad = log.flatMap(s => s.lines).filter(l => !/^(新增|优化|改进|增强|调整|更新|重新|修复|发布)/.test(l));
    expect(bad).toEqual([]);
  });

  it('最上面一节是当前版本，或者是正在准备的下一个版本', () => {
    expect(cmp(log[0].version, pkg.version)).toBeGreaterThanOrEqual(0);
    expect(
      log.some(s => s.version === pkg.version),
      `更新日志里没有当前版本 ${pkg.version}`,
    ).toBe(true);
  });
});
