/** 邮箱挑战仓储：有条件的代际状态转换、错误计数及单次消费；不发送邮件。 */
import type { DatabaseSync } from 'node:sqlite';
import { CODE_ATTEMPTS, CODE_TTL_MS } from '../authPolicy';
import type { CodeContext } from '../codeCredentials';
import type { ProtectedEmail } from '../emailProtection';
import { transaction } from './transaction';

/** 仅在内部认证事务中传递，不能作为客户端声称已验证的凭据。 */
export interface CodeProof extends CodeContext {
  mac: string;
}
/** 待发送资料，只在发送边界解密；queued 行没有验证码凭据。 */
export interface QueuedCode extends CodeContext {
  payload: unknown;
}

/** 每次转换同时检查当前挑战与状态，迟到事件不能修改新一代。 */
function statements(db: DatabaseSync) {
  const erase = 'email_payload = NULL, code_mac = NULL, code_key_id = NULL';
  const live = 'is_current = 1 AND created_at <= $now AND expires_at > $now';
  const ready = `${live} AND state = 'sent' AND sent_at <= $now AND attempts < $attempts`;
  const same = 'challenge_id = $id AND email_lookup = $lookup AND purpose = $purpose';
  return {
    exists: db.prepare('SELECT 1 FROM email_challenges WHERE challenge_id = ?'),
    supersede: db.prepare(
      `UPDATE email_challenges SET state = 'superseded', is_current = 0, ${erase} WHERE email_lookup = ? AND purpose = ? AND is_current = 1`,
    ),
    queue: db.prepare(
      'INSERT INTO email_challenges (challenge_id, email_lookup, purpose, state, is_current, email_payload, created_at, expires_at) ' +
        "VALUES (?, ?, ?, 'queued', 1, ?, ?, ?)",
    ),
    queued: db.prepare(`SELECT * FROM email_challenges WHERE challenge_id = $id AND ${live} AND state = 'queued'`),
    start: db.prepare(
      `UPDATE email_challenges SET state = 'sending', code_mac = $mac, code_key_id = $key WHERE challenge_id = $id AND ${live} AND state = 'queued'`,
    ),
    finish: db.prepare(
      "UPDATE email_challenges SET state = CASE WHEN created_at <= $now AND expires_at > $now THEN $state ELSE 'unknown' END, " +
        "email_payload = NULL, code_mac = CASE WHEN $state = 'sent' AND created_at <= $now AND expires_at > $now THEN code_mac END, " +
        "code_key_id = CASE WHEN $state = 'sent' AND created_at <= $now AND expires_at > $now THEN code_key_id END, " +
        "sent_at = CASE WHEN $state = 'sent' AND created_at <= $now AND expires_at > $now THEN $now END " +
        "WHERE challenge_id = $id AND is_current = 1 AND state = 'sending'",
    ),
    status: db.prepare(`SELECT state, expires_at FROM email_challenges WHERE challenge_id = $id AND ${live} AND attempts < $attempts`),
    ready: db.prepare(`SELECT code_mac, code_key_id FROM email_challenges WHERE ${same} AND ${ready}`),
    wrong: db.prepare(`UPDATE email_challenges SET attempts = attempts + 1 WHERE ${same} AND ${ready}`),
    consume: db.prepare(`UPDATE email_challenges SET state = 'consumed', is_current = 0, ${erase} WHERE ${same} AND ${ready} AND code_mac = $mac`),
    recover: db.prepare(`UPDATE email_challenges SET state = 'unknown', ${erase} WHERE state = 'sending'`),
    prune: db.prepare('DELETE FROM email_challenges WHERE expires_at <= ?'),
  };
}

/** 仓储操作同步，可与账号写入组合为同一外层事务。 */
export class EmailChallengeRepo {
  private readonly sql;
  constructor(private readonly db: DatabaseSync) {
    this.sql = statements(db);
  }

  /** 编号碰撞不替换旧挑战；替换及入队在同一事务内。 */
  queue(input: CodeContext & { email: ProtectedEmail; now: number }): boolean {
    return transaction(this.db, () => {
      if (this.sql.exists.get(input.challengeId)) return false;
      this.sql.supersede.run(input.emailLookup, input.purpose);
      this.sql.queue.run(input.challengeId, input.emailLookup, input.purpose, JSON.stringify(input.email), input.now, input.now + CODE_TTL_MS);
      return true;
    });
  }

  /** 过期或已替换的任务不能开始发送。 */
  queued(id: string, now: number): QueuedCode | undefined {
    const row = this.sql.queued.get({ $id: id, $now: now });
    if (!row) return undefined;
    const purpose = row.purpose;
    if (purpose !== 'register' && purpose !== 'reset' && purpose !== 'change') throw new Error('code-state-invalid');
    return { challengeId: String(row.challenge_id), emailLookup: String(row.email_lookup), purpose, payload: JSON.parse(String(row.email_payload)) };
  }

  /** 凭据先落库再进入网络边界；不保存可还原验证码。 */
  start(id: string, credential: { mac: string; keyId: string }, now: number): boolean {
    return this.sql.start.run({ $id: id, $now: now, $mac: credential.mac, $key: credential.keyId }).changes === 1;
  }

  /** 当前发送必须落终态并清除机密；回退、到期或 null 时钟统一为 unknown。 */
  finish(id: string, state: 'sent' | 'unknown' | 'failed', now: number | null): void {
    this.sql.finish.run({ $id: id, $now: now, $state: state });
  }

  /** 当前且未用尽的挑战的状态与期限；不返回地址或凭据。 */
  status(id: string, now: number): { state: string; expiresAt: number } | undefined {
    const row = this.sql.status.get({ $id: id, $now: now, $attempts: CODE_ATTEMPTS });
    return row ? { state: String(row.state), expiresAt: Number(row.expires_at) } : undefined;
  }

  /** 不返回地址，核验仅需凭据；时钟倒退不把未来发送当作有效。 */
  ready(context: CodeContext, now: number): { mac: string; keyId: string } | undefined {
    const row = this.sql.ready.get(this.values(context, now));
    return row ? { mac: String(row.code_mac), keyId: String(row.code_key_id) } : undefined;
  }

  /** 更新本身带次数及有效性条件，不允许并发失败超出上限。 */
  wrong(context: CodeContext, now: number): void {
    this.sql.wrong.run(this.values(context, now));
  }

  /** 最终事务复查期限、次数、代际及 MAC；多个预检只能有一个消费成功。 */
  consume(proof: CodeProof, now: number): boolean {
    return this.sql.consume.run({ ...this.values(proof, now), $mac: proof.mac }).changes === 1;
  }

  /** 仅进程启动、工作者开始前调用；崩溃时发送结果不明，必须重新申请。 */
  recover(): number {
    return Number(this.sql.recover.run().changes);
  }

  /** 到期删除短期邮箱标识及凭据，独立的日限额记录不受影响。 */
  prune(now: number): number {
    return Number(this.sql.prune.run(now).changes);
  }

  /** 绑定字段始终参数化，避免同编号跨用途和邮箱核验。 */
  private values(context: CodeContext, now: number) {
    return { $id: context.challengeId, $lookup: context.emailLookup, $purpose: context.purpose, $now: now, $attempts: CODE_ATTEMPTS };
  }
}
