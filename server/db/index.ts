/**
 * 打开数据库：PRAGMA 与完整性检查（DAT-002）、结构版本检查（VER-012）、按序执行迁移（DAT-041），迁移前自动备份（DAT-042）。
 * 任何一步失败都抛出 DbOpenError，调用方必须以其中的退出码拒绝启动，严禁带着不完整的结构继续运行（EDGE-002）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Log } from '../log';
import { MIGRATIONS, type Migration } from './migrations';

/** 退出码：数据库存在但无法读取、已损坏、结构版本过高或迁移失败（sysexits.h 的 EX_DATAERR） */
export const EXIT_DATA_ERROR = 65;
/** 退出码：数据库无法打开（sysexits.h 的 EX_IOERR） */
export const EXIT_IO_ERROR = 74;
/** 打开后立即执行的 PRAGMA（DAT-002） */
const PRAGMAS = ['journal_mode = WAL', 'foreign_keys = ON', 'busy_timeout = 3000', 'synchronous = NORMAL'];
/** 内存数据库的文件名：测试使用（新建即迁移，不会有需要备份的旧结构） */
export const MEMORY = ':memory:';
/** 元数据中结构版本的名称（DAT-041） */
const VERSION_NAME = 'schema_version';

/** 打开数据库的可选依赖 */
export interface OpenOptions {
  /** 当前时刻（Unix 毫秒），用于备份文件名 */
  now: () => number;
  /** 程序的版本号，用于迁移前备份的文件名（DAT-042） */
  appVersion: string;
  /** 迁移前备份的目录，默认为数据库所在目录下的 backup/ */
  backupDir?: string;
  /** 日志输出（事件码 `db.*`，07-operations.md 第 8 节），默认不输出 */
  log?: Log;
  /** 迁移清单，默认为 MIGRATIONS；测试中替换 */
  migrations?: readonly Migration[];
}

/** 数据库无法打开、已损坏、结构版本过高或迁移失败。调用方必须以 `exitCode` 退出 */
export class DbOpenError extends Error {
  constructor(
    readonly file: string,
    readonly exitCode: number,
    reason: string,
  ) {
    super(`数据库 ${file} ${reason}，已拒绝启动`);
    this.name = 'DbOpenError';
  }
}

/** Unix 毫秒数转为文件名中的 UTC 时间，如 20261016T013000Z */
const stamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/** 读取结构版本：还没有元数据表时为 0（新建的空数据库） */
function readVersion(db: DatabaseSync, file: string): number {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (!table) return 0;
  const row = db.prepare('SELECT meta_text FROM meta WHERE meta_name = ?').get(VERSION_NAME);
  const version = Number(row?.meta_text);
  if (!Number.isSafeInteger(version) || version < 1) throw new DbOpenError(file, EXIT_DATA_ERROR, `的结构版本 ${String(row?.meta_text)} 无法识别`);
  return version;
}

/** PRAGMA 与完整性检查（DAT-002） */
function prepare(db: DatabaseSync, file: string) {
  for (const pragma of PRAGMAS) db.exec(`PRAGMA ${pragma}`);
  const result = db.prepare('PRAGMA integrity_check').all();
  const ok = result.length === 1 && result[0]?.integrity_check === 'ok';
  if (!ok) throw new DbOpenError(file, EXIT_DATA_ERROR, `未通过完整性检查（${result.map(row => String(row.integrity_check)).join('；')}）`);
}

/** 迁移前以 VACUUM INTO 备份一份一致的快照（DAT-042、DAT-062），返回备份文件的路径 */
function backup(db: DatabaseSync, file: string, opt: OpenOptions): string {
  const dir = opt.backupDir ?? path.join(path.dirname(file), 'backup');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `pre-migrate-${opt.appVersion}-${stamp(opt.now())}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  return target;
}

/** 在一个事务内执行一个迁移并更新结构版本；失败时回滚（DAT-041） */
function migrate(db: DatabaseSync, file: string, migration: Migration) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration.sql);
    db.prepare('INSERT INTO meta (meta_name, meta_text) VALUES (?, ?) ON CONFLICT (meta_name) DO UPDATE SET meta_text = excluded.meta_text').run(
      VERSION_NAME,
      String(migration.version),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw new DbOpenError(file, EXIT_DATA_ERROR, `执行迁移 ${migration.name} 失败（${err instanceof Error ? err.message : String(err)}），已回滚`);
  }
}

/** 检查结构版本并执行尚未执行的迁移；已有结构的数据库先备份 */
function upgrade(db: DatabaseSync, file: string, opt: OpenOptions) {
  const migrations = opt.migrations ?? MIGRATIONS;
  const latest = migrations.at(-1)?.version ?? 0;
  const from = readVersion(db, file);
  if (from > latest) throw new DbOpenError(file, EXIT_DATA_ERROR, `的结构版本 ${from} 高于本程序支持的 ${latest}，请回滚到匹配的版本`); // VER-012：严禁写入
  const pending = migrations.filter(m => m.version > from);
  if (!pending.length) return;
  // 新建的空数据库没有可丢失的数据，不备份
  const saved = from > 0 ? backup(db, file, opt) : undefined;
  for (const migration of pending) migrate(db, file, migration);
  opt.log?.('info', 'db.migrated', { msg: `数据库结构已由版本 ${from} 升到 ${latest}`, file, from, to: latest, backup: saved });
}

/** 打开数据库并完成检查与迁移；任何一步失败都关闭数据库并抛出 DbOpenError */
export function openDatabase(file: string, opt: OpenOptions): DatabaseSync {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch (err) {
    throw new DbOpenError(file, EXIT_IO_ERROR, `无法打开（${err instanceof Error ? err.message : String(err)}）`);
  }
  try {
    prepare(db, file);
    upgrade(db, file, opt);
  } catch (err) {
    db.close();
    if (err instanceof DbOpenError) throw err;
    throw new DbOpenError(file, EXIT_DATA_ERROR, `无法读取（${err instanceof Error ? err.message : String(err)}）`); // 文件不是数据库或已损坏时，首次读取即抛出
  }
  opt.log?.('info', 'db.opened', { msg: '数据库已打开', file, schemaVersion: readVersion(db, file) });
  return db;
}
