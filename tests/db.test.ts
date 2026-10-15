/** 数据库的打开与迁移（server/db/，DAT-002、DAT-017、DAT-041、DAT-042、VER-012）：PRAGMA、完整性检查、按序迁移、失败回滚、结构版本过高、迁移前备份 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbOpenError, MEMORY, openDatabase, type OpenOptions } from '../server/db';
import { MIGRATIONS, type Migration } from '../server/db/migrations';
import type { LogEntry } from '../server/log';

let dir = '';
let file = '';
let logs: [string, LogEntry | undefined][] = [];
const opened: DatabaseSync[] = [];

/** 2026-10-16T01:30:00Z */
const NOW = Date.UTC(2026, 9, 16, 1, 30);
const options = (migrations?: readonly Migration[]): OpenOptions => ({
  now: () => NOW,
  appVersion: '2.0.8',
  log: (_level, event, entry) => logs.push([event, entry]),
  migrations,
});
const open = (target: string, migrations?: readonly Migration[]) => {
  const db = openDatabase(target, options(migrations));
  opened.push(db);
  return db;
};
const close = (db: DatabaseSync) => {
  db.close();
  opened.splice(opened.indexOf(db), 1);
};
const version = (db: DatabaseSync) => db.prepare("SELECT meta_text FROM meta WHERE meta_name = 'schema_version'").get()?.meta_text;
const tables = (db: DatabaseSync) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map(row => row.name);
/** 打开失败时抛出的 DbOpenError */
const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DbOpenError) return err;
    throw err;
  }
  throw new Error('没有抛出 DbOpenError');
};

const V2: Migration = { version: 2, name: '0002_notes', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, note_text TEXT NOT NULL) STRICT;' };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-db-'));
  file = path.join(dir, 'yi.db');
  logs = [];
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  fs.rmSync(dir, { recursive: true });
});

describe('打开数据库', () => {
  it('新建的数据库执行全部迁移，结构版本为最新；PRAGMA 按 DAT-002 设置', () => {
    const db = open(file);
    expect(version(db)).toBe(String(MIGRATIONS.at(-1)?.version));
    expect(tables(db)).toEqual(['devices', 'games', 'meta', 'rating_changes', 'ratings', 'users']);
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(db.prepare('PRAGMA busy_timeout').get()?.timeout).toBe(3000);
    expect(db.prepare('PRAGMA synchronous').get()?.synchronous).toBe(1); // NORMAL
    expect(logs.map(([event]) => event)).toEqual(['db.migrated', 'db.opened']);
    expect(logs[0]?.[1]).toEqual(expect.objectContaining({ from: 0, to: 1, backup: undefined })); // 新建的空数据库不备份
    expect(fs.existsSync(path.join(dir, 'backup'))).toBe(false);
  });

  it('再次打开时不重复执行迁移，也不备份', () => {
    close(open(file));
    logs = [];
    const db = open(file);
    expect(version(db)).toBe('1');
    expect(logs.map(([event]) => event)).toEqual(['db.opened']);
    expect(fs.existsSync(path.join(dir, 'backup'))).toBe(false);
  });

  it('内存数据库同样执行迁移，不备份', () => {
    const db = open(MEMORY, [...MIGRATIONS, V2]);
    expect(version(db)).toBe('2');
    expect(tables(db)).toContain('notes');
  });
});

describe('迁移', () => {
  it('已有结构的数据库只执行新增的迁移，执行前把原数据库备份到 backup/pre-migrate-版本号-时间.db', () => {
    const first = open(file);
    first.prepare("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('guest', '甲', 1, 1)").run();
    close(first);
    logs = [];
    const db = open(file, [...MIGRATIONS, V2]);
    expect(version(db)).toBe('2');
    expect(db.prepare('SELECT name FROM users').all()).toEqual([{ name: '甲' }]);
    const saved = path.join(dir, 'backup', 'pre-migrate-2.0.8-20261016T013000Z.db');
    expect(logs[0]).toEqual(['db.migrated', expect.objectContaining({ from: 1, to: 2, backup: saved })]);
    const copy = open(saved);
    expect(version(copy)).toBe('1');
    expect(tables(copy)).not.toContain('notes');
    expect(copy.prepare('SELECT name FROM users').all()).toEqual([{ name: '甲' }]);
  });

  it('迁移失败时回滚整个迁移、拒绝启动，结构版本不变', () => {
    close(open(file));
    const broken: Migration = { version: 2, name: '0002_broken', sql: 'CREATE TABLE half (id INTEGER PRIMARY KEY) STRICT; INSERT INTO nowhere VALUES (1);' };
    const err = failure(() => open(file, [...MIGRATIONS, broken]));
    expect(err.exitCode).toBe(65);
    expect(err.message).toContain('0002_broken');
    const db = open(file);
    expect(version(db)).toBe('1');
    expect(tables(db)).not.toContain('half');
  });

  it('数据库的结构版本高于程序支持时拒绝启动，不作任何写入（VER-012）', () => {
    close(open(file, [...MIGRATIONS, V2]));
    const before = fs.readFileSync(file);
    const err = failure(() => open(file));
    expect(err.exitCode).toBe(65);
    expect(err.message).toContain('结构版本 2 高于本程序支持的 1');
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('结构版本无法识别时拒绝启动', () => {
    const db = open(file);
    db.prepare("UPDATE meta SET meta_text = 'x' WHERE meta_name = 'schema_version'").run();
    close(db);
    expect(failure(() => open(file)).message).toContain('结构版本 x 无法识别');
  });
});

describe('损坏的数据库', () => {
  it('不是数据库的文件拒绝启动，原文件不动', () => {
    fs.writeFileSync(file, 'yi-ratings.json 的内容'.repeat(400));
    const before = fs.readFileSync(file);
    expect(failure(() => open(file)).exitCode).toBe(65);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('索引与表内容不一致：读取不报错，但未通过完整性检查，拒绝启动并列出检查结果', () => {
    const db = open(file);
    db.exec("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('guest', '甲', 1, 1), ('guest', '乙', 1, 1)");
    db.exec("INSERT INTO ratings (user_id, game_type, updated_at) VALUES (1, 'go', 1), (2, 'gomoku', 1), (2, 'go', 1)");
    const root = Number(db.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'uq_ratings_user_id_game_type'").get()?.rootpage);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    close(db);
    // 在该索引页的记录区中把字母 g 改为 h：页的结构完好，索引键与表中的棋类对不上
    const bytes = fs.readFileSync(file);
    const pageSize = bytes.readUInt16BE(16),
      start = (root - 1) * pageSize;
    for (let i = start + bytes.readUInt16BE(start + 5); i < start + pageSize; i++) if (bytes[i] === 0x67) bytes[i] = 0x68;
    fs.writeFileSync(file, bytes);
    const err = failure(() => open(file));
    expect(err.exitCode).toBe(65);
    expect(err.message).toContain('未通过完整性检查（row 1 missing from index uq_ratings_user_id_game_type；');
  });

  it('页头损坏、读取即出错的数据库拒绝启动', () => {
    const db = open(file);
    const insert = db.prepare("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('guest', ?, 1, 1)");
    for (let i = 0; i < 2000; i++) insert.run(`棋手${i}`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    close(db);
    const bytes = fs.readFileSync(file);
    const last = bytes.length - bytes.readUInt16BE(16);
    bytes.fill(0x5a, last, last + 12); // 改坏最后一页（用户表的叶子页）的页头
    fs.writeFileSync(file, bytes);
    const err = failure(() => open(file));
    expect(err.exitCode).toBe(65);
    expect(err.message).toContain('无法读取（database disk image is malformed）');
  });

  it('目录不存在等无法打开的情况以退出码 74 拒绝启动', () => {
    expect(failure(() => open(path.join(dir, 'missing', 'yi.db'))).exitCode).toBe(74);
  });
});

describe('迁移文件（DAT-017）', () => {
  it('清单与 server/db/migrations/ 中的文件逐一对应：四位连续序号、snake_case 描述、内容相同', () => {
    const migrationDir = path.join(__dirname, '../server/db/migrations');
    const names = fs.readdirSync(migrationDir).sort();
    expect(names).toEqual(MIGRATIONS.map(m => `${m.name}.sql`));
    MIGRATIONS.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.name).toMatch(/^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/);
      expect(m.name.slice(0, 4)).toBe(String(m.version).padStart(4, '0'));
      expect(m.sql).toBe(fs.readFileSync(path.join(migrationDir, `${m.name}.sql`), 'utf8'));
    });
  });

  it('0001_init.sql 与 roadmap.md 第 5.2.2 条的 DDL 相同', () => {
    const roadmap = fs.readFileSync(path.join(__dirname, '../docs/plan/roadmap.md'), 'utf8');
    const ddl = /5\.2\.2 阶段 5 的 DDL[\s\S]*?```sql\n([\s\S]*?)```/.exec(roadmap)?.[1];
    expect(MIGRATIONS[0]?.sql).toBe(ddl);
  });
});
