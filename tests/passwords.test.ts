/** 口令存储：真实 scrypt 对照独立工具，资源闸门以手动完成的 Promise 验证，不断言机器速度。 */
import { expect, it } from 'vitest';
import { PasswordBusyError, PasswordHasher, type PasswordDeriver } from '../server/passwords';

// Python 3.14 hashlib.scrypt 与 OpenSSL 4.0.3 kdf SCRYPT 独立运行得到相同答案。
const REFERENCE_SALT = '000102030405060708090a0b0c0d0e0f';
const REFERENCE_HASH = '1b2946da71f41179e83b99dc33842d15741b87c4121c8c7f3781c1df864fb58be0428e6abc9b6ddcbdf1a06e8ac274095d78b83da8ef39d6f3094f076b71de5c';
const stored = (hash = REFERENCE_HASH) => `scrypt$131072$8$1$${REFERENCE_SALT}$${hash}`;
const key = () => Buffer.alloc(64, 7);

/** 派生器的手动开关，避免用延时或执行速度制造并发。 */
function deferredDeriver() {
  const pending: { resolve: (key: Buffer) => void; reject: (err: Error) => void }[] = [];
  const derive: PasswordDeriver = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  return { pending, derive };
}

it('真实 scrypt 与独立已知答案一致并拒绝错误口令', async () => {
  const hasher = new PasswordHasher();
  expect(await hasher.verify('correct horse battery staple', stored())).toBe(true);
  expect(await hasher.verify('correct horse battery staple!', stored())).toBe(false);
}, 10000);

it('新建散列原样传递口令、生成独立随机盐并输出固定格式', async () => {
  const salts: string[] = [];
  const passwords: string[] = [];
  const password = '  e\u0301 密码  ';
  const hasher = new PasswordHasher(1, async (input, salt) => {
    passwords.push(input);
    salts.push(salt.toString('hex'));
    return key();
  });
  const one = await hasher.hash(password);
  const two = await hasher.hash(password);
  expect(passwords).toEqual([password, password]);
  expect(one).toBe(`scrypt$131072$8$1$${salts[0]}$${key().toString('hex')}`);
  expect(salts).toHaveLength(2);
  expect(salts[0]).toMatch(/^[0-9a-f]{32}$/);
  expect(salts[1]).toMatch(/^[0-9a-f]{32}$/);
  expect(one).not.toBe(two);
});

it('损坏的格式和任意成本参数不会启动派生', async () => {
  let calls = 0;
  const hasher = new PasswordHasher(1, async () => {
    calls++;
    return key();
  });
  const valid = stored();
  const invalid = [
    'x' + valid,
    valid + '\n',
    valid.replace('131072', '32768'),
    valid.replace('$8$', '$9$'),
    valid.replace('scrypt', 'sha256'),
    valid.replace(REFERENCE_SALT, '00'),
    valid.slice(0, -1),
    valid.toUpperCase(),
  ];
  for (const value of invalid) expect(await hasher.verify('password', value)).toBe(false);
  expect(calls).toBe(0);
});

it('按 UTF-8 字节拒绝空或过长口令且不启动派生', async () => {
  let calls = 0;
  const hasher = new PasswordHasher(1, async () => {
    calls++;
    return key();
  });
  for (const password of ['', '中'.repeat(342)]) {
    await expect(hasher.hash(password)).rejects.toThrow('字节长度不合法');
    expect(await hasher.verify(password, stored())).toBe(false);
  }
  expect(calls).toBe(0);
});

it('达到并发上限立即拒绝且成功后恢复名额', async () => {
  const { pending, derive } = deferredDeriver();
  const hasher = new PasswordHasher(1, derive);
  const first = hasher.hash('password-one');
  const second = hasher.hash('password-two');
  const rejection = expect(second).rejects.toBeInstanceOf(PasswordBusyError);
  expect(pending).toHaveLength(1);
  pending[0]?.resolve(key());
  await first;
  await rejection;
  const third = hasher.hash('password-three');
  expect(pending).toHaveLength(2);
  pending[1]?.resolve(key());
  await expect(third).resolves.toMatch(/^scrypt\$/);
});

it('派生失败或输出损坏后释放名额', async () => {
  const { pending, derive } = deferredDeriver();
  const hasher = new PasswordHasher(1, derive);
  const first = hasher.hash('password-one');
  const failure = expect(first).rejects.toThrow('fake-failure');
  pending[0]?.reject(new Error('fake-failure'));
  await failure;
  const second = hasher.hash('password-two');
  const malformed = expect(second).rejects.toThrow('输出不合法');
  pending[1]?.resolve(Buffer.alloc(1));
  await malformed;
  const third = hasher.hash('password-three');
  pending[2]?.resolve(key());
  await expect(third).resolves.toMatch(/^scrypt\$/);
});

it('并发配置必须是正整数', () => {
  for (const concurrency of [0, -1, 1.5, Infinity]) expect(() => new PasswordHasher(concurrency)).toThrow('并发数不合法');
});
