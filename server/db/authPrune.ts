/** 认证数据的定时清理：过期或闲置失效的登录会话，以及窗口已过的限流记录；验证码挑战由 EmailCodes 的仓储清理。 */
import type { DatabaseSync } from 'node:sqlite';
import { AuthLimitRepo } from './authLimits';
import { LoginSessionRepo } from './loginSessions';

/** 返回一次清理的函数；仓储语句只准备一次 */
export function authPruner(db: DatabaseSync): (now: number) => void {
  const sessions = new LoginSessionRepo(db);
  const limits = new AuthLimitRepo(db);
  return now => {
    sessions.prune(now);
    limits.prune(now);
  };
}
