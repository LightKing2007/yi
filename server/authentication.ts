/** 注册、登录、重置与改密的认证组合业务；派生在事务外，凭据消费与账号变更原子提交。 */
import type { DatabaseSync } from 'node:sqlite';
import { accountName, accountPassword } from './accountInput';
import { LOGIN_IP_ATTEMPTS, LOGIN_IP_WINDOW_MS, SESSION_LIFETIME_MS } from './authPolicy';
import { AccountRepo, type StoredAccount } from './db/accounts';
import { AuthLimitRepo } from './db/authLimits';
import { ConsentRepo, type RequiredConsents } from './db/consents';
import { LoginSessionRepo } from './db/loginSessions';
import { transaction } from './db/transaction';
import { normalizeEmail } from './emailAddress';
import { EmailCodes } from './emailCodes';
import { EmailProtection } from './emailProtection';
import { LoginSessions, type SessionRevocation } from './loginSessions';
import { PasswordHasher } from './passwords';

const HASH_LENGTH = 64;
const HASH_FORMAT = /^[0-9a-f]{64}$/;
const DUMMY_SALT_BYTES = 16;
const DUMMY_KEY_BYTES = 64;
const DUMMY_PASSWORD_HASH = `scrypt$131072$8$1$${'00'.repeat(DUMMY_SALT_BYTES)}$${'00'.repeat(DUMMY_KEY_BYTES)}`;
/**
 * 内部业务失败，HTTP 层另行映射公开错误码；不携带输入或数据库异常详情。
 * taken 只在已证明能收信后给出；session 表示令牌失效，与旧密码错误的 denied 区分（账号接口契约第 3.5、3.11 条）。
 */
export class AuthenticationError extends Error {
  constructor(
    readonly reason: 'invalid' | 'denied' | 'consent' | 'limited' | 'taken' | 'session',
    readonly retryAfterMs = 0,
  ) {
    super(`auth-${reason}`);
  }
}
/** 认证服务共享一个派生器，默认使用有界真实 scrypt；测试可注入确定性边界。 */
export type PasswordStore = Pick<PasswordHasher, 'hash' | 'verify'>;
/** 来源是可信连接入口生成的 HMAC，不能使用客户端自报值。 */
export interface LoginInput {
  email: string;
  password: string;
  sourceHash: string;
}
/** 邮箱验证码与明确协议动作共同组成注册资料。 */
export interface RegisterInput extends LoginInput {
  name: string;
  challengeId: string;
  code: string;
  consent: unknown;
}
/** 重置不接受旧密码，也不返回或恢复原始密码。 */
export interface ResetInput extends LoginInput {
  challengeId: string;
  code: string;
}
/** 资料投影不包含内部主键、密码、邮箱表示或认证世代。 */
export interface AccountProfile {
  publicId: string;
  name: string;
  emailVerified: boolean;
  consentsCurrent: boolean;
  onlineAllowed: boolean;
}
/** 协议版本来自服务端装配，撤销通知供未来连接层订阅。 */
export interface AuthenticationOptions {
  required: RequiredConsents;
  passwords?: PasswordStore;
  now?: () => number;
  onRevoke?: (event: SessionRevocation) => void;
}

/** 本批只提供业务方法，尚未接入 HTTP、客户端、真实邮件或现有 WebSocket。 */
export class Authentication {
  readonly sessions: LoginSessions;
  private readonly accounts: AccountRepo;
  private readonly consents: ConsentRepo;
  private readonly limits: AuthLimitRepo;
  private readonly sessionRepo: LoginSessionRepo;
  private readonly passwords: PasswordStore;
  private readonly opt: AuthenticationOptions;

  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: EmailProtection,
    private readonly codes: EmailCodes,
    options: AuthenticationOptions,
  ) {
    this.opt = { ...options };
    this.passwords = options.passwords ?? new PasswordHasher();
    this.accounts = new AccountRepo(db);
    this.consents = new ConsentRepo(db, options.required);
    this.limits = new AuthLimitRepo(db);
    this.sessionRepo = new LoginSessionRepo(db);
    this.sessions = new LoginSessions(this.sessionRepo, { now: () => this.now(), onRevoke: options.onRevoke });
  }

  /** 验码先预检；派生完成后在同一事务内重新消费、创建账号及签发会话。 */
  async register(input: RegisterInput) {
    this.autocommit();
    const name = accountName(input.name);
    if (!name) throw new AuthenticationError('invalid');
    const consents = this.consents.acceptance(input.consent);
    if (!consents) throw new AuthenticationError('consent');
    const { email, password, lookup } = this.credentials(input, true);
    const proof = this.codes.check({ ...input, email, purpose: 'register' });
    if (!proof) throw new AuthenticationError('denied');
    if (this.accounts.byEmailLookup(lookup)) throw new AuthenticationError('taken');
    const passwordHash = await this.passwords.hash(password);
    try {
      return transaction(this.db, () => {
        if (!this.codes.consume(proof)) throw new AuthenticationError('denied');
        const stored = this.accounts.create({ name, emailLookup: lookup, passwordHash, now: this.now(), consents }, id =>
          this.vault.seal(email, { purpose: 'account-email', recordId: String(id) }),
        );
        return this.issue(stored);
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'account-email-taken') throw new AuthenticationError('taken');
      throw error;
    }
  }

  /** 缺失账号同样执行固定成本虚拟验证；等待期间改密不能由旧验证结果签发。 */
  async login(input: LoginInput) {
    this.autocommit();
    const { password, lookup } = this.credentials(input, false);
    this.unlocked(lookup);
    const stored = this.accounts.byEmailLookup(lookup);
    const matched = await this.passwords.verify(password, stored?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!matched || !stored) this.failed(lookup);
    return transaction(this.db, () => {
      this.unlocked(lookup);
      const current = this.accounts.byUserId(stored.userId);
      if (!current || current.authVersion !== stored.authVersion || current.passwordHash !== stored.passwordHash || current.emailLookup !== lookup) {
        throw new AuthenticationError('denied');
      }
      const result = this.issue(current);
      this.limits.clearFailures(lookup);
      return result;
    });
  }

  /** 有效邮箱证明的重置对不存在账号也返回完成；密码写入与全部会话撤销一起提交。 */
  async reset(input: ResetInput): Promise<void> {
    this.autocommit();
    const { email, password, lookup } = this.credentials(input, true);
    const proof = this.codes.check({ ...input, email, purpose: 'reset' });
    if (!proof) throw new AuthenticationError('denied');
    const stored = this.accounts.byEmailLookup(lookup);
    const passwordHash = await this.passwords.hash(password);
    const userId = transaction(this.db, () => {
      if (!this.codes.consume(proof)) throw new AuthenticationError('denied');
      if (!stored) return undefined;
      if (!this.sessionRepo.changePassword(stored.userId, stored.authVersion, passwordHash)) throw new AuthenticationError('denied');
      this.limits.clearFailures(lookup);
      return stored.userId;
    });
    if (userId !== undefined) this.opt.onRevoke?.({ userId });
  }

  /** 旧密码与会话都必须仍有效；新密码不在 SQLite 事务中派生。 */
  async changePassword(input: { token: string; oldPassword: string; password: string; sourceHash: string }): Promise<void> {
    this.autocommit();
    const token = input.token;
    const old = accountPassword(input.oldPassword);
    const password = accountPassword(input.password, true);
    if (old === undefined || password === undefined) throw new AuthenticationError('invalid');
    this.admit(input.sourceHash);
    const identity = this.current(token);
    if (!identity) throw new AuthenticationError('session');
    this.unlocked(identity.account.emailLookup);
    if (!(await this.passwords.verify(old, identity.account.passwordHash))) this.failed(identity.account.emailLookup);
    const passwordHash = await this.passwords.hash(password);
    transaction(this.db, () => {
      this.unlocked(identity.account.emailLookup);
      const current = this.current(token);
      if (
        !current ||
        current.account.authVersion !== identity.account.authVersion ||
        !this.sessionRepo.changePassword(identity.account.userId, identity.account.authVersion, passwordHash)
      )
        throw new AuthenticationError('session');
      this.limits.clearFailures(identity.account.emailLookup);
    });
    this.opt.onRevoke?.({ userId: identity.account.userId });
  }

  /** 当前资料只读检查，不通过轮询延长会话。 */
  me(token: unknown): AccountProfile | undefined {
    const identity = this.current(token);
    return identity ? this.profile(identity.account) : undefined;
  }

  /** 供后续联机入口调用的三项联合检查，本批不替换现有游客协议。 */
  online(token: unknown) {
    const identity = this.current(token, true);
    return identity && this.profile(identity.account).onlineAllowed ? identity.session : undefined;
  }

  /** 修改雅号不改变公开 UID；写入与鉴权同一事务，并更新会话活动时间。 */
  rename(token: unknown, value: unknown): AccountProfile {
    this.autocommit();
    const name = accountName(value);
    if (!name) throw new AuthenticationError('invalid');
    return transaction(this.db, () => {
      const identity = this.current(token, true);
      if (!identity || !this.accounts.rename(identity.account.userId, name)) throw new AuthenticationError('session');
      return this.profile({ ...identity.account, name });
    });
  }

  /** 登录后明确接受新必需版本；令牌在最终写入事务中重新鉴权，并更新会话活动时间。 */
  acceptConsents(token: unknown, value: unknown): boolean {
    this.autocommit();
    return transaction(this.db, () => {
      const identity = this.current(token, true);
      return !!identity && this.consents.accept(identity.account.userId, value, this.now());
    });
  }

  /** 退出当前登录，沿用同一已提交撤销通知路径。 */
  logout(token: unknown): void {
    this.sessions.logout(token);
  }

  /** 签发结果只投影公开资料，不能把仓储认证资料透传。 */
  private issue(account: StoredAccount) {
    return { ...this.sessions.issue(account), user: this.profile(account) };
  }

  /** 认证世代和活动账号再次匹配，拒绝改密或关闭后残留的身份。 */
  private current(token: unknown, touch = false) {
    const session = this.sessions.authorize(token, touch);
    const account = session ? this.accounts.byUserId(session.userId) : undefined;
    return session && account && session.authVersion === account.authVersion ? { session, account } : undefined;
  }

  /** 未来邮箱验证时刻不视为已验证，当前协议同意从数据库读取。 */
  private profile(account: StoredAccount): AccountProfile {
    const now = this.now();
    const emailVerified = account.emailVerifiedAt >= 0 && account.emailVerifiedAt <= now;
    const consentsCurrent = this.consents.current(account.userId, now);
    return { publicId: account.publicId, name: account.name, emailVerified, consentsCurrent, onlineAllowed: emailVerified && consentsCurrent };
  }

  /** 基本格式、大小和来源预算先于验证码核验与昂贵密码任务。 */
  private credentials(input: LoginInput, creation: boolean) {
    const email = normalizeEmail(input.email);
    const password = accountPassword(input.password, creation);
    if (!email || password === undefined) throw new AuthenticationError('invalid');
    this.admit(input.sourceHash);
    return { email, password, lookup: this.vault.lookup(email) };
  }

  /** 所有密码派生入口共享来源预算，发码限额另行保留。 */
  private admit(source: string): void {
    if (!HASH_FORMAT.test(source) || source.length !== HASH_LENGTH) throw new AuthenticationError('invalid');
    const retry = this.limits.take({ scope: 'login-ip', subject: source, max: LOGIN_IP_ATTEMPTS, windowMs: LOGIN_IP_WINDOW_MS }, this.now());
    if (retry) throw new AuthenticationError('limited', retry);
  }

  /** 正确密码也不能绕过尚未结束的账号锁定。 */
  private unlocked(lookup: string): void {
    const retry = this.limits.blocked(lookup, this.now());
    if (retry) throw new AuthenticationError('limited', retry);
  }

  /** 失败计数单独提交后再抛错，不能随错误事务回滚或重复计数。 */
  private failed(lookup: string): never {
    const retry = this.limits.failure(lookup, this.now());
    throw new AuthenticationError(retry ? 'limited' : 'denied', retry);
  }

  /** 异步认证不能嵌套到调用者尚未提交的事务中。 */
  private autocommit(): void {
    if (this.db.isTransaction) throw new Error('auth-not-committed');
  }

  /** 共用可替换时钟，保留后续会话与限额计算的安全整数空间。 */
  private now(): number {
    const now = (this.opt.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - SESSION_LIFETIME_MS) throw new Error('auth-clock-invalid');
    return now;
  }
}
