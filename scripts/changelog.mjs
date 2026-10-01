/**
 * 读取游戏里的更新日志（src/ui/info.ts 的 LOG），发版脚本与 GitHub 上的出包流程都用它：
 *   node scripts/changelog.mjs check 2.0.2   检查最上面一节是不是这个版本、写了内容、每一条都有文言和英文译文
 *   node scripts/changelog.mjs notes 2.0.2   输出这个版本的 Release 说明（Markdown）
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/** 更新日志：[{ version, lines }]，从新到旧 */
export function changelog() {
  const src = read('src/ui/info.ts');
  const body = src.slice(src.indexOf('const LOG'), src.indexOf('];', src.indexOf('const LOG')));
  const out = [];
  for (const m of body.matchAll(/\['(H|P)', '((?:[^'\\]|\\.)*)'\]/g)) {
    if (m[1] === 'H') out.push({ version: m[2], lines: [] });
    else out.at(-1)?.lines.push(m[2]);
  }
  return out;
}

/** 译文表里已有的原文 */
function translated() {
  const keys = new Set();
  for (const m of read('src/i18n/table.ts').matchAll(/^\s*\["((?:[^"\\]|\\.)*)",/gm)) keys.add(m[1]);
  return keys;
}

/** 发版前的检查：返回问题列表，空表示可以发 */
export function check(version) {
  const log = changelog(), top = log[0], problems = [];
  if (!top || top.version !== version) problems.push(`更新日志最上面一节是 ${top?.version ?? '（没有）'}，应该是 ${version}`);
  else if (!top.lines.length) problems.push(`更新日志 ${version} 一节还没写内容`);
  else {
    const keys = translated();
    for (const l of top.lines) if (!keys.has(l)) problems.push(`这一条还没有文言和英文译文（src/i18n/table.ts）：${l}`);
  }
  return problems;
}

/** GitHub Release 的说明：这一版改了什么，再加上首次打开的提示 */
export function notes(version) {
  const sec = changelog().find(s => s.version === version);
  if (!sec) throw new Error(`更新日志里没有 ${version}`);
  return [
    `## 弈 ${version}`,
    '',
    ...sec.lines.map(l => `- ${l}`),
    '',
    '## 安装',
    '',
    '- 安装包见下方附件，也可以在 http://47.108.181.240:8443/ 下载。',
    '- macOS 第一次打开时，在访达里右键点这个程序再点打开，或者到系统设置的隐私与安全性里点仍要打开。',
    '- Windows 第一次运行时如果提示未知发布者，点更多信息，再点仍要运行。',
    '',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, version] = process.argv.slice(2);
  if (!version || !['check', 'notes'].includes(cmd)) { console.error('用法：node scripts/changelog.mjs check|notes 版本号'); process.exit(2); }
  if (cmd === 'notes') process.stdout.write(notes(version));
  else {
    const p = check(version);
    for (const s of p) console.error('✗ ' + s);
    if (p.length) process.exit(1);
    console.log(`✓ 更新日志 ${version} 已写好，译文齐全`);
  }
}
