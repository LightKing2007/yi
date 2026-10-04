/** 违规棘轮（scripts/ratchet.mjs）的各项统计与比较：例外声明、文本格式、长行、模块说明、待办、catch 注释、文档注释、注释率（OPS-015） */
import { describe, expect, it } from 'vitest';
import {
  badTextFormat,
  badTodos,
  commentLines,
  compare,
  countExceptions,
  declaredException,
  hasModuleComment,
  importCount,
  limitsLineLength,
  longLines,
  reasonLongEnough,
  shortCatchReasons,
  undocumentedExports,
  // @ts-expect-error 纯 JS 脚本，没有类型声明
} from '../scripts/ratchet.mjs';

describe('例外声明（00-general.md 第 4.4 节）', () => {
  it('原因不少于 8 个汉字或 4 个英文单词才算合格', () => {
    expect(reasonLongEnough('忽略')).toBe(false);
    expect(reasonLongEnough('ESLint 只读取默认导出')).toBe(false);
    expect(reasonLongEnough('Vite 只读取配置文件的默认导出')).toBe(true);
    expect(reasonLongEnough('the library has no types')).toBe(true);
  });

  it('声明写在违规的同一行或上一行时识别，规则编号不符时不算', () => {
    const lines = ['const a = 1;', '// 例外 COD-055：Vite 只读取配置文件的默认导出', 'export default x;', 'f(y!); // 例外 COD-052：刚确认过这一项存在'];
    expect(declaredException(lines, 3, ['COD-055'])).toBe('COD-055');
    expect(declaredException(lines, 4, ['COD-052'])).toBe('COD-052');
    expect(declaredException(lines, 3, ['COD-051'])).toBeNull();
    expect(declaredException(lines, 1, ['COD-055'])).toBeNull();
  });

  it('按规则统计例外数，原因过短的另计为不合格', () => {
    const files = [['a.ts', '// 例外 COD-052：刚确认过这一项存在\n// 例外 COD-052：忽略\n// 例外 COD-051：外部库缺少类型定义只能如此\n']];
    expect(countExceptions(files)).toEqual({ byRule: { 'COD-052': 2, 'COD-051': 1 }, malformed: 1 });
  });
});

describe('ESLint 无法表达的规则', () => {
  it('COD-001：带 BOM、含 CR、末尾没有换行或多一个换行的文件不合规', () => {
    expect(badTextFormat('a\n')).toBe(false);
    expect(badTextFormat('')).toBe(false);
    expect(badTextFormat('\u{FEFF}a\n')).toBe(true);
    expect(badTextFormat('a\r\n')).toBe(true);
    expect(badTextFormat('a')).toBe(true);
    expect(badTextFormat('a\n\n')).toBe(true);
  });

  it('COD-003：按字符而不是字节计算行长，超过 160 个才算', () => {
    expect(longLines('汉'.repeat(160) + '\n' + 'x'.repeat(161))).toBe(1);
  });

  it('按行解析的文字数据（译文表、说明文字与更新日志）不计超长行，其他源文件照常统计（COD-003）', () => {
    expect(limitsLineLength('src/i18n/table.ts')).toBe(false);
    expect(limitsLineLength('src/ui/info.ts')).toBe(false);
    for (const file of ['src/ui/panels.tsx', 'src/i18n/index.ts', 'scripts/ratchet.mjs']) expect(limitsLineLength(file), file).toBe(true);
  });

  it('COD-030：第一行是注释（可在 #! 行之后）才算有模块说明', () => {
    expect(hasModuleComment('/** 模块 */\nexport {};')).toBe(true);
    expect(hasModuleComment('#!/usr/bin/env node\n// 模块\n')).toBe(true);
    expect(hasModuleComment('import x from "y";\n')).toBe(false);
  });

  it('COD-035：只认带 Issue 编号的 TODO，FIXME、XXX、HACK 一律不合规', () => {
    expect(badTodos('// TODO(#12): 说明\n// TODO: 说明\n/* FIXME(#3): 说明 */\nconst TODO_LIST = 1;', 'x.ts')).toBe(2);
    expect(badTodos("const s = '// TODO: 字符串里的不算';", 'x.ts')).toBe(0);
  });

  it('COD-041：只数 import 语句', () => {
    expect(importCount("import a from 'a';\nimport type { B } from 'b';\nconst importx = 1;\n")).toBe(2);
  });

  it('COD-062：catch 内只有一条原因不足 8 个汉字的注释时计数', () => {
    expect(shortCatchReasons('try { f(); } catch { /* 忽略 */ }', 'x.ts')).toBe(1);
    expect(shortCatchReasons('try { f(); } catch (e) {\n  // 读不到就使用默认设置继续运行\n}', 'x.ts')).toBe(0);
    expect(shortCatchReasons('try { f(); } catch { g(); }', 'x.ts')).toBe(0);
    expect(shortCatchReasons('try { f(); } catch {}', 'x.ts')).toBe(0);
  });
});

describe('文档注释与注释率', () => {
  it('COD-031：只数没有 /** */ 文档注释的顶层导出', () => {
    const text = ['/** 有 */', 'export const a = 1;', '// 普通注释不算', 'export function b() {}', 'export interface C {}', 'const d = 1;'].join('\n');
    expect(undocumentedExports('x.ts', text)).toBe(2);
  });

  it('COD-032：整行注释记 1 行，行尾注释记 0.5 行，空行不计', () => {
    const text = ['// 整行注释', 'const a = 1; // 行尾注释', '', '/**', ' * 多行', ' */', 'const b = `', 'x`;'].join('\n');
    expect(commentLines('x.ts', text)).toEqual({ comment: 4.5, code: 3 });
  });
});

describe('比较', () => {
  it('分出增加与减少的项，一方没有的项按 0 计', () => {
    expect(compare({ a: 3, b: 2, gone: 1 }, { a: 4, b: 1, added: 2 })).toEqual({
      up: [
        ['a', 3, 4],
        ['added', 0, 2],
      ],
      down: [
        ['b', 2, 1],
        ['gone', 1, 0],
      ],
    });
  });
});
