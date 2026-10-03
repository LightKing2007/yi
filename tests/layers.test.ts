/**
 * 分层检查（ARC-010 至 ARC-013，见 docs/standards/02-architecture.md 第 1 章）：src/、server/、electron/ 中每个文件的四种引用形式
 * （由语法树找出，见 importGraph.ts）都只能指向允许的层与允许的第三方包；模块之间没有环；本文件的规则表与规范第 1.1 条的表逐项一致。
 * 另以一组故意违规的源码确认每种违规都能被发现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { refsOf, resolve, sourceFiles, type Ref } from './importGraph';

const ROOT = path.join(__dirname, '..');

/** 每一层可以依赖哪些层（自己这一层总是可以） */
const ALLOWED: Record<string, string[]> = {
  core: [],
  shared: ['core'],
  session: ['core'],
  presentation: ['core', 'shared', 'app'],
  render: ['core', 'app', 'fx'],
  fx: ['core', 'app', 'audio', 'presentation', 'render', 'scene'],
  scene: ['core', 'render', 'online'],
  audio: ['core', 'app'],
  i18n: ['app'],
  online: ['core', 'shared', 'app', 'audio', 'i18n'],
  app: ['core', 'shared', 'session', 'presentation', 'render', 'fx', 'scene', 'audio', 'i18n', 'online'],
  ui: ['core', 'shared', 'app', 'audio', 'fx', 'i18n', 'online', 'scene', 'render'],
  main: ['app', 'audio', 'online', 'ui'],
  server: ['core', 'shared'],
  electron: [],
};

/** 每一层可以使用的第三方包与运行时模块；`node:*` 表示全部 Node.js 内置模块（必须带 `node:` 前缀） */
const PACKAGES: Record<string, string[]> = {
  core: [],
  shared: [],
  session: [],
  presentation: [],
  render: [],
  fx: [],
  scene: [],
  audio: [],
  i18n: [],
  online: [],
  app: ['@preact/signals'],
  ui: ['preact', '@preact/signals'],
  main: [],
  server: ['ws', 'node:*'],
  electron: ['electron', 'node:*'],
};

/** 文件所在的层：src 下的第一级目录（src/main.tsx 算 main），server/ 与 electron/ 各算一层；其他位置没有层 */
function layerOf(file: string): string | null {
  const parts = file.split('/');
  if (parts[0] === 'server' || parts[0] === 'electron') return parts[0];
  if (parts[0] !== 'src') return null;
  return parts.length === 2 ? parts[1].replace(/\.tsx?$/, '') : parts[1];
}

/** 该层能否使用这个包 */
const packageAllowed = (layer: string, pkg: string) => PACKAGES[layer].includes(pkg) || (pkg.startsWith('node:') && PACKAGES[layer].includes('node:*'));

/** 一处引用的问题；没有问题时为 null */
function problemOf(file: string, from: string, ref: Ref): string | null {
  const at = `${file}:${ref.line}`;
  if (ref.spec === null) return `${at} 动态 import() 的参数不是字符串字面量，无法检查`;
  const target = resolve(ROOT, file, ref.spec);
  if ('unresolved' in target) return `${at} 找不到 ${ref.spec}`;
  if ('pkg' in target) return packageAllowed(from, target.pkg) ? null : `${at} ${from} 层不允许使用 ${target.pkg}`;
  const to = layerOf(target.file);
  return to === from || (to !== null && ALLOWED[from].includes(to)) ? null : `${at} ${from} → ${to ?? target.file}（${ref.spec}）`;
}

/** 一个文件中违反分层的引用（ARC-011、ARC-012）；只有类型的引用不算（ARC-013） */
function problems(file: string, source = fs.readFileSync(path.join(ROOT, file), 'utf8')): string[] {
  const from = layerOf(file);
  if (from === null || !ALLOWED[from] || !PACKAGES[from]) return [`${file} 不属于任何已定义的层`];
  return refsOf(source, file)
    .filter(ref => !ref.typeOnly)
    .map(ref => problemOf(file, from, ref))
    .filter((msg): msg is string => msg !== null);
}

const FILES = ['src', 'server', 'electron'].flatMap(dir => sourceFiles(ROOT, dir));

/** 模块之间的运行时依赖：文件 → 它引用的仓库中的文件 */
function dependencyGraph() {
  const graph = new Map<string, string[]>();
  for (const file of FILES) {
    const refs = refsOf(fs.readFileSync(path.join(ROOT, file), 'utf8'), file).filter(ref => !ref.typeOnly && ref.spec !== null);
    const deps = refs.map(ref => resolve(ROOT, file, ref.spec ?? '')).flatMap(target => ('file' in target ? [target.file] : []));
    graph.set(file, deps);
  }
  return graph;
}

/** 找出依赖图中的环（深度优先搜索遇到正在访问的节点即为环），每个环以经过的文件列出 */
function cyclesOf(graph: Map<string, string[]>) {
  const state = new Map<string, 'visiting' | 'done'>(),
    trail: string[] = [],
    cycles: string[][] = [];
  const visit = (file: string) => {
    state.set(file, 'visiting');
    trail.push(file);
    for (const dep of graph.get(file) ?? []) {
      if (state.get(dep) === 'visiting') cycles.push(trail.slice(trail.indexOf(dep)));
      else if (!state.has(dep)) visit(dep);
    }
    trail.pop();
    state.set(file, 'done');
  };
  for (const file of graph.keys()) if (!state.has(file)) visit(file);
  return cycles;
}

describe('分层', () => {
  it('每个源文件都属于已定义的层；各层只朝允许的方向依赖，只使用允许的第三方包（四种引用形式都检查）', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.flatMap(file => problems(file))).toEqual([]);
  });

  it('模块之间没有互相引用（没有环，ARC-010）', () => {
    expect(cyclesOf(dependencyGraph())).toEqual([]);
  });

  it('环检查能发现环', () => {
    const graph = new Map([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
      ['d', ['a']],
    ]);
    expect(cyclesOf(graph)).toEqual([['a', 'b', 'c']]);
  });
});

describe('故意违规的引用都能被发现', () => {
  /** 假装是 src/core 中的一个文件，检查这段源码 */
  const inCore = (source: string) => problems('src/core/probe.ts', source);

  it('四种引用形式（以及 export * 与 import = require）引用不允许的层时都报告', () => {
    const forms = [
      "import { App } from '../ui/App';",
      "import '../ui/App';",
      "export { App } from '../ui/App';",
      "export * from '../ui/App';",
      "const ui = await import('../ui/App');",
      "import ui = require('../ui/App');",
      "import { type Props, App } from '../ui/App';",
    ];
    for (const source of forms) expect(inCore(source), source).toEqual([`src/core/probe.ts:1 core → ui（../ui/App）`]);
  });

  it('只有类型的引用不计入依赖（ARC-013）', () => {
    const forms = [
      "import type { App } from '../ui/App';",
      "import { type App } from '../ui/App';",
      "export type { App } from '../ui/App';",
      "export { type App } from '../ui/App';",
      "type T = import('../ui/App').Props;",
    ];
    for (const source of forms) expect(inCore(source), source).toEqual([]);
  });

  it('使用不允许的第三方包、不带 node: 前缀的内置模块时报告（ARC-012）', () => {
    expect(inCore("import { h } from 'preact';")).toEqual(['src/core/probe.ts:1 core 层不允许使用 preact']);
    expect(inCore("import { signal } from '@preact/signals/x';")).toEqual(['src/core/probe.ts:1 core 层不允许使用 @preact/signals']);
    expect(inCore("import fs from 'node:fs';")).toEqual(['src/core/probe.ts:1 core 层不允许使用 node:fs']);
    expect(problems('server/probe.ts', "import fs from 'fs';")).toEqual(['server/probe.ts:1 server 层不允许使用 fs']);
    expect(problems('server/probe.ts', "import fs from 'node:fs';\nimport { WebSocket } from 'ws';")).toEqual([]);
  });

  it('桌面版主进程严禁依赖 src/；引用找不到的文件、动态 import() 的参数不是字面量时都报告', () => {
    expect(problems('electron/probe.ts', "import { MAXN } from '../src/core/types';")).toEqual(['electron/probe.ts:1 electron → core（../src/core/types）']);
    expect(inCore("import './nope';")).toEqual(['src/core/probe.ts:1 找不到 ./nope']);
    expect(inCore('const name = "x";\nawait import(name);')).toEqual(['src/core/probe.ts:2 动态 import() 的参数不是字符串字面量，无法检查']);
    expect(problems('scripts/probe.ts', '')).toEqual(['scripts/probe.ts 不属于任何已定义的层']);
  });
});

/** 规范第 1.1 条的表：层 → [允许依赖的层, 允许的第三方包] */
function standardTable() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/standards/02-architecture.md'), 'utf8');
  const head = doc.indexOf('| 层 | 职责 | 允许依赖的层 | 允许的第三方包与运行时模块 |');
  const rows = doc.slice(head).split('\n').slice(2);
  const table = new Map<string, [string[], string[]]>();
  for (const row of rows) {
    if (!row.startsWith('| ')) break;
    const [layer, , deps, pkgs] = row
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim());
    // “上述全部（除 …）”：表中排在前面的各层
    const layers = deps.startsWith('上述全部') ? [...table.keys()] : deps === '—' || deps.startsWith('无') ? [] : deps.split('、');
    table.set(layer, [layers, pkgs.startsWith('无') ? [] : pkgs.split('、').map(cell => cell.replace(/`/g, ''))]);
  }
  return table;
}

describe('规则表与规范一致（ARC-014）', () => {
  it('本文件的 ALLOWED、PACKAGES 与规范第 1.1 条的表逐项一致', () => {
    const table = standardTable();
    expect([...table.keys()].sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const [layer, [deps, pkgs]] of table) {
      expect([...deps].sort(), `${layer} 允许依赖的层`).toEqual([...ALLOWED[layer]].sort());
      expect([...pkgs].sort(), `${layer} 允许的第三方包`).toEqual([...PACKAGES[layer]].sort());
    }
  });
});
