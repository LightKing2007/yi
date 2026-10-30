/** 登录会话业务边界：只在认证成功后发令牌，验证时只查散列；尚未接入 HTTP 或 WebSocket（SEC-020 至 SEC-022）。 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { SESSION_LIFETIME_MS, SESSION_TOKEN_ATTEMPTS } from './authPolicy';
import { LoginSessionRepo } from './db/loginSessions';

const TOKEN_BYTES = 16;
const TOKEN_FORMAT = /^[0-9a-f]{32}$/;
/** 登录结果的非机密资料，不能代替后续请求的令牌验证。 */
export interface LoginIdentity {
  userId: number;
  authVersion: number;
}
/** 当前有效会话的非机密标识，用于绑定和撤销认证连接。 */
export interface LoginSession extends LoginIdentity {
  id: number;
  expiresAt: number;
}
/** 撤销事件不携带原始令牌或散列；连接接入层在后续批次订阅。 */
export interface SessionRevocation {
  userId: number;
  sessionId?: number;
}
/** 时钟、随机源与已提交撤销通知由装配层注入。 */
export interface LoginSessionOptions {
  now?: () => number;
  mint?: () => string;
  onRevoke?: (event: SessionRevocation) => void;
}

/** SEC-020：128 位随机数；API-013 的令牌采用 32 位小写十六进制。 */
function mintToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))).toString('hex');
}
/** 高熵令牌仅散列持久化（DAT-070）。 */
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/** 共享认证服务实例；撤销方法不能在外层未提交事务中调用，跨仓储事务使用仓储接口。 */
export class LoginSessions {
  constructor(
    private readonly repo: LoginSessionRepo,
    private readonly opt: LoginSessionOptions = {},
  ) {}

  /** 调用者已验证密码，身份世代在入库时再次校验；碰撞有限重试。 */
  issue(identity: LoginIdentity): { token: string; expiresAt: number } {
    const now = this.now();
    for (let attempt = 0; attempt < SESSION_TOKEN_ATTEMPTS; attempt++) {
      const token = (this.opt.mint ?? mintToken)();
      if (!TOKEN_FORMAT.test(token)) throw new Error('session-random-invalid');
      if (this.repo.create(digest(token), identity.userId, identity.authVersion, now)) return { token, expiresAt: now + SESSION_LIFETIME_MS };
    }
    throw new Error('session-issue-rejected');
  }

  /** 过期前才可更新活动时间；只读检查不延长闲置期限。 */
  authorize(token: unknown, touch = true): LoginSession | undefined {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return undefined;
    const hash = digest(token);
    const stored = this.repo.authorize(hash, this.now(), touch);
    if (!stored || !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.tokenHash, 'hex'))) return undefined;
    return { id: stored.id, userId: stored.userId, authVersion: stored.authVersion, expiresAt: stored.expiresAt };
  }

  /** 退出只撤销当前会话，重复退出安全；通知在删除已提交后执行。 */
  logout(token: unknown): void {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return;
    this.requireAutocommit();
    const revoked = this.repo.revoke(digest(token));
    if (revoked) this.opt.onRevoke?.({ userId: revoked.userId, sessionId: revoked.id });
  }

  /** 撤销某账号全部会话，立即通知连接层；密码变化由更大的认证事务调用对应仓储方法。 */
  revokeUser(userId: number): boolean {
    this.requireAutocommit();
    const revoked = this.repo.revokeUser(userId);
    if (revoked) this.opt.onRevoke?.({ userId });
    return revoked;
  }

  /** 回滚后不能留下已关闭连接的假通知，跨仓储事务由认证业务在提交后通知。 */
  private requireAutocommit(): void {
    if (this.repo.inTransaction) throw new Error('session-not-committed');
  }

  /** 时间读取统一经注入边界；时钟损坏时明确失败，不给出无限期限。 */
  private now(): number {
    const now = (this.opt.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('auth-clock-invalid');
    return now;
  }
}
