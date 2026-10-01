/**
 * 依赖方向检查（实现 ARC-010、ARC-011 的一部分，见 docs/standards/02-architecture.md）：读出 src/ 与 server/ 每个文件的 import（只看运行时引用，import type 不算），
 * 确认模块之间没有互相引用，各层只朝允许的方向依赖。新增的引用违反规则时这里会失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');

function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** 模块名：相对仓库根目录、去掉扩展名，例如 src/core/game */
const mod = (f: string) => path.relative(ROOT, f).replace(/\.tsx?$/, '').split(path.sep).join('/');

/** 层：src 下的第一级目录（src/main.tsx 算 main），server 下的都算 server */
const layer = (m: string) => (m.startsWith('server/') ? 'server' : m.split('/')[1]);

const graph = new Map<string, Set<string>>();
for (const f of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'server'))]) {
  const deps = new Set<string>();
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import\s+(type\s+)?[^'"]*?from\s+'(\.[^']+)'/gm)) {
    if (m[1]) continue;
    const t = path.resolve(path.dirname(f), m[2]);
    for (const ext of ['.ts', '.tsx', '/index.ts']) if (fs.existsSync(t + ext)) { deps.add(mod(t + ext)); break; }
  }
  graph.set(mod(f), deps);
}

/** 每一层可以依赖哪些层（自己这一层总是可以） */
const ALLOWED: Record<string, string[]> = {
  core: [],
  shared: ['core'],
  session: ['core'],
  server: ['core', 'shared'],
  presentation: ['core', 'shared', 'app'],
  render: ['core', 'app', 'fx'],
  fx: ['core', 'app', 'audio', 'presentation', 'render', 'scene'],
  scene: ['core', 'render', 'online'],
  audio: ['core', 'app'],
  i18n: ['app'],
  online: ['core', 'shared', 'app', 'audio', 'i18n'],
  app: ['core', 'shared', 'session', 'presentation', 'render', 'fx', 'scene', 'audio', 'online', 'i18n'],
  ui: ['core', 'shared', 'app', 'audio', 'fx', 'i18n', 'online', 'scene', 'render'],
  main: ['app', 'audio', 'online', 'ui'],
};

describe('依赖方向', () => {
  it('模块之间没有互相引用（没有环）', () => {
    const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>(), cycles: string[][] = [];
    let n = 0;
    const visit = (v: string) => {
      index.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v);
      for (const w of graph.get(v) ?? []) {
        if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
      if (low.get(v) === index.get(v)) {
        const comp: string[] = [];
        for (let w = stack.pop()!; ; w = stack.pop()!) { on.delete(w); comp.push(w); if (w === v) break; }
        if (comp.length > 1) cycles.push(comp.sort());
      }
    };
    for (const v of graph.keys()) if (!index.has(v)) visit(v);
    expect(cycles).toEqual([]);
  });

  it('各层只朝允许的方向依赖', () => {
    const bad: string[] = [];
    for (const [from, deps] of graph) {
      const a = layer(from), ok = ALLOWED[a];
      expect(ok, `没有为 ${a} 层定义规则（${from}）`).toBeDefined();
      for (const to of deps) {
        const b = layer(to);
        if (a !== b && !ok.includes(b)) bad.push(`${from} → ${to}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('规则层不依赖任何画面、界面、联机的代码，服务端也不碰客户端代码', () => {
    for (const [from, deps] of graph) {
      if (layer(from) === 'core') for (const to of deps) expect(layer(to), `${from} → ${to}`).toBe('core');
      if (layer(from) === 'server') for (const to of deps) expect(['server', 'core', 'shared'], `${from} → ${to}`).toContain(layer(to));
    }
  });
});
