/** 邮箱验证码业务：持久化入队与限额，事务外有界发送，预检与最终单次消费分离。 */
import type { DatabaseSync } from 'node:sqlite';
import {
  CODE_COOLDOWN_MS,
  CODE_EMAIL_BUDGET,
  CODE_EMAIL_WINDOW_MS,
  CODE_GLOBAL_WINDOW_MS,
  CODE_ID_ATTEMPTS,
  CODE_SEND_TIMEOUT_MS,
  CODE_SOURCE_BUDGET,
  CODE_SOURCE_WINDOW_MS,
  CODE_TTL_MS,
} from './authPolicy';
import { CodeCredentials, newChallengeId, newEmailCode, validCodeContext, type CodePurpose } from './codeCredentials';
import { AuthLimitRepo } from './db/authLimits';
import { EmailChallengeRepo, type CodeProof } from './db/emailChallenges';
import { transaction } from './db/transaction';
import { normalizeEmail } from './emailAddress';
import { DEFAULT_MAIL_LANGUAGE, type MailLanguage } from './codeMailText';
import { EmailProtection } from './emailProtection';

const HASH_LENGTH = 64;
const CHALLENGE_ID_LENGTH = 32;
const HASH_FORMAT = /^[0-9a-f]{64}$/;
const MAX_GLOBAL_BUDGET = 1000;
const GLOBAL_SUBJECT = '0'.repeat(HASH_LENGTH);
/** 存储状态到对外进度；consumed、superseded 已不是当前挑战，查询语句不会返回。 */
const DELIVERY: Readonly<Record<string, CodeDelivery>> = { queued: 'pending', sending: 'pending', sent: 'sent', failed: 'retry', unknown: 'retry' };
/** 发信资料只交给受控适配器，不得写入日志或持久化队列。 */
export interface CodeMail {
  email: string;
  code: string;
  purpose: CodePurpose;
  challengeId: string;
  /** 申请时玩家的界面语言，决定邮件使用的语言 */
  language: MailLanguage;
}
/** 全局发送预算必须由装配层明确提供；时钟、定时器和随机入口可替换以作确定性测试。 */
export interface EmailCodeOptions {
  globalPerMinute: number;
  sender: (mail: CodeMail, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  schedule?: (expire: () => void, ms: number) => () => void;
  nextId?: () => string;
  nextCode?: () => string;
}
/** 接受只表示进入队列，不透露账号存在性或发送结果；工作者另行发送。到期与冷却供客户端提示。 */
export type CodeAdmission = { challengeId: string; expiresAt: number; resendAfterMs: number } | { retryAfterMs: number };
/** 对外的发送进度：不区分失败与结果不明，二者都须重新申请。 */
export type CodeDelivery = 'pending' | 'sent' | 'retry';
/** 来源必须由可信入口根据连接生成 HMAC，不能直接取请求体的自称 IP。 */
export interface CodeRequest {
  email: string;
  purpose: CodePurpose;
  sourceHash: string;
}

/** 生产默认定时器；测试手动触发回调，不等待真实时间。 */
function schedule(expire: () => void, ms: number): () => void {
  const timer = setTimeout(expire, ms);
  return () => clearTimeout(timer);
}

/** 已超时任务即使迟到成功也不改变 unknown；错误对象不带出适配器。 */
async function send(mail: CodeMail, opt: EmailCodeOptions): Promise<'sent' | 'failed' | 'unknown'> {
  const controller = new AbortController();
  let cancel = () => {};
  const timeout = new Promise<'unknown'>(resolve => {
    cancel = (opt.schedule ?? schedule)(() => {
      resolve('unknown');
      controller.abort();
    }, CODE_SEND_TIMEOUT_MS);
  });
  try {
    const delivery = Promise.resolve()
      .then(() => opt.sender(mail, controller.signal))
      .then(
        () => 'sent' as const,
        () => 'failed' as const,
      );
    return await Promise.race([delivery, timeout]);
  } finally {
    cancel();
  }
}

/** 与账号使用同一 SQLite 连接；无真实适配器时只在测试中装配，不开放玩家入口。 */
export class EmailCodes {
  readonly repo: EmailChallengeRepo;
  private readonly limits: AuthLimitRepo;
  private readonly opt: EmailCodeOptions;

  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: EmailProtection,
    private readonly credentials: CodeCredentials,
    options: EmailCodeOptions,
  ) {
    if (!Number.isSafeInteger(options.globalPerMinute) || options.globalPerMinute < 1 || options.globalPerMinute > MAX_GLOBAL_BUDGET) {
      throw new Error('code-budget-invalid');
    }
    this.opt = { ...options };
    this.repo = new EmailChallengeRepo(db);
    this.limits = new AuthLimitRepo(db);
  }

  /** 限额按全局、来源、邮箱顺序扣取；后续拒绝也保留已扣额度，内部失败则整体回滚。 */
  request(input: CodeRequest): CodeAdmission {
    const email = normalizeEmail(input.email);
    if (!email || !HASH_FORMAT.test(input.sourceHash) || input.sourceHash.length !== HASH_LENGTH) throw new Error('code-input-invalid');
    const lookup = this.vault.lookup(email);
    if (!validCodeContext({ challengeId: '0'.repeat(CHALLENGE_ID_LENGTH), emailLookup: lookup, purpose: input.purpose })) throw new Error('code-input-invalid');
    const now = this.now();
    return transaction(this.db, () => {
      const global = this.limits.take({ scope: 'code-global', subject: GLOBAL_SUBJECT, max: this.opt.globalPerMinute, windowMs: CODE_GLOBAL_WINDOW_MS }, now);
      if (global) return { retryAfterMs: global };
      const source = this.limits.take({ scope: 'code-ip', subject: input.sourceHash, max: CODE_SOURCE_BUDGET, windowMs: CODE_SOURCE_WINDOW_MS }, now);
      if (source) return { retryAfterMs: source };
      const limited = this.limits.take(
        { scope: 'code-email', subject: lookup, max: CODE_EMAIL_BUDGET, windowMs: CODE_EMAIL_WINDOW_MS, cooldownMs: CODE_COOLDOWN_MS },
        now,
      );
      if (limited) return { retryAfterMs: limited };
      for (let attempt = 0; attempt < CODE_ID_ATTEMPTS; attempt++) {
        const context = { challengeId: (this.opt.nextId ?? newChallengeId)(), emailLookup: lookup, purpose: input.purpose };
        if (!validCodeContext(context)) throw new Error('code-random-invalid');
        const sealed = this.vault.seal(email, { purpose: 'challenge-email', recordId: context.challengeId });
        if (this.repo.queue({ ...context, email: sealed, now })) {
          return { challengeId: context.challengeId, expiresAt: now + CODE_TTL_MS, resendAfterMs: CODE_COOLDOWN_MS };
        }
      }
      throw new Error('code-id-exhausted');
    });
  }

  /** 工作者在接受响应后调用；同一挑战只能从 queued 开始一次，不持有跨网络事务。语言只随本次调用传递，不入库。 */
  async deliver(challengeId: string, language: MailLanguage = DEFAULT_MAIL_LANGUAGE): Promise<void> {
    if (this.db.isTransaction) throw new Error('code-not-committed');
    const mail = transaction(this.db, () => {
      const queued = this.repo.queued(challengeId, this.now());
      if (!queued) return undefined;
      const code = (this.opt.nextCode ?? newEmailCode)();
      const mac = this.credentials.mac(queued, code);
      const email = this.vault.open(queued.payload, { purpose: 'challenge-email', recordId: challengeId });
      if (!this.repo.start(challengeId, { mac, keyId: this.credentials.currentKeyId }, this.now())) return undefined;
      return { email, code, challengeId, purpose: queued.purpose, language };
    });
    if (!mail) return;
    const outcome = await send(mail, this.opt);
    let now: number | null = null;
    try {
      now = this.now();
    } finally {
      // 损坏时钟仍应结束发送并清机密，随后让原有时钟错误明确传出。
      this.repo.finish(challengeId, outcome, now);
    }
  }

  /** 可在昂贵派生前预检；成功不消费，最终写入前必须 consume。 */
  check(input: { challengeId: string; email: string; purpose: CodePurpose; code: string }): CodeProof | undefined {
    const email = normalizeEmail(input.email);
    if (!email) return undefined;
    const context = { challengeId: input.challengeId, purpose: input.purpose, emailLookup: this.vault.lookup(email) };
    if (!validCodeContext(context)) return undefined;
    return transaction(this.db, () => {
      const now = this.now();
      const stored = this.repo.ready(context, now);
      if (!stored) return undefined;
      if (!this.credentials.matches(context, input.code, stored)) {
        this.repo.wrong(context, now);
        return undefined;
      }
      return { ...context, mac: stored.mac };
    });
  }

  /** 只读查询当前挑战的发送进度，不改变状态与错误次数；已失效、用尽或不存在时为空。 */
  delivery(challengeId: string): { state: CodeDelivery; expiresAt: number } | undefined {
    const stored = this.repo.status(challengeId, this.now());
    if (!stored) return undefined;
    const state = DELIVERY[stored.state];
    return state ? { state, expiresAt: stored.expiresAt } : undefined;
  }

  /** 在注册或改密最终事务内再次校验并删除凭据；回滚时恢复未消费状态。 */
  consume(proof: CodeProof): boolean {
    if (!validCodeContext(proof) || !HASH_FORMAT.test(proof.mac) || proof.mac.length !== HASH_LENGTH) return false;
    return this.repo.consume(proof, this.now());
  }

  /** 使用注入时钟；拒绝损坏时间，不以系统时间偷偷替代。 */
  private now(): number {
    const now = (this.opt.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - CODE_EMAIL_WINDOW_MS) throw new Error('auth-clock-invalid');
    return now;
  }
}
