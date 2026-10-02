/** 改动行覆盖率（scripts/diff-coverage.mjs，TST-011）：解析 git diff、按行汇总语句的执行次数、统计改动行的覆盖情况 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { addedLines, evaluate, lineHits } from '../scripts/diff-coverage.mjs';

const DIFF = [
  'diff --git a/server/a.ts b/server/a.ts',
  '--- a/server/a.ts',
  '+++ b/server/a.ts',
  '@@ -3,0 +4,2 @@ export function f() {',
  '+  const x = 1;',
  '+  return x;',
  '@@ -10 +12 @@',
  '-old',
  '+new',
  'diff --git a/server/gone.ts b/server/gone.ts',
  '--- a/server/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-x',
  '-y',
].join('\n');

/** 一份只含语句的覆盖率数据：每项为 [起始行, 执行次数] */
const coverageOf = (statements: [number, number][]) => ({
  statementMap: Object.fromEntries(statements.map(([line], i) => [String(i), { start: { line }, end: { line } }])),
  s: Object.fromEntries(statements.map(([, hits], i) => [String(i), hits])),
});

describe('改动行覆盖率（TST-011）', () => {
  it('从 diff 中取出每个文件新增与修改的行，删除的文件不计', () => {
    const added = addedLines(DIFF);
    expect(Object.keys(added)).toEqual(['server/a.ts']);
    expect([...added['server/a.ts']]).toEqual([4, 5, 12]);
  });

  it('同一行有多条语句时取执行次数的最大值', () => {
    expect(
      lineHits(
        coverageOf([
          [4, 0],
          [4, 2],
          [5, 0],
        ]),
      ),
    ).toEqual({ 4: 2, 5: 0 });
  });

  it('只统计计入覆盖率的文件中的可执行行', () => {
    const added = { 'server/a.ts': new Set([4, 5, 6, 12]), 'tests/x.test.ts': new Set([1]) };
    const coverage = {
      'server/a.ts': coverageOf([
        [4, 3],
        [5, 0],
        [12, 1],
      ]),
    };
    expect(evaluate(added, coverage)).toEqual({ total: 3, covered: 2, missed: ['server/a.ts:5'] });
  });
});
