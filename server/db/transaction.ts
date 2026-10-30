/** 同步仓储事务：外层使用 IMMEDIATE，已有事务使用保存点，失败只回滚当前作用域（DAT-040）。 */
import type { DatabaseSync } from 'node:sqlite';

/** 回调必须同步，不等待网络或密码派生；嵌套调用也不能提前提交外层事务。 */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  const outer = !db.isTransaction;
  db.exec(outer ? 'BEGIN IMMEDIATE' : 'SAVEPOINT auth_nested');
  try {
    const result = work();
    db.exec(outer ? 'COMMIT' : 'RELEASE auth_nested');
    return result;
  } catch (error) {
    db.exec(outer ? 'ROLLBACK' : 'ROLLBACK TO auth_nested');
    if (!outer) db.exec('RELEASE auth_nested');
    throw error;
  }
}
