/** 认证测试的真实 SQLite、固定虚构账号、可替换时钟和确定性令牌；不连接外网。 */
import { openDatabase, MEMORY } from '../server/db';
import { AccountRepo } from '../server/db/accounts';
import { LoginSessionRepo } from '../server/db/loginSessions';
import { EmailProtection } from '../server/emailProtection';
import { LoginSessions, type SessionRevocation } from '../server/loginSessions';
import { checkedPublicId } from '../src/shared/publicId';

/** 已有密码格式的固定虚构凭据，不用于校验真实口令。 */
export const AUTH_TEST_HASH = `scrypt$131072$8$1$${'01'.repeat(16)}$${'02'.repeat(64)}`;
/** 用于比较更新是否完整提交的第二个虚构口令散列。 */
export const AUTH_CHANGED_HASH = `scrypt$131072$8$1$${'03'.repeat(16)}$${'04'.repeat(64)}`;
/** 可手动推进时钟、产生确定性标识，所有持久化行为都在真实内存数据库执行。 */
export class AuthWorld {
  now = Date.UTC(2026, 9, 31);
  readonly db = openDatabase(MEMORY, { now: () => this.now, appVersion: '3.1.0' });
  private userSerial = 0;
  private tokenSerial = 0;
  readonly accounts = new AccountRepo(this.db, () => checkedPublicId(String(++this.userSerial).padStart(7, '0')));
  readonly vault = new EmailProtection({ currentKeyId: 'test', encryption: new Map([['test', Buffer.alloc(32, 1)]]), lookup: Buffer.alloc(32, 2) });
  readonly repo = new LoginSessionRepo(this.db);
  readonly events: SessionRevocation[] = [];
  readonly sessions = new LoginSessions(this.repo, {
    now: () => this.now,
    mint: () => (++this.tokenSerial).toString(16).padStart(32, '0'),
    onRevoke: event => this.events.push(event),
  });
  readonly user = this.account('player@example.com');

  /** 注册一个固定虚构账号，雅号可以重名。 */
  account(email: string) {
    return this.accounts.create(
      { name: '棋友', emailLookup: this.vault.lookup(email), passwordHash: AUTH_TEST_HASH, now: this.now, consents: [{ kind: 'privacy', version: 'v1' }] },
      id => this.vault.seal(email, { purpose: 'account-email', recordId: String(id) }),
    );
  }

  /** 必须在每条测试后释放 SQLite 连接。 */
  close() {
    this.db.close();
  }
}
