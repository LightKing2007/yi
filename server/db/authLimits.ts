/** 持久化认证限流：有界滑动窗口和账号锁定，仅保存带密钥标识及事件时刻（SEC-023、DAT-073）。 */
import type { DatabaseSync } from 'node:sqlite';
import { LOGIN_FAILURE_WINDOW_MS, LOGIN_FAILURES, LOGIN_LOCK_MS } from '../authPolicy';
import { transaction } from './transaction';

const MAX_EVENTS = 1000;
const MAX_WINDOW_MS = 86400000;
const SUBJECT_LENGTH = 64;
const SUBJECT_FORMAT = /^[0-9a-f]{64}$/;
/** 不同动作独立计数；邮箱、来源均由认证装配层提供 HMAC 标识，不能从请求体直接取。 */
export type AuthLimitScope = 'code-ip' | 'code-email' | 'code-global' | 'login-ip' | 'login-account';
/** 规模是资源边界或配置策略，不是吞吐量承诺；事件数组最多一千项。 */
export interface AuthLimitRule {
  scope: AuthLimitScope;
  subject: string;
  max: number;
  windowMs: number;
  cooldownMs?: number;
}
interface History {
  times: number[];
  blockedUntil: number;
}

/** 所有外部标识及时间在查询前校验，不保留原始邮箱或 IP。 */
function validate(subject: string, now: number): void {
  if (!SUBJECT_FORMAT.test(subject) || !Number.isSafeInteger(now) || now < 0) throw new Error('auth-limit-input-invalid');
}

/** 事件必须有界、单调且不在未来，不能用损坏历史获取新额度。 */
function validTimes(times: unknown[], now: number): times is number[] {
  if (times.length > MAX_EVENTS) return false;
  let previous = -1;
  for (const value of times) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > now || value < previous) return false;
    previous = value;
  }
  return true;
}

/** JSON 损坏、未来事件或超限数组一律拒绝，不当作空记录恢复限额。 */
function history(row: Record<string, unknown> | undefined, now: number, windowMs: number): History {
  if (!row) return { times: [], blockedUntil: 0 };
  try {
    const data: unknown = JSON.parse(String(row.history));
    if (!data || typeof data !== 'object' || !('v' in data) || data.v !== 1 || !('times' in data) || !Array.isArray(data.times)) throw new Error();
    const times: unknown[] = data.times;
    if (!validTimes(times, now) || Number(row.updated_at) > now) throw new Error();
    return { times: times.filter(time => time > now - windowMs), blockedUntil: Number(row.blocked_until_at) };
  } catch {
    // 仅产生内部标识，不在异常中携带限流标识或原始 JSON。
    throw new Error('auth-limit-state-invalid');
  }
}

/** 与请求状态在同一外层事务中使用；被拒绝的请求不延长现有窗口或锁定。 */
export class AuthLimitRepo {
  private readonly get;
  private readonly put;
  private readonly remove;
  private readonly cleanup;

  constructor(private readonly db: DatabaseSync) {
    this.get = db.prepare('SELECT history, blocked_until_at, updated_at FROM auth_limits WHERE scope = ? AND subject_hash = ?');
    this.put = db.prepare(
      'INSERT INTO auth_limits (scope, subject_hash, history, blocked_until_at, updated_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (scope, subject_hash) DO UPDATE SET history = excluded.history, ' +
        'blocked_until_at = excluded.blocked_until_at, updated_at = excluded.updated_at',
    );
    this.remove = db.prepare('DELETE FROM auth_limits WHERE scope = ? AND subject_hash = ?');
    this.cleanup = db.prepare('DELETE FROM auth_limits WHERE updated_at <= ? AND blocked_until_at <= ?');
  }

  /** 返回零表示接受，正数表示距离可重试还剩的毫秒；预算包含发送失败的已接受申请。 */
  take(rule: AuthLimitRule, now: number): number {
    validate(rule.subject, now);
    const cooldown = rule.cooldownMs ?? 0;
    if (
      !Number.isSafeInteger(rule.max) ||
      rule.max < 1 ||
      rule.max > MAX_EVENTS ||
      !Number.isSafeInteger(rule.windowMs) ||
      rule.windowMs < 1 ||
      rule.windowMs > MAX_WINDOW_MS ||
      !Number.isSafeInteger(cooldown) ||
      cooldown < 0 ||
      cooldown > rule.windowMs
    ) {
      throw new Error('auth-limit-rule-invalid');
    }
    return transaction(this.db, () => {
      const state = history(this.get.get(rule.scope, rule.subject), now, rule.windowMs);
      const quota = state.times.length >= rule.max ? (state.times[0] ?? now) + rule.windowMs - now : 0;
      const last = state.times.at(-1);
      const cooling = last === undefined ? 0 : last + cooldown - now;
      const retry = Math.max(0, state.blockedUntil - now, quota, cooling);
      if (retry) return retry;
      state.times.push(now);
      this.write(rule.scope, rule.subject, { times: state.times, blockedUntil: 0 }, now);
      return 0;
    });
  }

  /** 账号尝试在昂贵密码校验之前读取锁定，不能用成功口令绕过仍有效的锁定。 */
  blocked(subject: string, now: number): number {
    validate(subject, now);
    const state = history(this.get.get('login-account', subject), now, LOGIN_FAILURE_WINDOW_MS);
    return Math.max(0, state.blockedUntil - now);
  }

  /** 一次失败只记一次；第五次触发锁定，已锁定时不追加或延长。 */
  failure(subject: string, now: number): number {
    validate(subject, now);
    return transaction(this.db, () => {
      const state = history(this.get.get('login-account', subject), now, LOGIN_FAILURE_WINDOW_MS);
      if (state.blockedUntil > now) return state.blockedUntil - now;
      state.times.push(now);
      const until = state.times.length >= LOGIN_FAILURES ? now + LOGIN_LOCK_MS : 0;
      this.write('login-account', subject, { times: state.times.slice(-LOGIN_FAILURES), blockedUntil: until }, now);
      return Math.max(0, until - now);
    });
  }

  /** 登录成功仅清除该账号失败记录，不清除 IP 或发信计数。 */
  clearFailures(subject: string): void {
    validate(subject, 0);
    this.remove.run('login-account', subject);
  }

  /** 最长一天无活动且已无锁定的记录可以清理，过期验证码不会重置日限额。 */
  prune(now: number): number {
    validate('0'.repeat(SUBJECT_LENGTH), now);
    return Number(this.cleanup.run(now - MAX_WINDOW_MS, now).changes);
  }

  /** 只持久化版本化的有界数组，不保存用户输入内容（DAT-024）。 */
  private write(scope: AuthLimitScope, subject: string, state: History, now: number): void {
    this.put.run(scope, subject, JSON.stringify({ v: 1, times: state.times }), state.blockedUntil, now);
  }
}
