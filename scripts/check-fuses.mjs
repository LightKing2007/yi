/**
 * 核对打包好的桌面版的 Electron Fuses（SEC-033，整改项 P2-08）：从二进制中读出各开关的实际状态，与 package.json 中
 * build.electronFuses 的配置逐项比对，任一项不符时退出码为 1。
 *   node scripts/check-fuses.mjs <应用>   macOS 为 .app 目录，Windows 为 .exe，Linux 为解包目录中的可执行文件
 * 二进制中的格式（@electron/fuses）：标记串之后依次为版本号、开关个数，每个开关一个字节：'0' 关、'1' 开、'r' 已移除。
 */
import fs from 'node:fs';
import path from 'node:path';

const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
/** 配置项在开关序列中的位置（@electron/fuses 的 FuseV1Options） */
export const FUSE_INDEX = {
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  loadBrowserProcessSpecificV8Snapshot: 6,
  grantFileProtocolExtraPrivileges: 7,
};
const STATE = { 48: '关', 49: '开', 114: '已移除' };

/** 从二进制中读出开关序列：各开关的字节值；找不到标记串时抛出 */
export function readFuses(binary) {
  const at = binary.indexOf(SENTINEL);
  if (at < 0) throw new Error('二进制中没有 Fuses 的标记串');
  const start = at + SENTINEL.length;
  const count = binary[start + 1];
  return Array.from(binary.subarray(start + 2, start + 2 + count));
}

/** 与配置逐项比对：[配置项, 期望, 实际, 是否相符] */
export function compareFuses(config, fuses) {
  return Object.entries(config)
    .filter(([name]) => Object.hasOwn(FUSE_INDEX, name))
    .map(([name, want]) => {
      const actual = STATE[fuses[FUSE_INDEX[name]]] ?? '无';
      const expected = want ? '开' : '关';
      return [name, expected, actual, expected === actual];
    });
}

/** 含开关序列的二进制：macOS 在 Electron Framework 中，其他平台即可执行文件本身 */
export function fuseBinary(app) {
  return app.endsWith('.app') ? path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework') : app;
}

function main([app]) {
  if (!app) throw new Error('用法：node scripts/check-fuses.mjs <应用>');
  const config = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).build?.electronFuses;
  if (!config) throw new Error('package.json 的 build.electronFuses 未配置');
  const rows = compareFuses(config, readFuses(fs.readFileSync(fuseBinary(app))));
  for (const [name, expected, actual, ok] of rows) console.log(`${ok ? '✓' : '✗'} ${name}：应为${expected}，实为${actual}`);
  if (rows.some(row => !row[3])) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 2;
  }
}
