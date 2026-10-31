/** 认证组合测试夹具：共享真实 SQLite 和手动时钟，密码边界默认确定性，另有真实派生集成测试。 */
import { vi } from 'vitest';
import { Authentication, type AuthenticationOptions, type PasswordStore } from '../server/authentication';
import type { SessionRevocation } from '../server/loginSessions';
import { AUTH_CHANGED_HASH, AUTH_TEST_HASH } from './authWorld';
import { CodeWorld } from './emailCodesWorld';

/** 只有固定假旧、新密码匹配对应格式，不模拟生产密码学。 */
export class AuthenticationWorld extends CodeWorld {
  readonly passwords = {
    hash: vi.fn<PasswordStore['hash']>(async () => AUTH_CHANGED_HASH),
    verify: vi.fn(
      async (password: string, hash: string) =>
        (password === 'old-password' && hash === AUTH_TEST_HASH) || (password === 'new-password' && hash === AUTH_CHANGED_HASH),
    ),
  };
  readonly notifications: { event: SessionRevocation; committed: boolean; remainingSessions: number }[] = [];
  readonly auth: Authentication;

  constructor(options: Partial<AuthenticationOptions> = {}) {
    super();
    this.auth = new Authentication(this.db, this.vault, this.codes, {
      required: { privacy: 'v1', terms: 'v1' },
      now: () => this.now,
      passwords: this.passwords,
      onRevoke: event =>
        this.notifications.push({
          event,
          committed: !this.db.isTransaction,
          remainingSessions: Number(this.db.prepare('SELECT count(*) AS total FROM sessions WHERE user_id = ?').get(event.userId)?.total),
        }),
      ...options,
    });
  }

  /** 测试显式等待发送边界完成再使用验证码。 */
  async code(email = 'new@example.com', purpose: 'register' | 'reset' = 'register') {
    const challengeId = this.request(email, purpose);
    await this.codes.deliver(challengeId);
    return { challengeId, email, code: '001234' };
  }

  /** 新账号表单，明确接受固定测试版本，复用假新密码。 */
  registration(proof: { email: string; challengeId: string; code: string }) {
    return { ...proof, name: '  棋友  ', password: 'new-password', consent: { accepted: true, privacy: 'v1', terms: 'v1' }, sourceHash: 'a'.repeat(64) };
  }

  /** 旧账号登录，来源预算与其他密码操作共享。 */
  login(password = 'old-password', email = 'player@example.com', sourceHash = 'a'.repeat(64)) {
    return this.auth.login({ email, password, sourceHash });
  }
}
