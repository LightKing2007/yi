/**
 * 服务端启动时的持久化：打开数据库（检查与迁移），把上次运行时尚未终局的对局记为服务端放弃，建立数据库中的段位与对局记录存放处。
 * 失败时抛出 DbOpenError，调用方以其中的退出码拒绝启动（EDGE-002）。
 */
import type { Log } from '../log';
import { DbOpenError, openDatabase } from './index';
import { DbRatingStore } from './ratingStore';
import { Repo } from './repo';

/** 启动持久化的参数 */
export interface PersistenceOptions {
  /** 数据库文件 */
  dbFile: string;
  /** 程序的版本号，用于迁移前备份的文件名 */
  appVersion: string;
  /** 当前时刻（Unix 毫秒） */
  now: () => number;
  /** 日志输出 */
  log?: Log;
}

/** 已就绪的持久化：段位与对局记录的存放处，以及退出前的关闭 */
export interface Persistence {
  store: DbRatingStore;
  /** 退出前调用：关闭数据库 */
  close(): void;
}

/** 打开数据库并返回存放处 */
export function openPersistence(opt: PersistenceOptions): Persistence {
  const db = openDatabase(opt.dbFile, { now: opt.now, appVersion: opt.appVersion, log: opt.log });
  const repo = new Repo(db);
  // 上次运行时尚未终局的对局（服务端重启、维护模式超时后强制重启）记为服务端放弃
  const aborted = repo.abortGames(opt.now());
  if (aborted) opt.log?.('info', 'db.games-aborted', { msg: `上次运行时有 ${aborted} 局尚未终局，已记为服务端放弃`, count: aborted });
  return { store: new DbRatingStore(repo, { now: opt.now }), close: () => db.close() };
}

/** 供入口调用：打开持久化；数据库无法打开、已损坏或迁移失败时写 `db.open-failed` 日志并返回退出码，调用方以之退出 */
export function startPersistence(opt: PersistenceOptions): Persistence | number {
  try {
    return openPersistence(opt);
  } catch (err) {
    if (!(err instanceof DbOpenError)) throw err;
    opt.log?.('error', 'db.open-failed', { msg: err.message, file: opt.dbFile, err });
    return err.exitCode;
  }
}
