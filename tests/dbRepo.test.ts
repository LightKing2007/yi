/** 数据访问与段位（server/db/repo.ts、ratingStore.ts）：游客用户、段位读写、昵称的字节上限、事务、元数据 */
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEMORY, openDatabase } from '../server/db';
import { DbRatingStore } from '../server/db/ratingStore';
import { Repo, clipNameBytes } from '../server/db/repo';
import { newRating, type Ratings } from '../src/shared/protocol';

let db: DatabaseSync;
let repo: Repo;

const HASH_A = 'a'.repeat(32),
  HASH_B = 'b'.repeat(32);
/** 五子棋 points 分、胜 win 局，围棋为初始段位 */
const gomoku = (points: number, win = 1): Ratings => ({ gomoku: { points, win, loss: 0, draw: 0 }, go: newRating() });
const count = (table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);

beforeEach(() => {
  db = openDatabase(MEMORY, { now: () => 1, appVersion: 'test' });
  repo = new Repo(db);
});

afterEach(() => {
  db.close();
});

describe('昵称的字节上限（DAT-022，决定 D5-5）', () => {
  it('按字素截短到 64 字节以内，不拆开任何一个字素；为空时取默认昵称', () => {
    expect(clipNameBytes('棋手甲')).toBe('棋手甲');
    expect(clipNameBytes('a'.repeat(64))).toBe('a'.repeat(64)); // 恰好 64 字节
    expect(clipNameBytes('a'.repeat(65))).toBe('a'.repeat(64));
    expect(clipNameBytes('棋'.repeat(22))).toBe('棋'.repeat(21)); // 每个 3 字节：21 个 63 字节
    const family = '👨‍👩‍👧‍👦'; // 一个字素，25 字节
    expect(clipNameBytes(family.repeat(16))).toBe(family.repeat(2));
    expect(clipNameBytes('')).toBe('棋手');
  });
});

describe('数据访问', () => {
  it('同一台设备只建一个游客用户；上线时更新昵称与最近上线的时刻', () => {
    const id = repo.ensure(HASH_A, '甲', 10);
    expect(repo.ensure(HASH_A, '别的名字', 20)).toBe(id);
    expect(repo.userOf(HASH_A)).toBe(id);
    expect(repo.userOf(HASH_B)).toBeUndefined();
    expect(repo.touch(HASH_A, '乙', 30)).toBe(id);
    expect(db.prepare('SELECT kind, name, created_at, last_seen_at FROM users').all()).toEqual([
      { kind: 'guest', name: '乙', created_at: 10, last_seen_at: 30 },
    ]);
    expect(db.prepare('SELECT uid_hash, first_seen_at, last_seen_at FROM devices').all()).toEqual([{ uid_hash: HASH_A, first_seen_at: 10, last_seen_at: 30 }]);
  });

  it('没有段位记录的棋类为初始段位；写入为覆盖', () => {
    const id = repo.ensure(HASH_A, '甲', 1);
    expect(repo.ratingsOf(id)).toEqual({ gomoku: newRating(), go: newRating() });
    repo.saveRating(id, 'go', { points: 1216, win: 1, loss: 0, draw: 0 }, 2);
    repo.saveRating(id, 'go', { points: 1230, win: 2, loss: 0, draw: 0 }, 3);
    expect(repo.ratingsOf(id)).toEqual({ gomoku: newRating(), go: { points: 1230, win: 2, loss: 0, draw: 0 } });
    expect(count('ratings')).toBe(1);
  });

  it('每个事务结束后报告耗时：提交与回滚都报告', () => {
    let clock = 0;
    const seconds: number[] = [];
    const timed = new Repo(db, { clock: () => (clock += 0.5), onTransaction: taken => seconds.push(taken) });
    timed.transaction(() => timed.ensure(HASH_A, '甲', 1));
    expect(() =>
      timed.transaction(() => {
        throw new Error('中途出错');
      }),
    ).toThrow('中途出错');
    expect(seconds).toEqual([0.5, 0.5]);
  });

  it('事务中抛出异常时整体回滚', () => {
    expect(() =>
      repo.transaction(() => {
        repo.ensure(HASH_A, '甲', 1);
        throw new Error('中途出错');
      }),
    ).toThrow('中途出错');
    expect(count('users')).toBe(0);
    expect(count('devices')).toBe(0);
  });

  it('元数据可读写', () => {
    expect(repo.meta('x')).toBeUndefined();
    repo.setMeta('x', '1');
    repo.setMeta('x', '2');
    expect(repo.meta('x')).toBe('2');
  });
});

describe('数据库中的段位存放处', () => {
  it('上线即建游客用户；写入两种棋的段位', () => {
    const store = new DbRatingStore(repo, { now: () => 42 });
    expect(store.get(HASH_A)).toBeUndefined();
    store.seen(HASH_A, '甲');
    expect(store.get(HASH_A)).toEqual({ gomoku: newRating(), go: newRating() });
    store.set(HASH_A, gomoku(1216), '甲改名');
    expect(store.get(HASH_A)).toEqual(gomoku(1216));
    expect(count('ratings')).toBe(2);
    expect(db.prepare('SELECT name, last_seen_at FROM users').get()).toEqual({ name: '甲改名', last_seen_at: 42 });
  });

  it('数据库拒绝写入时整体回滚并抛出：段位与昵称都不变', () => {
    const store = new DbRatingStore(repo, { now: () => 1 });
    store.set(HASH_A, gomoku(1216), '甲');
    expect(() => store.set(HASH_A, gomoku(-5), '乙')).toThrow(/CHECK constraint failed/);
    expect(store.get(HASH_A)).toEqual(gomoku(1216));
    expect(db.prepare('SELECT name FROM users').get()?.name).toBe('甲');
  });
});
