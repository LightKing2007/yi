/**
 * 依赖漏洞门禁（SEC-060、SEC-061）：随游戏与服务端分发的依赖有高危或严重漏洞时失败；只在开发时使用的工具的漏洞只列出、不阻断。
 *   node scripts/audit.mjs
 * 本项目的依赖都登记在 devDependencies（前端与服务端都打包为单个文件），`npm audit --omit=dev` 会跳过全部依赖、
 * 什么也不检查，因此改为读取完整的 `npm audit --json`，按 SHIPPED 列出的分发范围筛选。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

/**
 * 随安装程序或服务端分发的依赖；withDeps 表示其下级依赖也一并分发。
 * electron 包自身的下级依赖（@electron/get、extract-zip 等）只在安装时下载 Electron 本体，不随安装程序分发；
 * Electron 本体（Chromium、Node.js）的漏洞登记在 electron 包上，不允许豁免（SEC-060）
 */
export const SHIPPED = [
  { name: 'preact', withDeps: true },
  { name: '@preact/signals', withDeps: true },
  { name: 'ws', withDeps: true },
  { name: 'age-encryption', withDeps: true }, // 打包进 dist-server/offsite.cjs，在服务器上运行（P1-13）
  { name: 'electron', withDeps: false },
];
/** 阻断合并的严重程度（SEC-061：--audit-level=high） */
const BLOCKING = new Set(['high', 'critical']);

/** 按 Node.js 的查找规则，从锁文件路径 from 出发找依赖 name 的安装路径；找不到时返回 null */
function resolve(lock, from, name) {
  for (let dir = from; ;) {
    const candidate = `${dir ? dir + '/' : ''}node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    if (!dir) return null;
    const cut = dir.lastIndexOf('/node_modules/');
    dir = cut < 0 ? '' : dir.slice(0, cut);
  }
}

/** 分发范围内全部包在锁文件中的路径 */
export function shippedPaths(lock, shipped = SHIPPED) {
  const out = new Set();
  const visit = (pkgPath, withDeps) => {
    if (!pkgPath || out.has(pkgPath)) return;
    out.add(pkgPath);
    if (!withDeps) return;
    const info = lock.packages[pkgPath];
    for (const dep of Object.keys({ ...info.dependencies, ...info.optionalDependencies })) visit(resolve(lock, pkgPath, dep), true);
  };
  for (const { name, withDeps } of shipped) visit(resolve(lock, '', name), withDeps);
  return out;
}

/** 把 npm audit 的结果分为阻断与只列出两类：每项为 { name, severity, nodes } */
export function classify(report, shipped) {
  const blocking = [],
    listed = [];
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    const item = { name, severity: vuln.severity, nodes: vuln.nodes ?? [] };
    if (BLOCKING.has(vuln.severity) && item.nodes.some(node => shipped.has(node))) blocking.push(item);
    else listed.push(item);
  }
  return { blocking, listed };
}

/** 运行 npm audit --json：有漏洞时 npm 以非零退出码结束，仍从标准输出读取结果 */
function runAudit() {
  try {
    return execFileSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (failure) {
    if (failure.stdout) return failure.stdout;
    throw failure;
  }
}

function main() {
  const report = JSON.parse(runAudit());
  if (report.error) {
    console.error(`npm audit 无法完成，不能确认依赖是否安全：${report.error.summary ?? JSON.stringify(report.error)}`);
    return 1;
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const { blocking, listed } = classify(report, shippedPaths(lock));
  const show = item => `${item.name}（${item.severity}）：${item.nodes.join('、')}`;
  for (const item of listed) console.log(`  只列出：${show(item)}`);
  if (listed.length) console.log(`以上 ${listed.length} 项不在分发范围内或低于高危，不阻断，按 SEC-061 每周汇总`);
  if (!blocking.length) {
    console.log('依赖漏洞门禁通过：随游戏与服务端分发的依赖没有高危或严重漏洞（SEC-061）');
    return 0;
  }
  for (const item of blocking) console.error(`  阻断：${show(item)}`);
  console.error(`以上 ${blocking.length} 项为随游戏与服务端分发的依赖的高危或严重漏洞，须按 SEC-060 的期限修复`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.exitCode = main();
