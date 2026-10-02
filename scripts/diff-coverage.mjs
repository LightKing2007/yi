/**
 * 改动行的测试覆盖率（TST-011）：PR 中新增与修改的可执行行，覆盖率必须 ≥ 80%。
 *   node scripts/diff-coverage.mjs [基准]     基准默认为 origin/main，与它的合并基点比较（含未提交的改动）
 * 先运行 npm run test:coverage 生成 .vitest/coverage/coverage-final.json。只统计计入覆盖率的文件（vite.config.ts 的 coverage.include）；
 * “可执行行”指覆盖率报告中有语句开始的行。CI 中以 HEAD^1 为基准：PR 的检查运行在合并提交上，其第一个父提交即 main。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const REPORT = path.join(root, '.vitest/coverage/coverage-final.json');
/** 改动行覆盖率的下限（TST-011） */
const MIN_PERCENT = 80;
/** 未覆盖的行最多列出几行，其余只给总数 */
const LIST_MAX = 40;

/** 解析 git diff --unified=0 的输出：{ 文件: 新增或修改的行号集合 } */
export function addedLines(diff) {
  const out = {};
  let file = null;
  for (const line of diff.split('\n')) {
    const target = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/.exec(line);
    if (target) {
      file = target[1] ?? null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !file) continue;
    const start = Number(hunk[1]),
      count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    out[file] ??= new Set();
    for (let n = start; n < start + count; n++) out[file].add(n);
  }
  return out;
}

/** 一个文件各可执行行的执行次数：{ 行号: 次数 }（同一行有多条语句时取最大值） */
export function lineHits(fileCoverage) {
  const hits = {};
  for (const [id, loc] of Object.entries(fileCoverage.statementMap)) {
    const line = loc.start.line;
    hits[line] = Math.max(hits[line] ?? 0, fileCoverage.s[id]);
  }
  return hits;
}

/** 汇总改动行的覆盖情况：{ total, covered, missed: [文件:行] } */
export function evaluate(added, coverage) {
  let total = 0,
    covered = 0;
  const missed = [];
  for (const [file, lines] of Object.entries(added)) {
    const fileCoverage = coverage[file];
    if (!fileCoverage) continue; // 不计入覆盖率的文件（画面、测试、脚本等）
    const hits = lineHits(fileCoverage);
    for (const line of [...lines].sort((one, two) => one - two)) {
      if (hits[line] === undefined) continue; // 空行、注释、类型声明等不可执行的行
      total++;
      if (hits[line] > 0) covered++;
      else missed.push(`${file}:${line}`);
    }
  }
  return { total, covered, missed };
}

function main(argv) {
  if (!fs.existsSync(REPORT)) {
    console.error('没有覆盖率报告，请先运行 npm run test:coverage');
    return 1;
  }
  const base = argv[0] ?? 'origin/main';
  const diff = execFileSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--merge-base', base], { cwd: root, encoding: 'utf8' });
  const raw = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const coverage = Object.fromEntries(Object.entries(raw).map(([file, data]) => [path.relative(root, file), data]));
  const { total, covered, missed } = evaluate(addedLines(diff), coverage);
  if (!total) {
    console.log('改动中没有计入覆盖率的可执行行（TST-011 不适用）');
    return 0;
  }
  const percent = (100 * covered) / total;
  const summary = `改动行覆盖率 ${percent.toFixed(1)}%（${covered}/${total}），要求 ≥ ${MIN_PERCENT}%（TST-011）`;
  if (percent >= MIN_PERCENT) {
    console.log(summary);
    return 0;
  }
  console.error(summary);
  for (const where of missed.slice(0, LIST_MAX)) console.error(`  未覆盖：${where}`);
  if (missed.length > LIST_MAX) console.error(`  ……另有 ${missed.length - LIST_MAX} 行`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.exitCode = main(process.argv.slice(2));
