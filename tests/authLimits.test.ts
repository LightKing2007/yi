/** 认证限流的真实 SQLite 和固定时钟验证：滚动窗口、冷却、锁定及损坏数据均不能绕过。 */
import { beforeEach, afterEach, expect, it } from 'vitest';
import { AuthLimitRepo, type AuthLimitRule } from '../server/db/authLimits';
import { LOGIN_LOCK_MS, LOGIN_FAILURE_WINDOW_MS } from '../server/authPolicy';
import { transaction } from '../server/db/transaction';
import { AuthWorld } from './authWorld';

let world: AuthWorld;
let limits: AuthLimitRepo;
const subject = 'a'.repeat(64),
  other = 'b'.repeat(64);
const rule: AuthLimitRule = { scope: 'code-email', subject, max: 3, windowMs: 100, cooldownMs: 10 };
beforeEach(() => {
  world = new AuthWorld();
  limits = new AuthLimitRepo(world.db);
});
afterEach(() => world.close());

it('滚动窗口和冷却的边界精确生效，被拒绝时不延长窗口', () => {
  const start = world.now;
  expect(limits.take(rule, start)).toBe(0);
  const before = world.db.prepare('SELECT history, updated_at FROM auth_limits').get();
  expect(limits.take(rule, start + 9)).toBe(1);
  expect(world.db.prepare('SELECT history, updated_at FROM auth_limits').get()).toEqual(before);
  expect(limits.take(rule, start + 10)).toBe(0);
  expect(limits.take(rule, start + 20)).toBe(0);
  expect(limits.take(rule, start + 21)).toBe(79);
  expect(limits.take(rule, start + 99)).toBe(1);
  expect(limits.take(rule, start + 100)).toBe(0);
  expect(limits.take(rule, start + 101)).toBe(9);
});

it('动作和主体相互隔离，外层事务失败不留下部分计数', () => {
  expect(limits.take({ ...rule, max: 1 }, world.now)).toBe(0);
  expect(limits.take({ ...rule, subject: other }, world.now)).toBe(0);
  expect(limits.take({ ...rule, scope: 'code-ip' }, world.now)).toBe(0);
  expect(() =>
    transaction(world.db, () => {
      expect(limits.take({ ...rule, scope: 'code-global' }, world.now)).toBe(0);
      throw new Error('abort-all');
    }),
  ).toThrow('abort-all');
  expect(limits.take({ ...rule, scope: 'code-global' }, world.now)).toBe(0);
  expect(limits.take({ ...rule, max: 1 }, world.now)).toBe(100);
});

it('同账号十五分钟五次失败锁十五分钟，重试不延长且成功仅清账号计数', () => {
  expect(LOGIN_LOCK_MS).toBe(900000);
  expect(LOGIN_FAILURE_WINDOW_MS).toBe(900000);
  for (let i = 0; i < 4; i++) expect(limits.failure(subject, world.now + i)).toBe(0);
  expect(limits.failure(subject, world.now + 4)).toBe(900000);
  expect(limits.blocked(subject, world.now + 5)).toBe(899999);
  expect(limits.failure(subject, world.now + 5)).toBe(899999);
  world.now += 4 + LOGIN_LOCK_MS;
  expect(limits.blocked(subject, world.now)).toBe(0);
  expect(limits.failure(subject, world.now)).toBe(0);
  for (let i = 0; i < 5; i++) limits.failure(other, world.now);
  limits.take({ scope: 'login-ip', subject: other, max: 1, windowMs: 1000 }, world.now);
  limits.clearFailures(other);
  expect(limits.blocked(other, world.now)).toBe(0);
  expect(limits.take({ scope: 'login-ip', subject: other, max: 1, windowMs: 1000 }, world.now)).toBe(1000);
});

it('非法策略、来源标识、未来时钟与损坏历史都明确拒绝而不重置额度', () => {
  for (const changed of [{ max: 0 }, { max: 1001 }, { windowMs: 0 }, { windowMs: 86400001 }, { cooldownMs: -1 }, { cooldownMs: 101 }]) {
    expect(() => limits.take({ ...rule, ...changed }, world.now)).toThrow('auth-limit-rule-invalid');
  }
  expect(() => limits.take({ ...rule, subject: 'raw@example.com' }, world.now)).toThrow('auth-limit-input-invalid');
  expect(() => limits.take(rule, NaN)).toThrow('auth-limit-input-invalid');
  limits.take(rule, world.now);
  expect(() => limits.take(rule, world.now - 1)).toThrow('auth-limit-state-invalid');
  expect(() => world.db.prepare('UPDATE auth_limits SET history = ?').run('{"times":[]}')).toThrow();
  world.db.prepare('UPDATE auth_limits SET history = ?').run('{"v":1,"times":["bad"]}');
  expect(() => limits.take(rule, world.now)).toThrow('auth-limit-state-invalid');
});

it('过期清理不删除仍活跃的计数', () => {
  limits.take(rule, world.now);
  world.now += 86400000;
  limits.take({ ...rule, subject: other }, world.now);
  expect(limits.prune(world.now)).toBe(1);
  expect(limits.take({ ...rule, subject: other }, world.now)).toBe(10);
});

it('事件数组有界，超限申请不扩大持久化记录', () => {
  const large: AuthLimitRule = { scope: 'code-global', subject, max: 1000, windowMs: 1000 };
  for (let i = 0; i < 1000; i++) expect(limits.take(large, world.now)).toBe(0);
  expect(limits.take(large, world.now)).toBe(1000);
  const row = world.db.prepare('SELECT history FROM auth_limits').get();
  expect(JSON.parse(String(row?.history)).times).toHaveLength(1000);
}, 10000);

it('配额与冷却同时阻止时等待较晚期限，按提示重试即可成功', () => {
  const combined = { ...rule, max: 2, cooldownMs: 90 };
  expect(limits.take(combined, 1000)).toBe(0);
  expect(limits.take(combined, 1090)).toBe(0);
  const before = world.db.prepare('SELECT history, updated_at FROM auth_limits').get();
  expect(limits.take(combined, 1091)).toBe(89);
  expect(limits.take(combined, 1100)).toBe(80);
  expect(limits.take(combined, 1179)).toBe(1);
  expect(world.db.prepare('SELECT history, updated_at FROM auth_limits').get()).toEqual(before);
  expect(limits.take(combined, 1180)).toBe(0);
});
