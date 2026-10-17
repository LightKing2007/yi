/** 数据库的本地备份（server/db/backup.ts、server/backupCommand.ts，DAT-060 至 DAT-064）：在线快照、检查与校验和、保留策略、日志与退出码 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBackup } from '../server/backupCommand';
import { openDatabase } from '../server/db';
import { KEEP_DAYS, KEEP_RECENT, backupDatabase, backupName, inspectDatabase, toPrune } from '../server/db/backup';
import { Repo } from '../server/db/repo';

let dir = '';
let dbFile = '';
let backupDir = '';
/** 2026-10-17 02:07:00 UTC */
const T0 = Date.UTC(2026, 9, 17, 2, 7);
const HOUR = 3_600_000;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-backup-'));
  dbFile = path.join(dir, 'yi.db');
  backupDir = path.join(dir, 'backup');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 以服务端的方式打开数据库并写入 n 个游客用户；返回仍打开着的连接（模拟运行中的服务端） */
function serverWith(n: number) {
  const db = openDatabase(dbFile, { now: () => T0, appVersion: 'test' });
  const repo = new Repo(db);
  for (let i = 0; i < n; i++) repo.ensure(String(i).padStart(32, '0'), `棋手${i}`, T0);
  return db;
}

/** 把 file 中索引 index 的页里所有字母 g 改为 h：页的结构完好、读取不报错，但索引与表内容不一致 */
function corruptIndex(file: string, index: string) {
  const bytes = fs.readFileSync(file);
  const db = new DatabaseSync(file, { readOnly: true });
  const root = Number(db.prepare('SELECT rootpage FROM sqlite_master WHERE name = ?').get(index)?.rootpage);
  db.close();
  const pageSize = bytes.readUInt16BE(16),
    start = (root - 1) * pageSize;
  for (let i = start + bytes.readUInt16BE(start + 5); i < start + pageSize; i++) if (bytes[i] === 0x67) bytes[i] = 0x68;
  fs.writeFileSync(file, bytes);
}

describe('备份文件名与保留策略', () => {
  it('文件名为 yi-UTC时间.db', () => {
    expect(backupName(T0)).toBe('yi-20261017T020700Z.db');
  });

  it('保留最新的 24 份，以及最近 7 个日期中各自最新的一份；其他文件不动', () => {
    // 10 天、每小时一份，共 240 份
    const names = Array.from({ length: 240 }, (_, i) => backupName(T0 - i * HOUR));
    const others = ['pre-migrate-3.0.0-20261001T000000Z.db', 'yi-20261017T020700Z.db.sha256', 'yi-ratings-20261001T203000Z.json'];
    const pruned = new Set(toPrune([...names, ...others]));
    const kept = names.filter(name => !pruned.has(name)).sort();
    const recent = names.slice(0, KEEP_RECENT).sort();
    expect(kept.slice(-KEEP_RECENT)).toEqual(recent);
    // 最近 24 小时跨 10-16 与 10-17 两天；更早的 5 天各留当天最后一份（UTC 23:07）
    expect(kept.slice(0, -KEEP_RECENT)).toEqual(['20261011', '20261012', '20261013', '20261014', '20261015'].map(day => `yi-${day}T230700Z.db`));
    expect(new Set(kept.map(name => name.slice(3, 11))).size).toBe(KEEP_DAYS);
    for (const other of others) expect(pruned.has(other)).toBe(false);
  });

  it('份数不多时不删除', () => {
    expect(toPrune([backupName(T0), backupName(T0 - 30 * 24 * HOUR)])).toEqual([]);
  });
});

describe('备份数据库', () => {
  it('服务端运行时做在线快照：快照通过完整性检查，条数与原库一致，附 sha256sum 格式的校验和；源库不受影响', () => {
    const db = serverWith(3);
    const result = backupDatabase({ dbFile, dir: backupDir, now: () => T0 });
    const file = path.join(backupDir, 'yi-20261017T020700Z.db');
    expect(result).toMatchObject({ file, pruned: [], kept: 1 });
    expect(result?.counts).toEqual({ users: 3, devices: 3, ratings: 0, games: 0, rating_changes: 0 });
    const sum = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    expect([result?.sha256, result?.bytes]).toEqual([sum, fs.statSync(file).size]);
    expect(fs.readFileSync(`${file}.sha256`, 'utf8')).toBe(`${sum}  yi-20261017T020700Z.db\n`);
    expect(fs.readdirSync(backupDir).sort()).toEqual(['yi-20261017T020700Z.db', 'yi-20261017T020700Z.db.sha256']); // 没有留下临时文件
    new Repo(db).ensure('f'.repeat(32), '后来者', T0); // 备份后服务端照常写入
    expect(inspectDatabase(dbFile).users).toBe(4);
    expect(inspectDatabase(file).users).toBe(3);
    db.close();
  });

  it('服务端未运行时同样可以备份', () => {
    serverWith(1).close();
    expect(backupDatabase({ dbFile, dir: backupDir, now: () => T0 })?.counts.users).toBe(1);
  });

  it('数据库还不存在时不备份，也不建立备份目录', () => {
    expect(backupDatabase({ dbFile, dir: backupDir, now: () => T0 })).toBeUndefined();
    expect(fs.existsSync(backupDir)).toBe(false);
  });

  it('每次备份后按保留策略删除旧的备份及其校验和', () => {
    serverWith(1).close();
    for (let i = KEEP_RECENT; i >= 0; i--) backupDatabase({ dbFile, dir: backupDir, now: () => T0 - i * HOUR });
    // 第一份（24 小时前，10-16 02:07）不再是最新的 24 份之一，但它所在的 10-16 还有更晚的备份
    const names = fs.readdirSync(backupDir);
    expect(names.filter(name => name.endsWith('.db')).length).toBe(KEEP_RECENT);
    expect(names).not.toContain('yi-20261016T020700Z.db');
    expect(names).not.toContain('yi-20261016T020700Z.db.sha256');
  });

  it('同一时刻的备份已存在时失败，不覆盖', () => {
    serverWith(1).close();
    backupDatabase({ dbFile, dir: backupDir, now: () => T0 });
    expect(() => backupDatabase({ dbFile, dir: backupDir, now: () => T0 })).toThrow('已存在');
  });

  it('数据库已损坏时失败，不留下临时文件与备份', () => {
    serverWith(200).close();
    const bytes = fs.readFileSync(dbFile);
    bytes.fill(0x55, 4096 * 3, 4096 * 4); // 破坏一个数据页，文件头完好
    fs.writeFileSync(dbFile, bytes);
    expect(() => backupDatabase({ dbFile, dir: backupDir, now: () => T0 })).toThrow();
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });
});

describe('数据库文件的检查', () => {
  it('索引与表内容不一致时，即使各表都能读取，也未通过完整性检查', () => {
    const db = serverWith(0);
    db.exec("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('guest', '甲', 1, 1)");
    db.exec("INSERT INTO ratings (user_id, game_type, updated_at) VALUES (1, 'go', 1), (1, 'gomoku', 1)");
    db.close(); // 最后一个连接关闭时做检查点，数据都在数据库文件中
    expect(inspectDatabase(dbFile).ratings).toBe(2);
    corruptIndex(dbFile, 'uq_ratings_user_id_game_type');
    const reader = new DatabaseSync(dbFile, { readOnly: true });
    expect(reader.prepare('SELECT count(*) AS n FROM ratings').get()?.n).toBe(2); // 读取不报错
    reader.close();
    expect(() => inspectDatabase(dbFile)).toThrow('未通过完整性检查（row 1 missing from index uq_ratings_user_id_game_type');
  });
});

describe('backup 命令', () => {
  type Line = { level: string; event: string; [key: string]: unknown };
  const run = () => {
    const lines: Line[] = [];
    const code = runBackup({ config: { dbFile, backupDir }, log: (level, event, entry) => lines.push({ level, event, ...entry }), now: () => T0 });
    return { code, lines };
  };

  it('成功时写 db.backup-done（含文件、大小、校验和、条数与保留份数），以 0 退出', () => {
    serverWith(2).close();
    const { code, lines } = run();
    expect(code).toBe(0);
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'info',
        event: 'db.backup-done',
        file: path.join(backupDir, 'yi-20261017T020700Z.db'),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        counts: expect.objectContaining({ users: 2 }),
        pruned: 0,
        kept: 1,
      }),
    ]);
  });

  it('数据库还不存在时写 db.backup-skipped，以 0 退出', () => {
    expect(run()).toEqual({ code: 0, lines: [expect.objectContaining({ level: 'info', event: 'db.backup-skipped', file: dbFile })] });
  });

  it('失败时写 db.backup-failed（error），以 1 退出', () => {
    fs.writeFileSync(dbFile, 'garbage'.repeat(1000));
    const { code, lines } = run();
    expect(code).toBe(1);
    expect(lines).toEqual([expect.objectContaining({ level: 'error', event: 'db.backup-failed', file: dbFile, err: expect.any(Error) })]);
  });
});

it('快照为独立的文件：与 WAL 中尚未检查点的写入一致', () => {
  const db = serverWith(0);
  db.exec('PRAGMA wal_autocheckpoint = 0'); // 写入只留在 WAL 中
  new Repo(db).ensure('a'.repeat(32), '甲', T0);
  const file = backupDatabase({ dbFile, dir: backupDir, now: () => T0 })?.file ?? '';
  db.close();
  const copy = new DatabaseSync(file, { readOnly: true });
  expect(copy.prepare('SELECT name FROM users').all()).toEqual([{ name: '甲' }]);
  expect(fs.existsSync(`${file}-wal`)).toBe(false);
  copy.close();
});
