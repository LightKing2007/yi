/**
 * 旧段位存档 yi-ratings.json 与数据库的同步（roadmap.md 第 5.6 节，阶段 5 开发计划的决定 D5-1）。
 * 首个数据库版本在一个版本周期内同时写入该文件，使回滚到 2.0.7 后段位不丢。启动时以文件的修改时间判断它是否被别的程序改过：
 * - 与数据库中记下的不同（第一次启动，或回滚期间由 2.0.7 写过）：以文件为准，把有差异的记录同步进数据库，写段位变化明细；
 * - 相同：以数据库为准，把文件中落后的记录补齐（进程被强制结束时，文件的写盘可能落后于数据库）。
 */
import type { Rating, Ratings } from '../../src/shared/protocol';
import type { Log } from '../log';
import { GAME_TYPES, type Repo } from './repo';

/** 元数据中记下的旧存档修改时间（数据库版本最近一次写入该文件后的 mtimeMs） */
export const LEGACY_MTIME = 'legacy_json_mtime';
/** 设备散列的格式：sha256('yi:' + uid) 的前 32 位十六进制（DAT-075） */
const UID_HASH = /^[0-9a-f]{32}$/;

/** 旧存档中同步要用到的部分（server/store.ts 的 FileStore） */
export interface LegacyFile {
  /** 文件的修改时间（毫秒）；文件不存在时为 undefined */
  mtime(): number | undefined;
  /** 文件中的全部有效记录：设备散列 → 昵称与段位 */
  entries(): Iterable<[string, { name: string; ratings: Ratings }]>;
  /** 一名玩家的段位 */
  get(key: string): Ratings | undefined;
  /** 写入一名玩家的段位（延迟写盘） */
  set(key: string, ratings: Ratings, name: string): void;
}

/** 同步的结果 */
export interface SyncResult {
  /** 是否以文件为准同步进了数据库 */
  imported: boolean;
  /** 新建的用户数 */
  created: number;
  /** 段位有变化的用户数（含新建的） */
  updated: number;
  /** 设备散列格式不对、跳过的记录 */
  skipped: string[];
  /** 从数据库补写到文件的记录数 */
  exported: number;
}

const same = (left: Rating, right: Rating) => left.points === right.points && left.win === right.win && left.loss === right.loss && left.draw === right.draw;

/** 以文件为准同步进数据库；调用方须包在一个事务内 */
function importFile(repo: Repo, file: LegacyFile, now: number) {
  let created = 0,
    updated = 0;
  const skipped: string[] = [];
  for (const [uidHash, entry] of file.entries()) {
    if (!UID_HASH.test(uidHash)) {
      skipped.push(uidHash); // 被篡改的键（如 __proto__）不符合设备散列的约束，跳过而不使整个同步失败
      continue;
    }
    const existing = repo.userOf(uidHash);
    const userId = repo.ensure(uidHash, entry.name, now);
    if (existing === undefined) created++;
    const before = repo.ratingsOf(userId);
    const changed = GAME_TYPES.filter(type => existing === undefined || !same(before[type], entry.ratings[type]));
    for (const type of changed) {
      repo.saveRating(userId, type, entry.ratings[type], now);
      repo.recordChange({ userId, type, before: before[type].points, after: entry.ratings[type].points, cause: 'import' }, now);
    }
    if (changed.length) updated++;
  }
  return { created, updated, skipped };
}

/** 把数据库中段位与文件不同的玩家补写到文件，返回补写的条数 */
function exportFile(repo: Repo, file: LegacyFile) {
  let exported = 0;
  for (const player of repo.guests()) {
    const saved = file.get(player.uidHash);
    if (saved && GAME_TYPES.every(type => same(saved[type], player.ratings[type]))) continue;
    file.set(player.uidHash, player.ratings, player.name);
    exported++;
  }
  return exported;
}

/** 启动时同步旧存档与数据库；以文件为准同步时，同步与记下修改时间在一个事务内，失败即整体回滚并抛出 */
export function syncLegacy(repo: Repo, file: LegacyFile, now: number, log?: Log): SyncResult {
  const mtime = file.mtime();
  let result = { created: 0, updated: 0, skipped: [] as string[] };
  const imported = mtime !== undefined && repo.meta(LEGACY_MTIME) !== String(mtime);
  if (imported) {
    result = repo.transaction(() => {
      const done = importFile(repo, file, now);
      repo.setMeta(LEGACY_MTIME, String(mtime));
      return done;
    });
    if (result.skipped.length) {
      log?.('warn', 'db.legacy-skipped', {
        msg: `旧段位存档中有 ${result.skipped.length} 条记录的键不是设备散列，已跳过`,
        count: result.skipped.length,
        first: result.skipped[0],
      });
    }
  }
  const exported = exportFile(repo, file);
  log?.('info', 'db.legacy-synced', {
    msg: imported ? '旧段位存档已同步进数据库' : '旧段位存档未被其他程序改动，以数据库为准',
    imported,
    created: result.created,
    updated: result.updated,
    exported,
  });
  return { imported, ...result, exported };
}
