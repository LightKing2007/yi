/** 桌面版的登录状态保存（electron/credentials.ts）：只存密文、加密不可用时不保存、损坏或过期即删除、记录逐项校验。 */
import { describe, expect, it } from 'vitest';
import { CredentialStore, encryptionUsable, savedLogin, type Cipher } from '../electron/credentials';

/** 32 位小写十六进制的虚构令牌；用重复的两字符拼出，随机度远低于密钥扫描的门槛（gitleaks 的熵阈值 3.5） */
const TOKEN = 'a1'.repeat(16);
const LATER = '2026-12-01T08:00:00.000Z';
const NOW = Date.parse('2026-11-01T08:00:00.000Z');

/** 可逆的假加密：加前缀并逐字节取反，确保文件中没有明文 */
function fakeCipher(available = true): Cipher & { usable: boolean } {
  const cipher = {
    usable: available,
    available: () => cipher.usable,
    encrypt: (text: string) => Buffer.concat([Buffer.from('ENC:'), Buffer.from(text).map(byte => 255 - byte)]),
    decrypt: (data: Buffer) => {
      if (!data.subarray(0, 4).equals(Buffer.from('ENC:'))) throw new Error('fixture-decrypt');
      return Buffer.from(data.subarray(4).map(byte => 255 - byte)).toString();
    },
  };
  return cipher;
}

/** 内存中的保存文件 */
function memoryDisk() {
  const disk = {
    data: undefined as Buffer | undefined,
    writes: 0,
    read: () => disk.data,
    write: (data: Buffer) => {
      disk.writes++;
      disk.data = data;
    },
    remove: () => {
      disk.data = undefined;
    },
  };
  return disk;
}

const world = (available = true) => {
  const cipher = fakeCipher(available);
  const disk = memoryDisk();
  let now = NOW;
  const store = new CredentialStore(cipher, disk, () => now);
  return { cipher, disk, store, advance: (ms: number) => (now += ms) };
};

it('保存后可读回，文件中只有密文', () => {
  const ctx = world();
  expect(ctx.store.save(TOKEN, LATER)).toBe(true);
  expect(ctx.disk.data?.toString('latin1')).not.toContain(TOKEN);
  expect(ctx.store.load()).toEqual({ token: TOKEN, expiresAt: LATER });
  ctx.store.clear();
  expect(ctx.disk.data).toBeUndefined();
  expect(ctx.store.load()).toBeUndefined();
});

it('加密不可用时不写任何文件，不降级为明文；读取时也不尝试解密', () => {
  const ctx = world(false);
  expect(ctx.store.save(TOKEN, LATER)).toBe(false);
  expect(ctx.disk.writes).toBe(0);
  const ready = world();
  ready.store.save(TOKEN, LATER);
  ready.cipher.usable = false;
  expect(ready.store.load()).toBeUndefined();
  expect(ready.disk.data).toBeUndefined();
});

it('记录不合格时不保存', () => {
  const ctx = world();
  for (const [token, expiresAt] of [
    [TOKEN.toUpperCase(), LATER],
    [TOKEN.slice(1), LATER],
    [TOKEN, '2026-12-01 08:00:00'],
    [TOKEN, '2026-13-45T99:00:00Z'],
    [123, LATER],
    [TOKEN, null],
  ] as const) {
    expect(ctx.store.save(token, expiresAt)).toBe(false);
  }
  expect(ctx.disk.writes).toBe(0);
});

it('过期、解不开、格式版本不符、内容不合格或文件过大时删除文件并视为未登录', () => {
  const expired = world();
  expired.store.save(TOKEN, LATER);
  expired.advance(Date.parse(LATER) - NOW);
  expect(expired.store.load()).toBeUndefined();
  expect(expired.disk.data).toBeUndefined();
  const cases: Buffer[] = [
    Buffer.from('not encrypted'),
    fakeCipher().encrypt(JSON.stringify({ v: 2, token: TOKEN, expiresAt: LATER })),
    fakeCipher().encrypt(JSON.stringify({ v: 1, token: 'x', expiresAt: LATER })),
    fakeCipher().encrypt('[1]'),
    fakeCipher().encrypt('{"v":1'),
    fakeCipher().encrypt(JSON.stringify({ v: 1, token: TOKEN, expiresAt: LATER, pad: 'x'.repeat(5000) })),
    Buffer.alloc(0),
  ];
  for (const data of cases) {
    const ctx = world();
    ctx.disk.data = data;
    expect(ctx.store.load()).toBeUndefined();
    expect(ctx.disk.data).toBeUndefined();
  }
});

it('读写出错时视为未登录或保存失败，不抛出', () => {
  const ctx = world();
  const broken = new CredentialStore(
    ctx.cipher,
    {
      read: () => {
        throw new Error('fixture-read');
      },
      write: () => {
        throw new Error('fixture-write');
      },
      remove: () => {},
    },
    () => NOW,
  );
  expect(broken.load()).toBeUndefined();
  expect(broken.save(TOKEN, LATER)).toBe(false);
});

it('文件删不掉时，读取过期或损坏的记录仍返回未登录，退出也不抛出', () => {
  const ctx = world();
  ctx.store.save(TOKEN, LATER);
  const stuck = new CredentialStore(
    ctx.cipher,
    {
      read: () => ctx.disk.data,
      write: () => {},
      remove: () => {
        throw new Error('fixture-remove');
      },
    },
    () => Date.parse(LATER),
  );
  expect(stuck.load()).toBeUndefined();
  expect(() => stuck.clear()).not.toThrow();
  ctx.disk.data = Buffer.from('not encrypted');
  expect(stuck.load()).toBeUndefined();
});

describe('加密可用性与记录校验', () => {
  it('Linux 上只有明文后端或后端不明时视为不可用', () => {
    expect(encryptionUsable(true, 'darwin')).toBe(true);
    expect(encryptionUsable(true, 'win32')).toBe(true);
    expect(encryptionUsable(false, 'darwin')).toBe(false);
    expect(encryptionUsable(true, 'linux', 'gnome_libsecret')).toBe(true);
    expect(encryptionUsable(true, 'linux', 'basic_text')).toBe(false);
    expect(encryptionUsable(true, 'linux', 'unknown')).toBe(false);
    expect(encryptionUsable(true, 'linux')).toBe(false);
  });

  it('记录须为 32 位小写十六进制令牌与 RFC 3339 UTC 期限', () => {
    expect(savedLogin(TOKEN, LATER)).toEqual({ token: TOKEN, expiresAt: LATER });
    expect(savedLogin(TOKEN, '2026-12-01T08:00:00Z')).toEqual({ token: TOKEN, expiresAt: '2026-12-01T08:00:00Z' });
    expect(savedLogin(TOKEN, '2026-12-01T08:00:00+08:00')).toBeUndefined();
  });
});
