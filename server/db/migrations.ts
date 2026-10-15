/** 数据库迁移的清单：每一项对应 server/db/migrations/ 下的一个 SQL 文件（DAT-017），按序号排列，以文本形式打包进 server.cjs */
import init from './migrations/0001_init.sql?raw';

/** 一个迁移：结构版本号即文件名的序号 */
export interface Migration {
  /** 执行后的结构版本号（DAT-041） */
  version: number;
  /** 文件名（不含扩展名），如 `0001_init` */
  name: string;
  /** 迁移的 SQL 语句 */
  sql: string;
}

/** 全部迁移，结构版本号从 1 起连续；新增迁移时在此追加一项（tests/db.test.ts 核对与目录中的文件一致） */
export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: '0001_init', sql: init }];
