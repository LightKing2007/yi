/** 登录会话的真实数据库与假时钟验证；绝对期限、闲置边界和撤销不依赖执行速度。 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SESSION_IDLE_MS, SESSION_LIFETIME_MS } from '../server/authPolicy';
import { LoginSessions } from '../server/loginSessions';
import { transaction } from '../server/db/transaction';
import { AuthWorld, AUTH_TEST_HASH, AUTH_CHANGED_HASH } from './authWorld';

let world: AuthWorld;
beforeEach(() => {
  world = new AuthWorld();
});
afterEach(() => world.close());
const rowCount = () => Number(world.db.prepare('SELECT count(*) AS total FROM sessions').get()?.total);

it('令牌只保存独立 SHA-256 答案，授权不返回凭据且坏令牌拒绝', () => {
  const issued = world.sessions.issue(world.user);
  expect(issued.token).toBe('0'.repeat(31) + '1');
  const stored = world.db.prepare('SELECT * FROM sessions').get();
  // Python hashlib.sha256(('0'*31+'1').encode()).hexdigest() 的独立结果。
  expect(stored?.token_hash).toBe('e0cca2965509df678c8064f5e0b9076016fa752f88a6c749768db83479450cc5');
  expect(JSON.stringify(stored)).not.toContain(issued.token);
  expect(world.sessions.authorize(issued.token)).toEqual({ id: 1, userId: world.user.userId, authVersion: 1, expiresAt: issued.expiresAt });
  for (const bad of [undefined, '', 'A'.repeat(32), '0'.repeat(32), issued.token + '\n']) expect(world.sessions.authorize(bad)).toBeUndefined();
  const real = new LoginSessions(world.repo, { now: () => world.now }).issue(world.user);
  expect(real.token).toMatch(/^[0-9a-f]{32}$/);
  expect(world.sessions.authorize(real.token)?.userId).toBe(world.user.userId);
});

it('活动只能更新闲置时刻，绝对到期边界不能续活', () => {
  const created = world.now;
  const issued = world.sessions.issue(world.user);
  const day = SESSION_LIFETIME_MS / 30;
  for (const days of [6, 12, 18, 24, 29]) {
    world.now = created + days * day;
    expect(world.sessions.authorize(issued.token)?.expiresAt).toBe(created + SESSION_LIFETIME_MS);
  }
  world.now = issued.expiresAt - 1;
  expect(world.sessions.authorize(issued.token)).toBeDefined();
  world.now++;
  expect(world.sessions.authorize(issued.token, false)).toBeUndefined();
  expect(world.sessions.authorize(issued.token)).toBeUndefined();
  expect(world.db.prepare('SELECT last_seen_at FROM sessions').get()?.last_seen_at).toBe(issued.expiresAt - 1);
});

it('只读授权不续活，闲置到期边界及时间倒退均拒绝', () => {
  const created = world.now;
  const issued = world.sessions.issue(world.user);
  world.now = created - 1;
  expect(world.sessions.authorize(issued.token)).toBeUndefined();
  world.now = created + 2;
  expect(world.sessions.authorize(issued.token)).toBeDefined();
  world.now = created + 1;
  expect(world.sessions.authorize(issued.token)).toBeUndefined();
  world.now = created + 2 + SESSION_IDLE_MS - 1;
  expect(world.sessions.authorize(issued.token, false)).toBeDefined();
  world.now++;
  expect(world.sessions.authorize(issued.token)).toBeUndefined();
  expect(world.db.prepare('SELECT last_seen_at FROM sessions').get()?.last_seen_at).toBe(created + 2);
});

it('退出只撤销当前会话，撤销全部不影响其他账号并发送提交后的非机密通知', () => {
  const other = world.account('other@example.com');
  const first = world.sessions.issue(world.user),
    second = world.sessions.issue(world.user),
    third = world.sessions.issue(other);
  const id = world.sessions.authorize(first.token)?.id;
  transaction(world.db, () => {
    expect(() => world.sessions.logout(first.token)).toThrow('session-not-committed');
    expect(() => world.sessions.revokeUser(world.user.userId)).toThrow('session-not-committed');
    expect(world.events).toEqual([]);
  });
  world.sessions.logout(first.token);
  world.sessions.logout(first.token);
  world.sessions.logout(null);
  expect(world.sessions.authorize(first.token)).toBeUndefined();
  expect(world.sessions.authorize(second.token)).toBeDefined();
  expect(world.events).toEqual([{ userId: world.user.userId, sessionId: id }]);
  expect(world.sessions.revokeUser(world.user.userId)).toBe(true);
  expect(world.sessions.authorize(second.token)).toBeUndefined();
  expect(world.sessions.authorize(third.token)).toBeDefined();
  expect(world.events.at(-1)).toEqual({ userId: world.user.userId });
  expect(world.accounts.byUserId(world.user.userId)?.authVersion).toBe(2);
});

it('账号关闭后旧会话不能授权或继续签发', () => {
  const issued = world.sessions.issue(world.user);
  world.db
    .prepare(
      "UPDATE accounts SET status = 'closed', email_version = NULL, email_key_id = NULL, email_nonce = NULL, email_tag = NULL, " +
        'email_cipher = NULL, email_lookup = NULL, email_verified_at = NULL, pass_hash = NULL, closed_at = ? WHERE user_id = ?',
    )
    .run(world.now, world.user.userId);
  expect(world.sessions.authorize(issued.token)).toBeUndefined();
  expect(() => world.sessions.issue(world.user)).toThrow('session-issue-rejected');
});

it('改密与全部会话撤销原子提交，旧世代不能再签发且失败不半更新', () => {
  const issued = world.sessions.issue(world.user);
  expect(() => world.repo.changePassword(world.user.userId, 1, 'plaintext')).toThrow();
  expect(world.sessions.authorize(issued.token)).toBeDefined();
  expect(world.repo.changePassword(world.user.userId, 2, AUTH_CHANGED_HASH)).toBe(false);
  expect(world.accounts.byUserId(world.user.userId)?.passwordHash).toBe(AUTH_TEST_HASH);
  expect(() =>
    transaction(world.db, () => {
      expect(world.repo.changePassword(world.user.userId, 1, AUTH_CHANGED_HASH)).toBe(true);
      throw new Error('abort-outer');
    }),
  ).toThrow('abort-outer');
  expect(world.sessions.authorize(issued.token)).toBeDefined();
  expect(world.repo.changePassword(world.user.userId, 1, AUTH_CHANGED_HASH)).toBe(true);
  expect(world.accounts.byUserId(world.user.userId)).toMatchObject({ passwordHash: AUTH_CHANGED_HASH, authVersion: 2 });
  expect(world.sessions.authorize(issued.token)).toBeUndefined();
  expect(rowCount()).toBe(0);
  expect(() => world.sessions.issue(world.user)).toThrow('session-issue-rejected');
});

it('签发碰撞有界重试，非法随机源与损坏时钟明确拒绝', () => {
  const issued = world.sessions.issue(world.user);
  let calls = 0;
  const colliding = new LoginSessions(world.repo, {
    now: () => world.now,
    mint: () => {
      calls++;
      return issued.token;
    },
  });
  expect(() => colliding.issue(world.user)).toThrow('session-issue-rejected');
  expect(calls).toBe(5);
  expect(rowCount()).toBe(1);
  expect(() => new LoginSessions(world.repo, { mint: () => 'bad' }).issue(world.user)).toThrow('session-random-invalid');
  expect(() => new LoginSessions(world.repo, { now: () => NaN }).issue(world.user)).toThrow('auth-clock-invalid');
});

it('清理只删除到期会话，活跃会话仍可授权', () => {
  const expired = world.sessions.issue(world.user);
  world.now += SESSION_IDLE_MS;
  const fresh = world.sessions.issue(world.user);
  expect(world.repo.prune(world.now)).toBe(1);
  expect(rowCount()).toBe(1);
  expect(world.sessions.authorize(expired.token)).toBeUndefined();
  expect(world.sessions.authorize(fresh.token)).toBeDefined();
});
