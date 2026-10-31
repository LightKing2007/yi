/** 账号仓储的真实 SQLite 事务、唯一约束和加密归属；固定时钟与可控 UID，不连接外网。 */
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase, MEMORY } from '../server/db';
import { AccountRepo, type NewAccount } from '../server/db/accounts';
import { EmailProtection } from '../server/emailProtection';

const NOW = 123456789;
const HASH = `scrypt$131072$8$1$${'01'.repeat(16)}$${'02'.repeat(64)}`;
const vault = new EmailProtection({ currentKeyId: 'test', encryption: new Map([['test', Buffer.alloc(32, 1)]]), lookup: Buffer.alloc(32, 2) });
const address = 'player@example.com';
let db: DatabaseSync;
const input = (email = address): NewAccount => ({
  name: '同名棋友',
  emailLookup: vault.lookup(email),
  passwordHash: HASH,
  now: NOW,
  consents: [{ kind: 'privacy', version: 'v1' }],
});
const seal = (id: number) => vault.seal(address, { purpose: 'account-email', recordId: String(id) });
const count = (table: 'users' | 'accounts' | 'consents') => Number(db.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total);

beforeEach(() => {
  db = openDatabase(MEMORY, { now: () => NOW, appVersion: '3.1.0' });
});
afterEach(() => db.close());

it('账号与协议同意原子写入，密文绑定内部用户且雅号允许重名', () => {
  let next = 0;
  const repo = new AccountRepo(db, () => ['7KM4P9D2', '00000000'][next++] ?? '00000000');
  const one = repo.create(input(), seal);
  const two = repo.create(input('other@example.com'), seal);
  expect(one.name).toBe(two.name);
  expect(one.userId).not.toBe(two.userId);
  expect(repo.byEmailLookup(vault.lookup(address))).toEqual(one);
  expect(repo.byPublicId('7km4-p9d2')).toEqual(one);
  expect(repo.byUserId(one.userId)).toEqual(one);
  expect(repo.byPublicId('7KM4P9D3')).toBeUndefined();
  expect(vault.open(one.email, { purpose: 'account-email', recordId: String(one.userId) })).toBe(address);
  expect(() => vault.open(one.email, { purpose: 'account-email', recordId: String(two.userId) })).toThrow();
  expect(db.prepare('SELECT kind FROM users WHERE id = ?').get(one.userId)?.kind).toBe('member');
  expect(db.prepare('SELECT kind, document_version, consented_at FROM consents WHERE user_id = ?').all(one.userId)).toEqual([
    { kind: 'privacy', document_version: 'v1', consented_at: NOW },
  ]);
  expect(JSON.stringify(db.prepare('SELECT * FROM accounts').all())).not.toContain(address);
});

it('重复邮箱在事务内拒绝且不遗留额外用户', () => {
  const repo = new AccountRepo(db, () => '7KM4P9D2');
  repo.create(input(), seal);
  expect(() => repo.create(input(), seal)).toThrow('account-email-taken');
  expect([count('users'), count('accounts'), count('consents')]).toEqual([1, 1, 1]);
});

it('加密或协议写入失败均回滚整个注册，缺少隐私同意不创建用户', () => {
  const repo = new AccountRepo(db, () => '7KM4P9D2');
  expect(() =>
    repo.create(input(), () => {
      throw new Error('fake-encryption-failed');
    }),
  ).toThrow('fake-encryption-failed');
  const duplicated = { ...input(), consents: [...input().consents, ...input().consents] };
  expect(() => repo.create(duplicated, seal)).toThrow();
  expect(() => repo.create({ ...input(), consents: [] }, seal)).toThrow('account-privacy-required');
  expect([count('users'), count('accounts'), count('consents')]).toEqual([0, 0, 0]);
});

it('UID 碰撞后重试，重试耗尽或生成非法 UID 时不创建用户', () => {
  new AccountRepo(db, () => '7KM4P9D2').create(input(), seal);
  let calls = 0;
  const repo = new AccountRepo(db, () => (++calls === 1 ? '7KM4P9D2' : '00000000'));
  expect(repo.create(input('second@example.com'), seal).publicId).toBe('00000000');
  expect(calls).toBe(2);
  calls = 0;
  expect(() =>
    new AccountRepo(db, () => {
      calls++;
      return '7KM4P9D2';
    }).create(input('third@example.com'), seal),
  ).toThrow('account-public-id-exhausted');
  expect(calls).toBe(5);
  expect(() => new AccountRepo(db, () => 'invalid').create(input('third@example.com'), seal)).toThrow('account-public-id-invalid');
  expect(count('users')).toBe(2);
});

it('数据库强制邮箱与 UID 唯一并阻止修改 UID，错误口令格式拒绝', () => {
  const repo = new AccountRepo(db, () => '7KM4P9D2');
  const one = repo.create(input(), seal);
  expect(() => db.prepare('UPDATE accounts SET public_id = ? WHERE user_id = ?').run('00000000', one.userId)).toThrow('public-id-immutable');
  expect(() => db.prepare('UPDATE accounts SET pass_hash = ? WHERE user_id = ?').run('plaintext-password', one.userId)).toThrow();
  const other = new AccountRepo(db, () => '00000000').create(input('second@example.com'), seal);
  expect(() => db.prepare('UPDATE accounts SET email_lookup = ? WHERE user_id = ?').run(one.emailLookup, other.userId)).toThrow(
    /UNIQUE constraint failed: accounts.email_lookup/,
  );
  const third = db.prepare("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('member', 'third', ?, ?)").run(NOW, NOW).lastInsertRowid;
  expect(() =>
    db
      .prepare(
        'INSERT INTO accounts (user_id, public_id, email_version, email_key_id, email_nonce, email_tag, ' +
          'email_cipher, email_lookup, email_verified_at, pass_hash, created_at) SELECT ?, public_id, email_version, email_key_id, ' +
          'email_nonce, email_tag, email_cipher, ?, email_verified_at, pass_hash, created_at FROM accounts WHERE user_id = ?',
      )
      .run(third, vault.lookup('third@example.com'), one.userId),
  ).toThrow(/UNIQUE constraint failed: accounts.public_id/);
  expect(repo.byUserId(one.userId)?.publicId).toBe('7KM4P9D2');
});

it('已注销账号不参与认证查询且 UID 不得再次发放', () => {
  const repo = new AccountRepo(db, () => '7KM4P9D2');
  const one = repo.create(input(), seal);
  db.prepare(
    "UPDATE accounts SET status = 'closed', email_version = NULL, email_key_id = NULL, email_nonce = NULL, email_tag = NULL, " +
      'email_cipher = NULL, email_lookup = NULL, email_verified_at = NULL, pass_hash = NULL, closed_at = ? WHERE user_id = ?',
  ).run(NOW, one.userId);
  expect(repo.byUserId(one.userId)).toBeUndefined();
  expect(repo.byPublicId(one.publicId)).toBeUndefined();
  expect(repo.byEmailLookup(one.emailLookup)).toBeUndefined();
  expect(() => repo.create(input(), seal)).toThrow('account-public-id-exhausted');
});

it('修改雅号只写活动账号，已注销账号与游客不改', () => {
  const repo = new AccountRepo(db, () => '7KM4P9D2');
  const stored = repo.create(input(), seal);
  expect(repo.rename(stored.userId, '新雅号')).toBe(true);
  expect(db.prepare('SELECT name FROM users WHERE id = ?').get(stored.userId)?.name).toBe('新雅号');
  db.prepare(
    "UPDATE accounts SET status = 'closed', email_version = NULL, email_key_id = NULL, email_nonce = NULL, email_tag = NULL, email_cipher = NULL, " +
      'email_lookup = NULL, email_verified_at = NULL, pass_hash = NULL, closed_at = ? WHERE user_id = ?',
  ).run(NOW, stored.userId);
  expect(repo.rename(stored.userId, '注销后')).toBe(false);
  const guest = Number(db.prepare("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('guest', '游客', ?, ?)").run(NOW, NOW).lastInsertRowid);
  expect(repo.rename(guest, '冒名')).toBe(false);
  expect(
    db
      .prepare('SELECT name FROM users WHERE id IN (?, ?) ORDER BY id')
      .all(stored.userId, guest)
      .map(row => row.name),
  ).toEqual(['新雅号', '游客']);
});
