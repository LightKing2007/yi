/** 错误码表与 04-api.md 第 8 节一致（API-021），且错误码符合两段式 kebab-case 命名（04-api.md 第 3.1 条、COD-019）。 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ERRORS } from '../src/shared/errors';

/** 第 8 节各表的数据行：首列为反引号包住的错误码，第二列为级别 */
function documented(): Record<string, string> {
  const text = readFileSync(path.resolve(__dirname, '../docs/standards/04-api.md'), 'utf8');
  const section = text.slice(text.indexOf('## 8 初始错误码表'));
  const rows = section.split('\n').map(line => /^\| `([^`]+)` \| (E[1-5]) \|/.exec(line));
  return Object.fromEntries(rows.flatMap(row => (row ? [[row[1], row[2]]] : [])));
}

it('错误码表与规范第 8 节的错误码及级别逐项一致', () => {
  const table = Object.fromEntries(Object.entries(ERRORS).map(([code, def]) => [code, def.level]));
  expect(table).toEqual(documented());
  expect(Object.keys(table).length).toBeGreaterThan(30);
});

it('错误码为两段式 kebab-case，原文非空', () => {
  for (const [code, def] of Object.entries(ERRORS)) {
    expect(code).toMatch(/^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/);
    expect(def.text.length).toBeGreaterThan(0);
  }
});
