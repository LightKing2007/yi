/** 服务端启动时的持久化（server/db/startup.ts）与联机服务端在数据库上的段位读写：新建数据库、放弃未终局的对局、失败时拒绝启动 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEMORY, openDatabase } from '../server/db';
import { DbRatingStore } from '../server/db/ratingStore';
import { Repo } from '../server/db/repo';
import { openPersistence, startPersistence } from '../server/db/startup';
import { Client, matchUp, world } from './serverWorld';

let dir = '';
let dbFile = '';
let logs: string[] = [];
const HASH_A = 'a'.repeat(32);
const options = () => ({ dbFile, appVersion: 'test', now: () => 1000, log: (_level: string, event: string) => logs.push(event) });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-startup-'));
  dbFile = path.join(dir, 'yi.db');
  logs = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true });
});

describe('启动时的持久化', () => {
  it('首次启动新建数据库；段位写入数据库，退出时关闭', () => {
    const run = openPersistence(options());
    expect(logs).toEqual(['db.migrated', 'db.opened']);
    run.store.set(HASH_A, { gomoku: { points: 1216, win: 1, loss: 0, draw: 0 }, go: { points: 1200, win: 0, loss: 0, draw: 0 } }, '甲');
    run.close();
    const db = new DatabaseSync(dbFile);
    expect(db.prepare('SELECT points FROM ratings WHERE game_type = ?').get('gomoku')?.points).toBe(1216);
    db.close();
  });

  it('上次运行时尚未终局的对局在启动时记为服务端放弃', () => {
    const first = openDatabase(dbFile, { now: () => 1, appVersion: 'test' });
    const repo = new Repo(first);
    const black = repo.ensure(HASH_A, '甲', 1),
      white = repo.ensure('b'.repeat(32), '乙', 1);
    repo.insertGame({ kind: 'match', type: 'go', size: 19, blackUserId: black, whiteUserId: white }, 1);
    first.close();
    const run = openPersistence(options());
    expect(logs).toContain('db.games-aborted');
    run.close();
    const db = new DatabaseSync(dbFile);
    expect(db.prepare('SELECT winner, end_reason, ended_at FROM games').get()).toEqual({ winner: 'draw', end_reason: 'aborted', ended_at: 1000 });
    db.close();
  });

  it('没有未终局的对局时不写放弃的日志', () => {
    openPersistence(options()).close();
    logs = [];
    openPersistence(options()).close();
    expect(logs).toEqual(['db.opened']);
  });
});

describe('入口调用的启动函数', () => {
  it('成功时返回持久化；数据库损坏时写 db.open-failed 并返回 65', () => {
    const run = startPersistence(options());
    expect(typeof run).toBe('object');
    if (typeof run === 'object') run.close();
    fs.writeFileSync(dbFile, 'garbage'.repeat(1000));
    logs = [];
    expect(startPersistence(options())).toBe(65);
    expect(logs).toEqual(['db.open-failed']);
  });

  it('其他异常照常抛出，不当作数据损坏', () => {
    const broken = {
      ...options(),
      now: () => {
        throw new Error('时钟出错');
      },
    }; // 放弃未终局的对局时读时钟
    expect(() => startPersistence(broken)).toThrow('时钟出错');
  });
});

describe('联机服务端在数据库上读写段位', () => {
  it('握手即建游客用户；排位结算写入数据库，重新握手读回', () => {
    const db = openDatabase(MEMORY, { now: () => 1, appVersion: 'test' });
    const store = new DbRatingStore(new Repo(db), { now: () => 2 });
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
    expect(db.prepare("SELECT name FROM users WHERE name = '胜者'").all()).toHaveLength(1); // 同一台设备，改名而不新建用户
    db.close();
  });
});
