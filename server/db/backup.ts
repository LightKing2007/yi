/**
 * 数据库的本地备份（DAT-060 至 DAT-064；阶段 5 第 7 步）：由 `node server.cjs backup` 调用，在服务器上由 yi-backup.timer 每小时运行一次。
 * 以 `VACUUM INTO` 生成一致的快照（DAT-062），对快照做完整性检查并统计各表的条数，附 SHA-256 校验和（DAT-064），再按保留策略删除旧的备份。
 * 备份文件名为 yi-UTC时间.db，与迁移前的备份 pre-migrate-*.db（server/db/index.ts）不同，保留策略只处理前者。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** 备份文件名：yi-UTC时间.db，第一组为日期（YYYYMMDD） */
export const BACKUP_NAME = /^yi-(\d{8})T\d{6}Z\.db$/;
/** 保留最新的多少份（每小时一份，即最近 24 小时，DAT-060 的 RPO ≤ 1 小时） */
export const KEEP_RECENT = 24;
/** 另外保留最近多少天中每天最新的一份（DAT-061 的“每日一份，保留 7 份”） */
export const KEEP_DAYS = 7;
/** 统计条数的表（roadmap.md 第 5.2.2 节），恢复演练时据以核对（DAT-065） */
const TABLES = ['users', 'devices', 'ratings', 'games', 'rating_changes'] as const;
/** 备份文件与校验和的权限：只有服务端的用户可读写 */
const FILE_MODE = 0o600;
/** 读快照时等待写锁的毫秒数：服务端正在提交时稍等，而不是立即失败 */
const BUSY_TIMEOUT_MS = 5000;

/** 一个数据库文件的检查结果：完整性检查通过，各表的条数 */
export type TableCounts = Record<(typeof TABLES)[number], number>;

/** 一次备份的结果 */
export interface BackupResult {
  /** 备份文件的绝对路径 */
  file: string;
  /** 字节数 */
  bytes: number;
  /** SHA-256（十六进制） */
  sha256: string;
  /** 各表的条数 */
  counts: TableCounts;
  /** 按保留策略删除的旧备份（文件名） */
  pruned: string[];
  /** 删除后保留的份数 */
  kept: number;
}

/** Unix 毫秒数转为备份文件名，如 yi-20261017T020700Z.db */
export function backupName(ms: number) {
  const stamp = new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `yi-${stamp}.db`;
}

/**
 * 保留策略（纯函数）：在 names 中找出应删除的备份。保留最新的 KEEP_RECENT 份，以及最近 KEEP_DAYS 个有备份的日期（UTC）中各自最新的一份；
 * 不是备份文件名的一律不动
 */
export function toPrune(names: readonly string[]): string[] {
  const backups = names.filter(name => BACKUP_NAME.test(name)).sort();
  const keep = new Set(backups.slice(-KEEP_RECENT));
  const latestOfDay = new Map<string, string>();
  for (const name of backups) latestOfDay.set(BACKUP_NAME.exec(name)?.[1] ?? '', name); // 已排序：后写入的为当天最新的一份
  for (const name of [...latestOfDay.values()].slice(-KEEP_DAYS)) keep.add(name);
  return backups.filter(name => !keep.has(name));
}

/** 只读打开数据库文件，做完整性检查并统计各表的条数；未通过时抛出 */
export function inspectDatabase(file: string): TableCounts {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const result = db.prepare('PRAGMA integrity_check').all();
    if (result.length !== 1 || result[0]?.integrity_check !== 'ok') {
      throw new Error(`${file} 未通过完整性检查（${result.map(row => String(row.integrity_check)).join('；')}）`);
    }
    const counts = {} as TableCounts;
    for (const table of TABLES) counts[table] = Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
    return counts;
  } finally {
    db.close();
  }
}

/** 文件的 SHA-256（十六进制） */
const sha256Of = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** 写入文件并落盘 */
function writeSynced(file: string, text: string) {
  const fd = fs.openSync(file, 'wx', FILE_MODE);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 备份数据库 dbFile 到目录 dir：先写临时文件，检查通过后改名，再写 .sha256（sha256sum 的格式），最后按保留策略删除旧的备份。
 * 数据库还不存在时返回 undefined（不备份）；任何一步失败都删除临时文件并抛出，已有的备份不受影响
 */
export function backupDatabase(opt: { dbFile: string; dir: string; now: () => number }): BackupResult | undefined {
  if (!fs.existsSync(opt.dbFile)) return undefined;
  fs.mkdirSync(opt.dir, { recursive: true, mode: 0o700 });
  const name = backupName(opt.now());
  const file = path.join(opt.dir, name);
  if (fs.existsSync(file)) throw new Error(`${file} 已存在`);
  const tmp = path.join(opt.dir, `.${name}.tmp`);
  try {
    const source = new DatabaseSync(opt.dbFile, { readOnly: true });
    try {
      source.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      source.prepare('VACUUM INTO ?').run(tmp); // 在线备份（DAT-062）：读取一致的快照，不阻塞服务端写入
    } finally {
      source.close();
    }
    const counts = inspectDatabase(tmp);
    const sha256 = sha256Of(tmp);
    fs.renameSync(tmp, file);
    writeSynced(`${file}.sha256`, `${sha256}  ${name}\n`);
    const pruned = toPrune(fs.readdirSync(opt.dir));
    for (const old of pruned) for (const name of [old, `${old}.sha256`]) fs.rmSync(path.join(opt.dir, name), { force: true });
    const kept = fs.readdirSync(opt.dir).filter(n => BACKUP_NAME.test(n)).length;
    return { file, bytes: fs.statSync(file).size, sha256, counts, pruned, kept };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
