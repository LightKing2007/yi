/**
 * 读取游戏里的更新日志（src/ui/info.ts 的 LOG），发版脚本与 GitHub 上的出包流程都用它：
 *   node scripts/changelog.mjs check 2.0.2   检查最上面一节是不是这个版本、写了内容、每一条都有文言和英文译文
 *   node scripts/changelog.mjs notes 2.0.2   输出这个版本的发布说明（Markdown，GitHub Release 用）
 */
import { execSync } from 'node:child_process';
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

/** 某个版本的发布日期与联机协议版本：已打标签的取标签上的，否则取当前的 */
function facts(version) {
  const tag = `v${version}`;
  let date = new Date().toISOString().slice(0, 10), proto = read('src/shared/protocol.ts');
  try {
    date = execSync(`git log -1 --format=%cs ${tag}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || date;
    proto = execSync(`git show ${tag}:src/shared/protocol.ts`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* 还没打标签 */ }
  return { date, proto: Number(/PROTO_VERSION = (\d+)/.exec(proto)?.[1]) };
}

/** GitHub Release 的说明（发布说明）：概要、变更内容（按新增、改进、修复分类）、兼容性、安装 */
export function notes(version) {
  const sec = changelog().find(s => s.version === version);
  if (!sec) throw new Error(`更新日志里没有 ${version}`);
  const [, minor, patch] = version.split('.').map(Number);
  const kind = patch ? '修订版本' : minor ? '次版本' : '主版本';
  const { date, proto } = facts(version);
  const groups = [['新增', []], ['改进', []], ['修复', []]];
  for (const l of sec.lines) (l.startsWith('新增') ? groups[0] : l.startsWith('修复') ? groups[2] : groups[1])[1].push(l);
  const changes = groups.filter(g => g[1].length).flatMap(([name, ls], i) => [`### 1.${i + 1} ${name}`, '', ...ls.map(l => `- ${l}`), '']);
  return [
    `# 弈 ${version} 发布说明`,
    '',
    '| 项目 | 内容 |',
    '|---|---|',
    `| 版本号 | ${version} |`,
    `| 版本类型 | ${kind} |`,
    `| 发布日期 | ${date} |`,
    `| 联机协议 | 第 ${proto} 版 |`,
    `| 支持平台 | macOS 13 或更高版本（Apple 芯片、Intel 芯片）、Windows 10 或更高版本（x64）、Linux（x86_64） |`,
    '',
    '## 1 变更内容',
    '',
    ...changes,
    '## 2 兼容性',
    '',
    `本版本使用第 ${proto} 版联机协议，可与使用同一协议版本的客户端进行联机对战。段位及本机设置在升级后予以保留。`,
    '',
    '## 3 获取与安装',
    '',
    '- 安装程序见本页附件，亦可从官方下载页面 <http://47.108.181.240:8443/> 获取。',
    '- macOS：首次打开时，请在“访达”中按住 Control 键点按该应用程序并选择“打开”，或前往“系统设置”中的“隐私与安全性”，点按“仍要打开”。',
    '- Windows：首次运行时如出现“Windows 已保护你的电脑”提示，请点击“更多信息”，再点击“仍要运行”。',
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
