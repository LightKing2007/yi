/** 邮箱保护的真实密码学边界；固定假密钥，独立 HMAC 已知答案，不依赖执行速度。 */
import { expect, it } from 'vitest';
import { EmailProtection, type EmailContext } from '../server/emailProtection';

const oldKey = Buffer.alloc(32, 1);
const currentKey = Buffer.alloc(32, 2);
const lookupKey = Buffer.alloc(32, 3);
const email = 'player@example.com';
const account: EmailContext = { purpose: 'account-email', recordId: '42' };
const challenge: EmailContext = { purpose: 'registration-email', recordId: '42' };
const protection = () =>
  new EmailProtection({
    currentKeyId: 'new',
    encryption: new Map([
      ['old', oldKey],
      ['new', currentKey],
    ]),
    lookup: lookupKey,
  });
const flip = (hex: string) => (hex.startsWith('0') ? '1' : '0') + hex.slice(1);

it('真实加密可完整恢复原文且每次使用新 nonce', () => {
  const vault = protection();
  const one = vault.seal(email, account);
  const two = vault.seal(email, account);
  expect(vault.open(one, account)).toBe(email);
  expect(vault.open(two, account)).toBe(email);
  expect(one).toMatchObject({ v: 1, keyId: 'new' });
  expect(one.nonce).toMatch(/^[0-9a-f]{24}$/);
  expect(one.tag).toMatch(/^[0-9a-f]{32}$/);
  expect(one.ciphertext).toHaveLength(Buffer.byteLength(email) * 2);
  expect(one.nonce).not.toBe(two.nonce);
  expect(one.ciphertext).not.toBe(Buffer.from(email).toString('hex'));
  expect(vault.open(vault.seal('e\u0301@例子.测试', challenge), challenge)).toBe('e\u0301@例子.测试');
});

it('篡改密文、nonce 或标签均拒绝且不返回部分明文', () => {
  const vault = protection();
  const sealed = vault.seal(email, account);
  for (const field of ['ciphertext', 'nonce', 'tag'] as const) {
    expect(() => vault.open({ ...sealed, [field]: flip(sealed[field]) }, account)).toThrow('email-authentication-failed');
  }
});

it('密文绑定记录、用途及密钥编号，不能跨账号或挑战替换', () => {
  const vault = new EmailProtection({
    currentKeyId: 'one',
    encryption: new Map([
      ['one', oldKey],
      ['alias', oldKey],
    ]),
    lookup: lookupKey,
  });
  const sealed = vault.seal(email, account);
  expect(() => vault.open(sealed, { ...account, recordId: '43' })).toThrow('email-authentication-failed');
  expect(() => vault.open(sealed, challenge)).toThrow('email-authentication-failed');
  expect(() => vault.open({ ...sealed, keyId: 'alias' }, account)).toThrow('email-authentication-failed');
});

it('密钥轮换可读取旧密文，新写入仅用当前密钥且不回退缺失密钥', () => {
  const before = new EmailProtection({ currentKeyId: 'old', encryption: new Map([['old', oldKey]]), lookup: lookupKey });
  const sealed = before.seal(email, account);
  const after = protection();
  expect(after.open(sealed, account)).toBe(email);
  expect(after.seal(email, account).keyId).toBe('new');
  expect(after.lookup(email)).toBe(before.lookup(email));
  const retired = new EmailProtection({ currentKeyId: 'new', encryption: new Map([['new', currentKey]]), lookup: lookupKey });
  expect(() => retired.open(sealed, account)).toThrow('email-key-unavailable');
});

it('查找凭据符合独立 HMAC 答案，且与加密密钥分离', () => {
  const vault = protection();
  // Python hmac.new(bytes([3])*32, b'["yi:email-lookup",1,"player@example.com"]', hashlib.sha256)。
  expect(vault.lookup(email)).toBe('5fb0191c3bf2928d6655ca0996a3bc66709b3490d35528edf02bb510b45fe430');
  expect(vault.lookup('other@example.com')).not.toBe(vault.lookup(email));
  const otherLookup = new EmailProtection({ currentKeyId: 'new', encryption: new Map([['new', currentKey]]), lookup: Buffer.alloc(32, 4) });
  expect(otherLookup.lookup(email)).not.toBe(vault.lookup(email));
  expect(otherLookup.open(vault.seal(email, account), account)).toBe(email);
});

it('严格拒绝损坏封包、非法上下文和超限原文', () => {
  const vault = protection();
  const sealed = vault.seal(email, account);
  const invalid: unknown[] = [
    null,
    {},
    { ...sealed, v: 2 },
    { ...sealed, keyId: 'new\n' },
    { ...sealed, nonce: sealed.nonce.slice(1) + '\n' },
    { ...sealed, tag: '00' },
    { ...sealed, ciphertext: 'ab\n' },
    { ...sealed, ciphertext: '0' },
    { ...sealed, ciphertext: '00'.repeat(255) },
  ];
  for (const value of invalid) expect(() => vault.open(value, account)).toThrow('email-envelope-invalid');
  for (const input of ['', 'a'.repeat(255), '\ud800']) {
    expect(() => vault.seal(input, account)).toThrow('email-input-invalid');
    expect(() => vault.lookup(input)).toThrow('email-input-invalid');
  }
  for (const recordId of ['', 'x'.repeat(129)]) expect(() => vault.seal(email, { ...account, recordId })).toThrow('email-context-invalid');
  expect(() => vault.seal(email, { ...account, purpose: 'reset' } as unknown as EmailContext)).toThrow('email-context-invalid');
});

it('拒绝非法或复用密钥，并复制密钥以免外部修改造成暗中轮换', () => {
  const freshOptions = () => ({ currentKeyId: 'new', encryption: new Map([['new', Buffer.from(currentKey)]]), lookup: Buffer.from(lookupKey) });
  const options = freshOptions();
  const vault = new EmailProtection(options);
  const sealed = vault.seal(email, account);
  const found = vault.lookup(email);
  options.encryption.get('new')?.fill(0);
  options.lookup.fill(0);
  expect(() => vault.open(sealed, account)).not.toThrow();
  expect(vault.open(sealed, account)).toBe(email);
  expect(vault.lookup(email)).toBe(found);
  for (const keys of [
    { ...freshOptions(), currentKeyId: 'missing' },
    { ...freshOptions(), currentKeyId: 'new\n' },
    { ...freshOptions(), lookup: Buffer.alloc(1) },
    { ...freshOptions(), encryption: new Map([['new', Buffer.alloc(1)]]) },
    { ...freshOptions(), encryption: new Map([['new', Buffer.from(lookupKey)]]) },
  ])
    expect(() => new EmailProtection(keys)).toThrow('email-keyring-invalid');
});
