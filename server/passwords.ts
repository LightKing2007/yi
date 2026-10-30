/** 账号口令的异步加盐 scrypt 散列、严格校验与有界派生；未接入现有游客或联机流程（DAT-070）。 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_MAXMEM_BYTES = 201326592; // 192 MiB；已在参考机验证参数可用
/** 技术边界，不代替注册界面的最低口令要求；按 UTF-8 字节计，不截断或规范化口令。 */
const MAX_PASSWORD_BYTES = 1024;
const HASH_PREFIX = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$`;
/** 固定参数与编码长度，拒绝让数据库内容决定成本，也拒绝非规范 hex 表示。 */
const HASH_FORMAT = /^scrypt\$131072\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

/** 测试可替换派生边界；生产使用固定参数的异步 Node.js scrypt，不向客户端开放。 */
export type PasswordDeriver = (password: string, salt: Buffer) => Promise<Buffer>;

/** 昂贵派生达到上限时立即拒绝，认证入口将其映射为可重试的过载响应。 */
export class PasswordBusyError extends Error {
  constructor() {
    super('password-derivation-busy');
    this.name = 'PasswordBusyError';
  }
}

/** 固定参数派生；显式 maxmem 覆盖 Node 默认限制，内存及并发须在实际服务器另测。 */
function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM_BYTES }, (err, key) => {
      if (err) reject(new Error('口令派生失败'));
      else resolve(key);
    });
  });
}

/** 输入大小在派生前检查；不能用截断来让不同口令变成同一口令。 */
function validPassword(password: string): boolean {
  const bytes = Buffer.byteLength(password, 'utf8');
  return bytes > 0 && bytes <= MAX_PASSWORD_BYTES;
}

/** 由认证服务共享一个实例；默认仅一个在途任务，不排队，调用者不得按请求新建实例绕过上限。 */
export class PasswordHasher {
  private active = 0;

  constructor(
    private readonly concurrency = 1,
    private readonly derive: PasswordDeriver = derivePassword,
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('口令派生并发数不合法');
  }

  /** 注册或重置时生成全新随机盐，持久化格式不包含原口令。 */
  async hash(password: string): Promise<string> {
    if (!validPassword(password)) throw new RangeError('口令字节长度不合法');
    const salt = randomBytes(SALT_BYTES);
    const key = await this.run(password, salt);
    return `${HASH_PREFIX}${salt.toString('hex')}$${key.toString('hex')}`;
  }

  /** 错误口令和损坏的存储格式返回 false；格式错误不会启动派生，过载或内部故障会抛错。 */
  async verify(password: string, stored: string): Promise<boolean> {
    if (!validPassword(password)) return false;
    if (stored.length !== HASH_PREFIX.length + (SALT_BYTES + KEY_BYTES) * 2 + 1) return false;
    const match = HASH_FORMAT.exec(stored);
    if (!match?.[1] || !match[2]) return false;
    const salt = Buffer.from(match[1], 'hex');
    const expected = Buffer.from(match[2], 'hex');
    const actual = await this.run(password, salt);
    return timingSafeEqual(actual, expected);
  }

  /** 检查上限和占位在第一个 await 前完成；成功、拒绝及错误输出均释放名额。 */
  private async run(password: string, salt: Buffer): Promise<Buffer> {
    if (this.active >= this.concurrency) throw new PasswordBusyError();
    this.active++;
    try {
      const key = await this.derive(password, salt);
      if (key.length !== KEY_BYTES) throw new Error('口令派生输出不合法');
      return key;
    } finally {
      this.active--;
    }
  }
}
