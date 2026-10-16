/** 数据访问与段位（server/db/repo.ts、legacy.ts、ratingStore.ts）：游客用户、段位读写、昵称的字节上限、旧存档的同步（决定 D5-1）、双写 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEMORY, openDatabase } from '../server/db';
import { LEGACY_MTIME, syncLegacy, type LegacyFile } from '../server/db/legacy';
import { DbRatingStore } from '../server/db/ratingStore';
import { Repo, clipNameBytes } from '../server/db/repo';
import type { LogEntry } from '../server/log';
import { FileStore } from '../server/store';
import { newRating, type Ratings } from '../src/shared/protocol';

let db: DatabaseSync;
let repo: Repo;
let logs: [string, LogEntry | undefined][] = [];

const HASH_A = 'a'.repeat(32),
  HASH_B = 'b'.repeat(32),
  HASH_C = 'c'.repeat(32);
/** 五子棋 points 分、胜 win 局，围棋为初始段位 */
const gomoku = (points: number, win = 1): Ratings => ({ gomoku: { points, win, loss: 0, draw: 0 }, go: newRating() });
const count = (table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
const changes = () => db.prepare('SELECT user_id, game_type, points_before, points_after, cause FROM rating_changes ORDER BY id').all();

/** 内存中的旧存档：可以指定修改时间，记下每次写入 */
function fakeFile(entries: [string, { name: string; ratings: Ratings }][], mtime: number | undefined) {
  const data = new Map(entries);
  const writes: string[] = [];
  const file: LegacyFile = {
    mtime: () => mtime,
    entries: () => data.entries(),
    get: key => data.get(key)?.ratings,
    set: (key, ratings, name) => {
      data.set(key, { name, ratings });
      writes.push(key);
    },
  };
  return { file, data, writes };
}

beforeEach(() => {
  db = openDatabase(MEMORY, { now: () => 1, appVersion: 'test' });
  repo = new Repo(db);
  logs = [];
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

  it('只列出有段位记录的游客；元数据可读写', () => {
    repo.ensure(HASH_A, '甲', 1);
    repo.saveRating(repo.ensure(HASH_B, '乙', 1), 'gomoku', gomoku(1300).gomoku, 1);
    expect(repo.guests()).toEqual([{ uidHash: HASH_B, name: '乙', ratings: gomoku(1300) }]);
    expect(repo.meta('x')).toBeUndefined();
    repo.setMeta('x', '1');
    repo.setMeta('x', '2');
    expect(repo.meta('x')).toBe('2');
  });
});

describe('旧存档的同步（决定 D5-1）', () => {
  const log = (_level: string, event: string, entry?: LogEntry) => logs.push([event, entry]);

  it('第一次启动：全部导入，每种棋写一条导入的变化明细；键不是设备散列的跳过并写警告；记下文件的修改时间', () => {
    const { file } = fakeFile(
      [
        [HASH_A, { name: '甲', ratings: gomoku(1300) }],
        ['__proto__', { name: '被篡改的键', ratings: gomoku(9999) }],
        [HASH_B, { name: '乙', ratings: gomoku(1100, 0) }],
      ],
      123.5,
    );
    expect(syncLegacy(repo, file, 7, log)).toEqual({ imported: true, created: 2, updated: 2, skipped: ['__proto__'], exported: 0 });
    expect(repo.ratingsOf(repo.userOf(HASH_A) ?? 0)).toEqual(gomoku(1300));
    expect(changes()).toEqual([
      { user_id: 1, game_type: 'gomoku', points_before: 1200, points_after: 1300, cause: 'import' },
      { user_id: 1, game_type: 'go', points_before: 1200, points_after: 1200, cause: 'import' },
      { user_id: 2, game_type: 'gomoku', points_before: 1200, points_after: 1100, cause: 'import' },
      { user_id: 2, game_type: 'go', points_before: 1200, points_after: 1200, cause: 'import' },
    ]);
    expect(repo.meta(LEGACY_MTIME)).toBe('123.5');
    expect(logs.map(([event]) => event)).toEqual(['db.legacy-skipped', 'db.legacy-synced']);
    expect(logs[0]?.[1]).toEqual(expect.objectContaining({ count: 1, first: '__proto__' }));
  });

  it('文件的修改时间与记下的相同：以数据库为准，不导入，把文件中落后的记录补齐', () => {
    syncLegacy(repo, fakeFile([[HASH_A, { name: '甲', ratings: gomoku(1300) }]], 50).file, 1);
    const userA = repo.userOf(HASH_A) ?? 0;
    repo.saveRating(userA, 'gomoku', gomoku(1316, 2).gomoku, 2); // 数据库已结算，文件还没来得及写盘（进程被强制结束）
    repo.saveRating(repo.ensure(HASH_B, '乙', 2), 'go', { points: 1216, win: 1, loss: 0, draw: 0 }, 2);
    const { file, data, writes } = fakeFile([[HASH_A, { name: '甲', ratings: gomoku(1300) }]], 50);
    const before = changes().length;
    expect(syncLegacy(repo, file, 3)).toEqual({ imported: false, created: 0, updated: 0, skipped: [], exported: 2 });
    expect(repo.ratingsOf(userA)).toEqual(gomoku(1316, 2));
    expect(writes.sort()).toEqual([HASH_A, HASH_B]);
    expect(data.get(HASH_A)?.ratings).toEqual(gomoku(1316, 2));
    expect(changes().length).toBe(before);
  });
});

describe('旧存档的同步：回滚之后与出错时（决定 D5-1）', () => {
  it('文件的修改时间变了（回滚期间由 2.0.7 写过）：以文件为准，只更新有差异的玩家并写变化明细', () => {
    syncLegacy(
      repo,
      fakeFile(
        [
          [HASH_A, { name: '甲', ratings: gomoku(1300) }],
          [HASH_B, { name: '乙', ratings: gomoku(1100, 0) }],
        ],
        50,
      ).file,
      1,
    );
    const before = changes().length;
    const { file, writes } = fakeFile(
      [
        [HASH_A, { name: '甲', ratings: gomoku(1340, 3) }],
        [HASH_B, { name: '乙', ratings: gomoku(1100, 0) }],
        [HASH_C, { name: '丙', ratings: gomoku(1216) }],
      ],
      60,
    );
    expect(syncLegacy(repo, file, 2)).toEqual({ imported: true, created: 1, updated: 2, skipped: [], exported: 0 });
    expect(repo.ratingsOf(repo.userOf(HASH_A) ?? 0)).toEqual(gomoku(1340, 3));
    expect(changes().slice(before)).toEqual([
      { user_id: 1, game_type: 'gomoku', points_before: 1300, points_after: 1340, cause: 'import' },
      { user_id: 3, game_type: 'gomoku', points_before: 1200, points_after: 1216, cause: 'import' },
      { user_id: 3, game_type: 'go', points_before: 1200, points_after: 1200, cause: 'import' },
    ]);
    expect(repo.meta(LEGACY_MTIME)).toBe('60');
    expect(writes).toEqual([]);
  });

  it('同步中途出错时整体回滚：不留下任何用户，也不记下修改时间', () => {
    const file: LegacyFile = {
      mtime: () => 5,
      *entries() {
        yield [HASH_A, { name: '甲', ratings: gomoku(1300) }];
        throw new Error('读取中途出错');
      },
      get: () => undefined,
      set: () => {},
    };
    expect(() => syncLegacy(repo, file, 1)).toThrow('读取中途出错');
    expect(count('users')).toBe(0);
    expect(repo.meta(LEGACY_MTIME)).toBeUndefined();
  });

  it('文件不存在时不导入；数据库中有段位的玩家写入文件，供回滚后的 2.0.7 读取', () => {
    repo.saveRating(repo.ensure(HASH_A, '甲', 1), 'gomoku', gomoku(1300).gomoku, 1);
    const { file, data } = fakeFile([], undefined);
    expect(syncLegacy(repo, file, 2)).toEqual({ imported: false, created: 0, updated: 0, skipped: [], exported: 1 });
    expect(data.get(HASH_A)).toEqual({ name: '甲', ratings: gomoku(1300) });
  });
});

describe('数据库中的段位存放处', () => {
  it('上线即建游客用户；写入两种棋的段位并同时写入旧存档', () => {
    const { file, data } = fakeFile([], 1);
    const store = new DbRatingStore(repo, { now: () => 42, legacy: file });
    expect(store.get(HASH_A)).toBeUndefined();
    store.seen(HASH_A, '甲');
    expect(store.get(HASH_A)).toEqual({ gomoku: newRating(), go: newRating() });
    store.set(HASH_A, gomoku(1216), '甲改名');
    expect(store.get(HASH_A)).toEqual(gomoku(1216));
    expect(count('ratings')).toBe(2);
    expect(data.get(HASH_A)).toEqual({ name: '甲改名', ratings: gomoku(1216) });
    expect(db.prepare('SELECT name, last_seen_at FROM users').get()).toEqual({ name: '甲改名', last_seen_at: 42 });
  });

  it('数据库拒绝写入时整体回滚并抛出，不写旧存档', () => {
    const { file, data } = fakeFile([], 1);
    const store = new DbRatingStore(repo, { now: () => 1, legacy: file });
    store.set(HASH_A, gomoku(1216), '甲');
    expect(() => store.set(HASH_A, gomoku(-5), '乙')).toThrow(/CHECK constraint failed/);
    expect(db.prepare('SELECT name FROM users').get()?.name).toBe('甲'); // 改名与段位在同一事务中，一并回滚
    expect(store.get(HASH_A)).toEqual(gomoku(1216));
    expect(data.get(HASH_A)?.ratings).toEqual(gomoku(1216));
  });

  it('不设旧存档时只写数据库', () => {
    const store = new DbRatingStore(repo, { now: () => 1 });
    store.set(HASH_A, gomoku(1216), '甲');
    expect(store.get(HASH_A)).toEqual(gomoku(1216));
  });
});

describe('与真实的旧存档文件一起使用', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-legacy-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true });
  });

  it('上线、双写、重启、回滚到 2.0.7 期间改写文件、再上线：每一步的段位都不丢', () => {
    const json = path.join(dir, 'yi-ratings.json');
    fs.writeFileSync(json, JSON.stringify({ [HASH_A]: { name: '甲', ratings: gomoku(1300) } })); // 2.0.7 留下的存档
    const dbFile = path.join(dir, 'yi.db');
    const start = () => {
      const fileDb = openDatabase(dbFile, { now: () => 1, appVersion: 'test' });
      const fileRepo = new Repo(fileDb);
      const legacy = new FileStore(json, { onWritten: mtime => fileRepo.setMeta(LEGACY_MTIME, String(mtime)) });
      const result = syncLegacy(fileRepo, legacy, 1);
      return { fileDb, fileRepo, legacy, result, store: new DbRatingStore(fileRepo, { now: () => 2, legacy }) };
    };
    // 首次上线数据库版本：导入
    let run = start();
    expect(run.result.imported).toBe(true);
    run.store.set(HASH_A, gomoku(1316, 2), '甲'); // 双写
    run.legacy.close();
    run.fileDb.close();
    expect(JSON.parse(fs.readFileSync(json, 'utf8'))[HASH_A].ratings).toEqual(gomoku(1316, 2));
    // 重启：文件只由本程序写过，以数据库为准
    run = start();
    expect(run.result.imported).toBe(false);
    run.legacy.close();
    run.fileDb.close();
    // 回滚到 2.0.7：它只改写文件
    fs.writeFileSync(json, JSON.stringify({ [HASH_A]: { name: '甲', ratings: gomoku(1340, 3) } }));
    fs.utimesSync(json, new Date(), new Date(Date.now() + 60_000));
    // 再次上线数据库版本：以文件为准，不丢回滚期间的段位
    run = start();
    expect(run.result).toEqual(expect.objectContaining({ imported: true, created: 0, updated: 1 }));
    expect(run.store.get(HASH_A)).toEqual(gomoku(1340, 3));
    run.legacy.close();
    run.fileDb.close();
  });
});
