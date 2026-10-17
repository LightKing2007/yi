/**
 * `node server.cjs backup`：备份数据库后退出（DAT-060 至 DAT-064），在服务器上由 yi-backup.service 每小时运行一次。
 * 结果写 `db.backup-*` 日志（07-operations.md 第 8 节）；成功或数据库尚不存在时返回 0，失败时返回 1，yi-backup.service 随之记为失败，不触发异地备份。
 */
import type { ServerConfig } from './config';
import { backupDatabase } from './db/backup';
import type { Log } from './log';

/** 退出码：备份失败 */
const EXIT_FAILED = 1;

/** 执行一次备份，返回退出码 */
export function runBackup(deps: { config: Pick<ServerConfig, 'dbFile' | 'backupDir'>; log: Log; now: () => number }): number {
  const { dbFile, backupDir } = deps.config;
  try {
    const result = backupDatabase({ dbFile, dir: backupDir, now: deps.now });
    if (!result) {
      deps.log('info', 'db.backup-skipped', { msg: `数据库 ${dbFile} 还不存在，本次不备份`, file: dbFile });
      return 0;
    }
    const { file, bytes, sha256, counts, pruned, kept } = result;
    deps.log('info', 'db.backup-done', { msg: `数据库已备份，共保留 ${kept} 份`, file, bytes, sha256, counts, pruned: pruned.length, kept });
    return 0;
  } catch (err) {
    deps.log('error', 'db.backup-failed', { msg: `数据库 ${dbFile} 备份失败`, file: dbFile, dir: backupDir, err });
    return EXIT_FAILED;
  }
}
