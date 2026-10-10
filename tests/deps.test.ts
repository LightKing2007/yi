/** 依赖与工作流的供应链检查：许可证（COD-071）、分发依赖的漏洞门禁（SEC-061）、第三方 Action 固定到提交号（OPS-010） */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { classify, shippedPaths } from '../scripts/audit.mjs';
// @ts-expect-error 纯 JS 脚本，没有类型声明
import { badLicenses, licenseOk } from '../scripts/licenses.mjs';

describe('许可证（COD-071）', () => {
  it('GPL、AGPL、LGPL、SSPL 的各种写法以及缺失、UNLICENSED 都不合规', () => {
    for (const bad of ['GPL-3.0', 'GPL-2.0-only', 'AGPL-3.0-or-later', 'LGPL-2.1-or-later', 'SSPL-1.0', 'UNLICENSED', '', undefined])
      expect(licenseOk(bad), String(bad)).toBe(false);
    for (const good of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', 'BlueOak-1.0.0', '0BSD', { type: 'MIT' }])
      expect(licenseOk(good), JSON.stringify(good)).toBe(true);
  });

  it('OR 的备选中有一项合规即可，AND 连接的须全部合规', () => {
    expect(licenseOk('(MIT OR GPL-3.0)')).toBe(true);
    expect(licenseOk('(WTFPL OR ISC)')).toBe(true);
    expect(licenseOk('(MIT AND Zlib)')).toBe(true);
    expect(licenseOk('(MIT AND LGPL-3.0)')).toBe(false);
  });

  it('只检查依赖，不检查项目自身', () => {
    const lock = { packages: { '': { license: 'UNLICENSED' }, 'node_modules/a': { license: 'MIT' }, 'node_modules/b': { license: 'GPL-3.0' } } };
    expect(badLicenses(lock)).toEqual([['node_modules/b', 'GPL-3.0']]);
  });
});

describe('分发依赖的漏洞门禁（SEC-061）', () => {
  /** 一份锁文件：preact 依赖 x；electron 依赖 extract-zip（只在安装时下载 Electron 本体用）；ws 依赖嵌套安装的 y */
  const lock = {
    packages: {
      '': {},
      'node_modules/preact': { dependencies: { x: '^1' } },
      'node_modules/x': {},
      'node_modules/@preact/signals': {},
      'node_modules/ws': { dependencies: { y: '^2' } },
      'node_modules/ws/node_modules/y': {},
      'node_modules/y': {},
      'node_modules/electron': { dependencies: { 'extract-zip': '^2' } },
      'node_modules/extract-zip': {},
      'node_modules/vite': {},
    },
  };

  it('分发范围含随游戏打包的依赖及其下级依赖（按 Node.js 的查找规则先找嵌套安装的），electron 只含自身', () => {
    expect([...shippedPaths(lock)].sort()).toEqual([
      'node_modules/@preact/signals',
      'node_modules/electron',
      'node_modules/preact',
      'node_modules/ws',
      'node_modules/ws/node_modules/y',
      'node_modules/x',
    ]);
  });

  it('分发范围内的高危、严重漏洞阻断；范围外的或低于高危的只列出', () => {
    const report = {
      vulnerabilities: {
        electron: { severity: 'high', nodes: ['node_modules/electron'] },
        'extract-zip': { severity: 'high', nodes: ['node_modules/extract-zip'] },
        x: { severity: 'moderate', nodes: ['node_modules/x'] },
        y: { severity: 'critical', nodes: ['node_modules/y', 'node_modules/ws/node_modules/y'] },
        vite: { severity: 'critical', nodes: ['node_modules/vite'] },
      },
    };
    const { blocking, listed } = classify(report, shippedPaths(lock));
    expect(blocking.map((item: { name: string }) => item.name)).toEqual(['electron', 'y']);
    expect(listed.map((item: { name: string }) => item.name)).toEqual(['extract-zip', 'x', 'vite']);
  });
});

describe('工作流（OPS-010）', () => {
  it('引用的第三方 Action 都固定到 40 位提交号，并以注释标明版本', () => {
    const dir = new URL('../.github/workflows/', import.meta.url);
    const bad: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      for (const line of fs.readFileSync(new URL(file, dir), 'utf8').split('\n')) {
        const used = /^\s*-?\s*uses:\s*(\S+)(.*)$/.exec(line);
        if (used && !(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(used[1] ?? '') && /^\s+# v\d/.test(used[2] ?? ''))) bad.push(`${file}：${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
