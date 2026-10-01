/** 段位存档：首次运行、存档损坏时拒绝启动、个别记录损坏、四步写盘与 .prev、合并写盘、磁盘写满时退避重试、退出前的应急转储（DAT-050 至 DAT-054） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_DATA_ERROR, EXIT_IO_ERROR, FileStore, StoreLoadError, type StoreFs, type StoreLog } from '../server/store';
import type { Ratings } from '../src/shared/protocol';

const ratings = (points: number): Ratings => ({
  gomoku: { points, win: 1, loss: 2, draw: 0 },
  go: { points: 1200, win: 0, loss: 0, draw: 0 },
});

let dir = '';
let file = '';
let logs: { level: string; text: string }[] = [];
const log: StoreLog = (level, text) => { logs.push({ level, text }); };

beforeEach(() => {
  vi.useFakeTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-store-'));
  file = path.join(dir, 'yi-ratings.json');
  logs = [];
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true });
});

const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** 真实文件系统，但可以随时让写入以 ENOSPC 失败，模拟磁盘写满 */
function fullableFs() {
  const disk = { full: false };
  const writeSync = ((fd: number, data: string) => {
    if (disk.full) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    return fs.writeSync(fd, data);
  }) as StoreFs['writeSync'];
  return { disk, fs: { ...fs, writeSync } satisfies StoreFs };
}

function expectLoadError(exitCode: number) {
  try {
    new FileStore(file, { log });
  } catch (e) {
    expect(e).toBeInstanceOf(StoreLoadError);
    expect((e as StoreLoadError).exitCode).toBe(exitCode);
    return;
  }
  expect.unreachable('应当拒绝启动');
}

describe('读取存档', () => {
  it('存档不存在时视为首次运行，没有段位变化就不创建文件', () => {
    const store = new FileStore(file, { log });
    expect(store.get('a')).toBeUndefined();
    expect(store.close()).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('存档无法解析时拒绝启动（退出码 65），原文件保持不动', () => {
    fs.writeFileSync(file, '{"a": {"name": "棋手"');
    expectLoadError(EXIT_DATA_ERROR);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a": {"name": "棋手"');
  });

  it('存档顶层不是对象时拒绝启动（退出码 65）', () => {
    fs.writeFileSync(file, '[]');
    expectLoadError(EXIT_DATA_ERROR);
  });

  it('存档存在但无法读取时拒绝启动（退出码 74）', () => {
    fs.mkdirSync(file);
    expectLoadError(EXIT_IO_ERROR);
  });

  it('个别记录损坏时只把这几名玩家按新玩家处理，原文件另存为 .corrupt，其余记录照常读取', () => {
    const original = JSON.stringify({ good: { name: '甲', ratings: ratings(1300) }, bad: { name: '乙', ratings: { gomoku: { points: -5 } } } });
    fs.writeFileSync(file, original);
    const store = new FileStore(file, { log });
    expect(store.get('good')?.gomoku.points).toBe(1300);
    expect(store.get('bad')).toBeUndefined();
    expect(fs.readFileSync(file + '.corrupt', 'utf8')).toBe(original);
    expect(logs).toContainEqual(expect.objectContaining({ level: 'warn' }));
  });
});

describe('写盘', () => {
  it('段位变化 2 秒后合并为一次写盘，重新读取得到相同的段位', () => {
    const store = new FileStore(file, { log });
    store.set('a', ratings(1210), '甲');
    store.set('b', ratings(1190), '乙');
    vi.advanceTimersByTime(1999);
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(new FileStore(file).get('a')?.gomoku.points).toBe(1210);
    expect(new FileStore(file).get('b')?.gomoku.points).toBe(1190);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
  });

  it('每次写盘前把上一版存档保留为 .prev', () => {
    const store = new FileStore(file, { log });
    store.set('a', ratings(1210), '甲');
    store.flush();
    store.set('a', ratings(1230), '甲');
    store.flush();
    expect(readJson(file + '.prev').a.ratings.gomoku.points).toBe(1210);
    expect(readJson(file).a.ratings.gomoku.points).toBe(1230);
  });

  it('保存的是段位的副本，之后修改传入的对象不影响存档', () => {
    const store = new FileStore(file, { log });
    const r = ratings(1210);
    store.set('a', r, '甲');
    r.gomoku.points = 9999;
    expect(store.get('a')?.gomoku.points).toBe(1210);
  });
});

describe('写盘失败', () => {
  it('磁盘写满时不抛出异常，保留内存中的数据，按 1、2、4 秒退避重试，连续 3 次失败写 error 日志，恢复后写入', () => {
    fs.writeFileSync(file, JSON.stringify({ a: { name: '甲', ratings: ratings(1200) } }));
    const { disk, fs: faulty } = fullableFs();
    const store = new FileStore(file, { log, fs: faulty });
    disk.full = true;
    store.set('a', ratings(1250), '甲');

    vi.advanceTimersByTime(2000);
    expect(logs.map(l => l.level)).toEqual(['warn']);
    expect(store.get('a')?.gomoku.points).toBe(1250);
    expect(readJson(file).a.ratings.gomoku.points).toBe(1200);
    expect(fs.existsSync(file + '.tmp')).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(logs.map(l => l.level)).toEqual(['warn', 'warn']);
    vi.advanceTimersByTime(1999);
    expect(logs).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(logs.map(l => l.level)).toEqual(['warn', 'warn', 'error']);

    disk.full = false;
    vi.advanceTimersByTime(4000);
    expect(readJson(file).a.ratings.gomoku.points).toBe(1250);
    expect(logs.at(-1)?.level).toBe('info');
  });

  it('退避重试期间的段位变化不会提前触发写盘', () => {
    const { disk, fs: faulty } = fullableFs();
    const store = new FileStore(file, { log, fs: faulty });
    disk.full = true;
    store.set('a', ratings(1210), '甲');
    store.flush();
    store.flush();
    store.flush();
    expect(logs).toHaveLength(3);
    store.set('a', ratings(1220), '甲');
    vi.advanceTimersByTime(3999);
    expect(logs).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(logs).toHaveLength(4);
  });

  it('重试间隔的上限为 60 秒', () => {
    const { disk, fs: faulty } = fullableFs();
    const store = new FileStore(file, { log, fs: faulty });
    disk.full = true;
    store.set('a', ratings(1210), '甲');
    for (let i = 0; i < 8; i++) store.flush();
    expect(logs.at(-1)?.text).toContain('60 秒后重试');
  });

  it('退出前写盘失败时把数据转储到 emergency 文件，且不再留下重试定时器', () => {
    const { disk, fs: faulty } = fullableFs();
    const store = new FileStore(file, { log, fs: faulty, now: () => Date.UTC(2026, 9, 2, 1, 42, 17) });
    disk.full = true;
    store.set('a', ratings(1210), '甲');
    expect(store.close()).toBe(true);
    expect(readJson(path.join(dir, 'emergency-20261002T014217Z.json')).a.ratings.gomoku.points).toBe(1210);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('退出前写盘成功时不产生 emergency 文件', () => {
    const store = new FileStore(file, { log });
    store.set('a', ratings(1210), '甲');
    expect(store.close()).toBe(true);
    expect(fs.readdirSync(dir).filter(f => f.startsWith('emergency-'))).toEqual([]);
  });
});
