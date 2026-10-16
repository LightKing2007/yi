/**
 * 服务端启动时的持久化：打开数据库（检查与迁移）→ 读取旧段位存档 → 两者同步 → 建立数据库中的段位存放处（双写旧存档，决定 D5-1）。
 * 任何一步失败都抛出 DbOpenError 或 StoreLoadError，调用方以其中的退出码拒绝启动（EDGE-002）。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Log } from '../log';
import { EXIT_DATA_ERROR, FileStore, StoreLoadError } from '../store';
import { DbOpenError, openDatabase } from './index';
import { LEGACY_MTIME, syncLegacy } from './legacy';
import { DbRatingStore } from './ratingStore';
import { Repo } from './repo';

/** 启动持久化的参数 */
export interface PersistenceOptions {
  /** 数据库文件 */
  dbFile: string;
  /** 旧段位存档 yi-ratings.json */
  dataFile: string;
  /** 程序的版本号，用于迁移前备份的文件名 */
  appVersion: string;
  /** 当前时刻（Unix 毫秒） */
  now: () => number;
  /** 日志输出 */
  log?: Log;
}

/** 已就绪的持久化：段位存放处与退出前的关闭 */
export interface Persistence {
  store: DbRatingStore;
  /** 退出前调用：旧存档最后一次写盘（并记下其修改时间），随后关闭数据库。返回旧存档是否已落盘 */
  close(): boolean;
}

/** 打开旧存档，写盘成功后把修改时间记入数据库；读取失败时关闭数据库并抛出 StoreLoadError */
function openLegacy(db: DatabaseSync, repo: Repo, opt: PersistenceOptions) {
  try {
    return new FileStore(opt.dataFile, { log: opt.log, now: opt.now, onWritten: mtime => repo.setMeta(LEGACY_MTIME, String(mtime)) });
  } catch (err) {
    db.close();
    throw err;
  }
}

/** 打开数据库与旧存档并同步，返回段位存放处 */
export function openPersistence(opt: PersistenceOptions): Persistence {
  const db = openDatabase(opt.dbFile, { now: opt.now, appVersion: opt.appVersion, log: opt.log });
  const repo = new Repo(db);
  const legacy = openLegacy(db, repo, opt);
  try {
    syncLegacy(repo, legacy, opt.now(), opt.log);
  } catch (err) {
    legacy.close();
    db.close();
    throw new DbOpenError(opt.dbFile, EXIT_DATA_ERROR, `与旧段位存档 ${opt.dataFile} 同步失败（${err instanceof Error ? err.message : String(err)}），已回滚`);
  }
  // 上次运行时尚未终局的对局（服务端重启、维护模式超时后强制重启）记为服务端放弃
  const aborted = repo.abortGames(opt.now());
  if (aborted) opt.log?.('info', 'db.games-aborted', { msg: `上次运行时有 ${aborted} 局尚未终局，已记为服务端放弃`, count: aborted });
  return {
    store: new DbRatingStore(repo, { now: opt.now, legacy }),
    close() {
      const saved = legacy.close();
      db.close();
      return saved;
    },
  };
}

/**
 * 供入口调用：打开持久化；失败时写 `db.open-failed` 或 `store.load-failed` 日志并返回退出码，调用方以之退出。
 * 数据库或存档损坏、迁移或同步失败时宁可不启动，也不带着不完整的数据运行（DAT-050、DAT-042、EDGE-002）
 */
export function startPersistence(opt: PersistenceOptions): Persistence | number {
  try {
    return openPersistence(opt);
  } catch (err) {
    if (err instanceof StoreLoadError) opt.log?.('error', 'store.load-failed', { msg: err.message, file: opt.dataFile, err });
    else if (err instanceof DbOpenError) opt.log?.('error', 'db.open-failed', { msg: err.message, file: opt.dbFile, err });
    else throw err;
    return err.exitCode;
  }
}
