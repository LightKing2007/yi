/** 验证码测试夹具：真实数据库、手动时钟、发送器和可主动触发的截止事件。 */
import { CodeCredentials, type CodePurpose } from '../server/codeCredentials';
import { EmailCodes, type CodeMail, type EmailCodeOptions } from '../server/emailCodes';
import { AuthWorld } from './authWorld';

/** 明确的同步事件，等待发送器启动或完成，不用等待执行速度。 */
export function deferred() {
  let finish = () => {};
  const promise = new Promise<void>(resolve => {
    finish = resolve;
  });
  return { promise, resolve: () => finish() };
}
/** 所有地址、凭据、密钥均为固定虚构资料。 */
export class CodeWorld extends AuthWorld {
  serial = 0;
  readonly mails: CodeMail[] = [];
  readonly deadlines: { fire: () => void; ms: number; cancelled: boolean }[] = [];
  readonly codes: EmailCodes;

  constructor(options: Partial<EmailCodeOptions> = {}) {
    super();
    const credentials = new CodeCredentials({ currentKeyId: 'test', keys: new Map([['test', Buffer.alloc(32, 3)]]) });
    try {
      this.codes = new EmailCodes(this.db, this.vault, credentials, {
        globalPerMinute: 100,
        now: () => this.now,
        nextId: () => (++this.serial).toString(16).padStart(32, '0'),
        nextCode: () => '001234',
        sender: async mail => {
          this.mails.push(mail);
        },
        schedule: (fire, ms) => {
          const timer = { fire, ms, cancelled: false };
          this.deadlines.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
        ...options,
      });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** 申请成功的内部编号；拒绝由对应测试直接断言响应。 */
  request(email = 'a@example.com', purpose: CodePurpose = 'register', sourceHash = 'a'.repeat(64)): string {
    const result = this.codes.request({ email, purpose, sourceHash });
    if (!('challengeId' in result)) throw new Error('test-admission-rejected');
    return result.challengeId;
  }

  /** 测试观察内部状态，不经过日志或对外资料接口。 */
  row(id: string) {
    return this.db.prepare('SELECT * FROM email_challenges WHERE challenge_id = ?').get(id);
  }

  /** 默认假发信内容，可覆盖错误、用途与邮箱。 */
  check(challengeId: string, code = '001234', purpose: CodePurpose = 'register', email = 'a@example.com') {
    return this.codes.check({ challengeId, email, code, purpose });
  }
}
