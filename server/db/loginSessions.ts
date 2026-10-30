/** 登录会话持久化：散列索引查询、原子续活、撤销及密码世代更新，SQL 不离开仓储（DAT-044、SEC-021）。 */
import type { DatabaseSync } from 'node:sqlite';
import { SESSION_IDLE_MS, SESSION_LIFETIME_MS } from '../authPolicy';
import { transaction } from './transaction';

/** 仓储内部会话行；散列不得作为公开接口或日志字段输出。 */
export interface StoredSession {
  id: number;
  userId: number;
  authVersion: number;
  expiresAt: number;
  tokenHash: string;
}

/** 将严格表的结果转换为内部资料。 */
function session(row: Record<string, unknown> | undefined): StoredSession | undefined {
  return row
    ? {
        id: Number(row.id),
        userId: Number(row.user_id),
        authVersion: Number(row.auth_version),
        expiresAt: Number(row.expires_at),
        tokenHash: String(row.token_hash),
      }
    : undefined;
}

/** 所有热路径按散列或用户索引定位，不遍历全部会话（SEC-022）。 */
function statements(db: DatabaseSync) {
  const columns = 'id, user_id, auth_version, expires_at, token_hash';
  const valid =
    'token_hash = $hash AND created_at <= $now AND last_seen_at <= $now AND last_seen_at > $idle AND expires_at > $now ' +
    "AND EXISTS (SELECT 1 FROM accounts WHERE user_id = sessions.user_id AND auth_version = sessions.auth_version AND status = 'active')";
  return {
    create: db.prepare(
      'INSERT INTO sessions (token_hash, user_id, auth_version, created_at, expires_at, last_seen_at) ' +
        "SELECT ?, user_id, auth_version, ?, ?, ? FROM accounts WHERE user_id = ? AND auth_version = ? AND status = 'active' " +
        'ON CONFLICT (token_hash) DO NOTHING',
    ),
    read: db.prepare(`SELECT ${columns} FROM sessions WHERE ${valid}`),
    touch: db.prepare(`UPDATE sessions SET last_seen_at = $now WHERE ${valid} RETURNING ${columns}`),
    revoke: db.prepare('DELETE FROM sessions WHERE token_hash = ? RETURNING id, user_id'),
    revokeUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    rotate: db.prepare("UPDATE accounts SET auth_version = auth_version + 1 WHERE user_id = ? AND status = 'active'"),
    password: db.prepare("UPDATE accounts SET pass_hash = ?, auth_version = auth_version + 1 WHERE user_id = ? AND auth_version = ? AND status = 'active'"),
    prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?'),
  };
}

/** 可在更大认证事务中使用；业务在最外层事务成功后再通知连接撤销。 */
export class LoginSessionRepo {
  private readonly sql;
  constructor(private readonly db: DatabaseSync) {
    this.sql = statements(db);
  }

  /** 通知层不能在尚未提交的外层事务中宣布撤销。 */
  get inTransaction(): boolean {
    return this.db.isTransaction;
  }

  /** 认证结果携带的世代必须仍有效，避免验证密码期间发生的改密被旧登录绕过。 */
  create(hash: string, userId: number, version: number, now: number): boolean {
    return this.sql.create.run(hash, now, now + SESSION_LIFETIME_MS, now, userId, version).changes === 1;
  }

  /** 过期和时钟倒退检查与续活同一 SQL 完成，不允许先读后写把过期会话复活。 */
  authorize(hash: string, now: number, touch: boolean): StoredSession | undefined {
    const values = { $hash: hash, $now: now, $idle: now - SESSION_IDLE_MS };
    return session((touch ? this.sql.touch : this.sql.read).get(values));
  }

  /** 撤销一条会话，返回通知连接所需的非机密标识；重复撤销返回 undefined。 */
  revoke(hash: string): { id: number; userId: number } | undefined {
    const row = this.sql.revoke.get(hash);
    return row ? { id: Number(row.id), userId: Number(row.user_id) } : undefined;
  }

  /** 提升账号世代并删除全部会话，同一事务提交。 */
  revokeUser(userId: number): boolean {
    return transaction(this.db, () => {
      if (!this.sql.rotate.run(userId).changes) return false;
      this.sql.revokeUser.run(userId);
      return true;
    });
  }

  /** 写入新口令、提升世代与删除会话同一事务提交；认证世代已变化时拒绝。 */
  changePassword(userId: number, version: number, passwordHash: string): boolean {
    return transaction(this.db, () => {
      if (!this.sql.password.run(passwordHash, userId, version).changes) return false;
      this.sql.revokeUser.run(userId);
      return true;
    });
  }

  /** 定期清理，不保存过期凭据；清理失败不影响已有事务。 */
  prune(now: number): number {
    return Number(this.sql.prune.run(now, now - SESSION_IDLE_MS).changes);
  }
}
