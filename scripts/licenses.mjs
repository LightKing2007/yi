/**
 * 依赖许可证检查（COD-071）：package-lock.json 中每个包的许可证都不得是 GPL、AGPL、LGPL、SSPL，也不得缺失或为 UNLICENSED。
 *   node scripts/licenses.mjs
 * 许可证按 SPDX 表达式理解：OR 的备选中有一项合规即可，AND 连接的各项须全部合规。本项目自身（锁文件的根）不检查。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
/** 禁止的许可证（COD-071）：按 SPDX 标识的前缀判断，含 GPL-2.0-only、LGPL-2.1-or-later 等各种写法 */
const FORBIDDEN = /^(A?GPL|LGPL|SSPL)(-|$)/i;

/** 一个包的许可证是否合规；expr 为 SPDX 表达式（旧格式的 { type } 对象也接受） */
export function licenseOk(expr) {
  const text = typeof expr === 'object' && expr !== null ? expr.type : expr;
  if (typeof text !== 'string' || !text.trim()) return false;
  const alternatives = text.replace(/[()]/g, ' ').split(/\s+OR\s+/i);
  const allowed = id => id !== '' && id.toUpperCase() !== 'UNLICENSED' && !FORBIDDEN.test(id);
  return alternatives.some(alt => alt.split(/\s+AND\s+/i).every(id => allowed(id.trim())));
}

/** 锁文件中许可证不合规的包：[[路径, 许可证]] */
export function badLicenses(lock) {
  return Object.entries(lock.packages)
    .filter(([pkgPath, info]) => pkgPath !== '' && !licenseOk(info.license))
    .map(([pkgPath, info]) => [pkgPath, info.license ?? '（缺失）']);
}

function main() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const bad = badLicenses(lock);
  const total = Object.keys(lock.packages).length - 1;
  if (!bad.length) {
    console.log(`许可证检查通过：${total} 个包均未使用 GPL、AGPL、LGPL、SSPL，且都有许可证（COD-071）`);
    return 0;
  }
  for (const [pkgPath, license] of bad) console.error(`  ${pkgPath}：${license}`);
  console.error(`以上 ${bad.length} 个包的许可证不合规（COD-071）`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.exitCode = main();
