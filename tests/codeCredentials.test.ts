/** 邮箱规范化与验证码凭据：固定假密钥、独立答案和真实随机源，不连接邮件服务。 */
import { randomBytes, randomInt } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { CodeCredentials, newChallengeId, newEmailCode, type CodeContext } from '../server/codeCredentials';
import { normalizeEmail } from '../server/emailAddress';

const context: CodeContext = { challengeId: '01'.repeat(16), emailLookup: '02'.repeat(32), purpose: 'register' };
const keyring = () => ({ currentKeyId: 'one', keys: new Map([['one', Buffer.alloc(32, 3)]]) });

vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes), randomInt: vi.fn(actual.randomInt) };
});

it('邮箱别名规范化一致，保留加号和点并支持 IDNA 域名', () => {
  expect(normalizeEmail(' Player.Name+Tag@EXAMPLE.COM ')).toBe('player.name+tag@example.com');
  expect(normalizeEmail('A@例子.测试')).toBe('a@xn--fsqu00a.xn--0zwm56d');
  expect(normalizeEmail('a@e\u0301xample.com')).toBe(normalizeEmail('A@éxample.com'));
});

it('邮箱拒绝注入、损坏 Unicode、非法语法和字节越界', () => {
  for (const value of [
    null,
    '',
    'a@b',
    'a@b..com',
    'a@-b.com',
    'a@b-.com',
    '.a@b.com',
    'a.@b.com',
    'a..b@c.com',
    'a@@b.com',
    'a b@c.com',
    '"a"@b.com',
    'é@b.com',
    'a@b.com\r\n',
    '\ud800@b.com',
    `${'a'.repeat(65)}@b.com`,
    `a@${'b'.repeat(64)}.com`,
    'a'.repeat(1025),
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`,
  ])
    expect(normalizeEmail(value)).toBeUndefined();
  expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`)).toHaveLength(254);
});

it('验证码 HMAC 符合独立答案并绑定编号、邮箱、用途和原文', () => {
  const credentials = new CodeCredentials(keyring());
  const mac = credentials.mac(context, '001234');
  expect(mac).toBe('e3cbd46b3bc7ad791e47cc1c472da4937c44ca81ae899d6fdea8950ab72ac57c');
  expect(credentials.matches(context, '001234', { mac, keyId: 'one' })).toBe(true);
  for (const changed of [
    { ...context, challengeId: '02'.repeat(16) },
    { ...context, emailLookup: '03'.repeat(32) },
    { ...context, purpose: 'reset' as const },
  ]) {
    expect(credentials.matches(changed, '001234', { mac, keyId: 'one' })).toBe(false);
  }
  expect(credentials.matches(context, '001235', { mac, keyId: 'one' })).toBe(false);
});

it('验证码密钥支持轮换并复制快照，缺失旧密钥不能回退', () => {
  const ring = keyring();
  const before = new CodeCredentials(ring);
  const mac = before.mac(context, '001234');
  ring.keys.get('one')?.fill(0);
  expect(before.mac(context, '001234')).toBe(mac);
  const after = new CodeCredentials({
    currentKeyId: 'two',
    keys: new Map([
      ['one', Buffer.alloc(32, 3)],
      ['two', Buffer.alloc(32, 4)],
    ]),
  });
  expect(after.matches(context, '001234', { mac, keyId: 'one' })).toBe(true);
  expect(after.mac(context, '001234')).not.toBe(mac);
  expect(() => before.matches(context, '001234', { mac, keyId: 'two' })).toThrow('code-key-unavailable');
});

it('验证码拒绝非法密钥、上下文、编码及长度', () => {
  for (const ring of [
    { ...keyring(), currentKeyId: 'absent' },
    { ...keyring(), currentKeyId: 'one\n' },
    { currentKeyId: 'one', keys: new Map([['one', Buffer.alloc(1)]]) },
    { currentKeyId: 'one\n', keys: new Map([['one\n', Buffer.alloc(32)]]) },
  ])
    expect(() => new CodeCredentials(ring)).toThrow('code-keyring-invalid');
  const credentials = new CodeCredentials(keyring());
  for (const changed of [
    { ...context, challengeId: '0' },
    { ...context, challengeId: context.challengeId + '\n' },
    { ...context, emailLookup: 'A'.repeat(64) },
    { ...context, purpose: 'other' as CodeContext['purpose'] },
  ])
    expect(() => credentials.mac(changed, '123456')).toThrow('code-input-invalid');
  for (const code of ['12345', '1234567', '123456\n', '１２３４５６']) {
    expect(() => credentials.mac(context, code)).toThrow('code-input-invalid');
    expect(credentials.matches(context, code, { mac: 'a'.repeat(64), keyId: 'one' })).toBe(false);
  }
  expect(credentials.matches(context, '123456', { mac: 'x', keyId: 'one' })).toBe(false);
});

it('默认随机入口生成协议要求的编号和保留前导零的六位数字', () => {
  vi.mocked(randomInt).mockImplementationOnce(() => 0);
  expect(newChallengeId()).toMatch(/^[0-9a-f]{32}$/);
  expect(randomBytes).toHaveBeenLastCalledWith(16);
  expect(newEmailCode()).toBe('000000');
  expect(randomInt).toHaveBeenLastCalledWith(1000000);
});

it('邮箱域名拒绝 URL 分隔符、转义和 IP 字面值，不得改写收件地址', () => {
  for (const email of [
    'a@example.com/path',
    'a@example.com?x',
    'a@example.com#x',
    'a@example.com\\path',
    'a@example%2ecom',
    'a@example.com:80',
    'a@127.1',
    'a@0x7f.1',
    'a@0177.0.0.1',
    'a@127.0.0.1',
    'a@0x7f000001',
  ]) {
    expect(normalizeEmail(email)).toBeUndefined();
  }
});
