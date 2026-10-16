/** 服务端启动时的持久化（server/db/startup.ts）与联机服务端在数据库上的段位读写：同步旧存档、双写、失败时拒绝启动 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbOpenError, MEMORY, openDatabase } from '../server/db';
import { LEGACY_MTIME } from '../server/db/legacy';
import { DbRatingStore } from '../server/db/ratingStore';
import { Repo } from '../server/db/repo';
import { openPersistence, startPersistence } from '../server/db/startup';
import { StoreLoadError } from '../server/store';
import { newRating, type Ratings } from '../src/shared/protocol';
import { Client, matchUp, world } from './serverWorld';

let dir = '';
let dbFile = '';
let dataFile = '';
let logs: string[] = [];
const HASH_A = 'a'.repeat(32);
const gomoku = (points: number): Ratings => ({ gomoku: { points, win: 1, loss: 0, draw: 0 }, go: newRating() });
const start = () => openPersistence({ dbFile, dataFile, appVersion: 'test', now: () => 1000, log: (_level, event) => logs.push(event) });
const readJson = () => JSON.parse(fs.readFileSync(dataFile, 'utf8')) as Record<string, { name: string; ratings: Ratings }>;
/** 打开失败时抛出的错误 */
const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('没有抛出');
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-startup-'));
  dbFile = path.join(dir, 'yi.db');
  dataFile = path.join(dir, 'yi-ratings.json');
  logs = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true });
});

describe('启动时的持久化', () => {
  it('没有旧存档的首次启动：新建数据库；段位写入数据库并双写旧存档，退出时记下旧存档的修改时间', () => {
    const run = start();
    expect(logs).toEqual(['db.migrated', 'db.opened', 'db.legacy-synced']);
    run.store.set(HASH_A, gomoku(1216), '甲');
    expect(run.close()).toBe(true);
    expect(readJson()[HASH_A]).toEqual({ name: '甲', ratings: gomoku(1216) });
    const db = new DatabaseSync(dbFile);
    expect(db.prepare('SELECT meta_text FROM meta WHERE meta_name = ?').get(LEGACY_MTIME)?.meta_text).toBe(String(fs.statSync(dataFile).mtimeMs));
    db.close();
  });

  it('有 2.0.7 留下的旧存档：启动时导入，读到原来的段位', () => {
    fs.writeFileSync(dataFile, JSON.stringify({ [HASH_A]: { name: '甲', ratings: gomoku(1300) } }));
    const run = start();
    expect(run.store.get(HASH_A)).toEqual(gomoku(1300));
    run.close();
  });

  it('上次运行时尚未终局的对局在启动时记为服务端放弃', () => {
    const first = openDatabase(dbFile, { now: () => 1, appVersion: 'test' });
    const repo = new Repo(first);
    const black = repo.ensure(HASH_A, '甲', 1),
      white = repo.ensure('b'.repeat(32), '乙', 1);
    repo.insertGame({ kind: 'match', type: 'go', size: 19, blackUserId: black, whiteUserId: white }, 1);
    first.close();
    const run = start();
    expect(logs).toContain('db.games-aborted');
    run.close();
    const db = new DatabaseSync(dbFile);
    expect(db.prepare('SELECT winner, end_reason, ended_at FROM games').get()).toEqual({ winner: 'draw', end_reason: 'aborted', ended_at: 1000 });
    db.close();
  });

  it('旧存档损坏时拒绝启动（退出码 65），原文件不动', () => {
    fs.writeFileSync(dataFile, '{ 坏掉的存档');
    const err = failure(start);
    expect(err).toBeInstanceOf(StoreLoadError);
    expect((err as StoreLoadError).exitCode).toBe(65);
    expect(fs.readFileSync(dataFile, 'utf8')).toBe('{ 坏掉的存档');
  });

  it('与旧存档同步失败时整体回滚并拒绝启动（退出码 65）', () => {
    openDatabase(dbFile, { now: () => 1, appVersion: 'test' }).close();
    const db = new DatabaseSync(dbFile); // 模拟写入被拒绝：段位表上的触发器使插入失败
    db.exec("CREATE TRIGGER no_ratings BEFORE INSERT ON ratings BEGIN SELECT RAISE(ABORT, '模拟写入失败'); END");
    db.close();
    fs.writeFileSync(dataFile, JSON.stringify({ [HASH_A]: { name: '甲', ratings: gomoku(1300) } }));
    const err = failure(start);
    expect(err).toBeInstanceOf(DbOpenError);
    expect((err as DbOpenError).exitCode).toBe(65);
    expect((err as DbOpenError).message).toContain('同步失败（模拟写入失败）');
    const check = new DatabaseSync(dbFile);
    expect(check.prepare('SELECT count(*) AS n FROM users').get()?.n).toBe(0);
    check.close();
  });
});

describe('入口调用的启动函数', () => {
  const startForEntry = () => startPersistence({ dbFile, dataFile, appVersion: 'test', now: () => 1000, log: (_level, event) => logs.push(event) });

  it('成功时返回持久化；旧存档损坏时写 store.load-failed 并返回 65；数据库损坏时写 db.open-failed 并返回 65', () => {
    const run = startForEntry();
    expect(typeof run).toBe('object');
    if (typeof run === 'object') run.close();
    fs.writeFileSync(dataFile, '{ 坏掉的存档');
    logs = [];
    expect(startForEntry()).toBe(65);
    expect(logs).toContain('store.load-failed');
    fs.writeFileSync(dataFile, '{}');
    fs.writeFileSync(dbFile, 'garbage'.repeat(1000));
    logs = [];
    expect(startForEntry()).toBe(65);
    expect(logs).toEqual(['db.open-failed']);
  });

  it('其他异常照常抛出，不当作数据损坏', () => {
    fs.writeFileSync(dataFile, JSON.stringify({ [HASH_A]: { name: '甲' } })); // 一条记录损坏：FileStore 写 warn 日志
    const log = (_level: string, event: string) => {
      if (event === 'store.records-invalid') throw new Error('日志出错');
    };
    expect(() => startPersistence({ dbFile, dataFile, appVersion: 'test', now: () => 1000, log })).toThrow('日志出错');
  });
});

describe('联机服务端在数据库上读写段位', () => {
  it('握手即建游客用户；排位结算写入数据库，重新握手读回', () => {
    const db = openDatabase(MEMORY, { now: () => 1, appVersion: 'test' });
    const legacy = new Map<string, Ratings>();
    const store = new DbRatingStore(new Repo(db), { now: () => 2, legacy: { set: (key, ratings) => legacy.set(key, ratings) } });
    const { srv } = world(store);
    const first = new Client(srv, '甲'),
      second = new Client(srv, '乙');
    expect(db.prepare('SELECT name FROM users ORDER BY id').all()).toEqual([{ name: '甲' }, { name: '乙' }]);
    const { sa } = matchUp(first, second, 'ranked');
    const [black, white] = sa.color === 1 ? [first, second] : [second, first];
    black.send({ t: 'resign' });
    expect(white.expect('rated')?.rating.points).toBe(1216);
    const again = new Client(srv, '胜者', undefined, white.uid);
    expect(again.welcome?.ratings.gomoku.points).toBe(1216);
    expect(db.prepare('SELECT count(*) AS n FROM ratings').get()?.n).toBe(2); // 只写这一局的棋类
    expect([...legacy.values()].map(ratings => ratings.gomoku.points).sort()).toEqual([1184, 1216]); // 结算后双写旧存档（决定 D5-1）
    expect(db.prepare("SELECT name FROM users WHERE name = '胜者'").all()).toHaveLength(1); // 同一台设备，改名而不新建用户
    db.close();
  });
});
