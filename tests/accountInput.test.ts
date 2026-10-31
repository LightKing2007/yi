/** 雅号、密码与协议版本边界：固定 Unicode 和真实 SQLite，无网络或耗时断言。 */
import { afterEach, expect, it } from 'vitest';
import { accountName, accountPassword } from '../server/accountInput';
import { ConsentRepo } from '../server/db/consents';
import { transaction } from '../server/db/transaction';
import { AuthWorld } from './authWorld';

const worlds: AuthWorld[] = [];
const world = () => {
  const value = new AuthWorld();
  worlds.push(value);
  return value;
};
const REQUIRED = { privacy: 'v1', terms: 'v1' };
const ACCEPTED = { ...REQUIRED, accepted: true };
afterEach(() => {
  for (const value of worlds.splice(0)) value.close();
});

it('雅号按 NFC、字素及 UTF-8 字节校验，拒绝控制和格式字符', () => {
  expect(accountName('  e\u0301棋友  ')).toBe('é棋友');
  expect(accountName('棋'.repeat(16))).toBe('棋'.repeat(16));
  expect(accountName('🇨🇳'.repeat(8))).toBe('🇨🇳'.repeat(8));
  for (const name of [null, '', ' ', '棋'.repeat(17), '🇨🇳'.repeat(9), 'a'.repeat(257), '棋\n友', '\u202e棋友', '\u200d棋友', '\ud800']) {
    expect(accountName(name)).toBeUndefined();
  }
});

it('密码原文不修剪或规范化，新口令最少八码点，所有入口有字节及编码上限', () => {
  const raw = '  e\u0301密碼🙂  ';
  expect(accountPassword(raw, true)).toBe(raw);
  expect(accountPassword('a'.repeat(1024), true)).toHaveLength(1024);
  expect(accountPassword('旧口令')).toBe('旧口令');
  expect(accountPassword('a'.repeat(7), true)).toBeUndefined();
  for (const password of [null, '', 'a'.repeat(1025), '\ud800']) expect(accountPassword(password)).toBeUndefined();
});

it('同意必须明确且匹配服务端两份版本，重复接受不覆盖首次时刻', () => {
  const ctx = world();
  const repo = new ConsentRepo(ctx.db, REQUIRED);
  expect(repo.current(ctx.user.userId, ctx.now)).toBe(false);
  for (const value of [null, {}, REQUIRED, { ...ACCEPTED, accepted: false }, { ...ACCEPTED, privacy: 'old' }, { ...ACCEPTED, terms: 'old' }]) {
    expect(repo.accept(ctx.user.userId, value, ctx.now)).toBe(false);
  }
  expect(repo.accept(ctx.user.userId, ACCEPTED, ctx.now)).toBe(true);
  expect(repo.current(ctx.user.userId, ctx.now)).toBe(true);
  expect(repo.accept(ctx.user.userId, ACCEPTED, ctx.now + 1)).toBe(true);
  expect(ctx.db.prepare('SELECT consented_at FROM consents WHERE user_id = ?').all(ctx.user.userId)).toEqual([
    { consented_at: ctx.now },
    { consented_at: ctx.now },
  ]);
});

it('协议升级、未来同意和无效账号不满足要求，外层回滚不留下新版本', () => {
  const ctx = world();
  const repo = new ConsentRepo(ctx.db, { ...REQUIRED, privacy: 'v2' });
  const accepted = { ...ACCEPTED, privacy: 'v2' };
  expect(repo.current(ctx.user.userId, ctx.now)).toBe(false);
  expect(repo.accept(999, accepted, ctx.now)).toBe(false);
  expect(repo.accept(ctx.user.userId, accepted, ctx.now - 1)).toBe(false);
  expect(() =>
    transaction(ctx.db, () => {
      repo.accept(ctx.user.userId, accepted, ctx.now);
      throw new Error('later-write');
    }),
  ).toThrow('later-write');
  expect(repo.current(ctx.user.userId, ctx.now)).toBe(false);
  expect(repo.accept(ctx.user.userId, accepted, ctx.now)).toBe(true);
  expect(repo.current(ctx.user.userId, ctx.now - 1)).toBe(false);
  expect(repo.current(ctx.user.userId, ctx.now)).toBe(true);
});

it('协议配置采用不可变快照，非法版本和损坏时钟明确拒绝', () => {
  const ctx = world();
  const required = { ...REQUIRED };
  const repo = new ConsentRepo(ctx.db, required);
  required.privacy = 'changed';
  expect(repo.acceptance(ACCEPTED)).toHaveLength(2);
  for (const version of ['', 'x'.repeat(65), 'v1\n', 'v 1'])
    expect(() => new ConsentRepo(ctx.db, { ...REQUIRED, privacy: version })).toThrow('consent-policy-invalid');
  expect(() => repo.current(ctx.user.userId, NaN)).toThrow('auth-clock-invalid');
  expect(() => repo.accept(ctx.user.userId, ACCEPTED, -1)).toThrow('auth-clock-invalid');
});
