/** 六位邮箱验证码的随机生成与独立密钥 HMAC；只处理凭据，不持久化或记录验证码。 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;
const ID_BYTES = 16;
const CODE_SPACE = 1000000;
const CODE_DIGITS = 6;
const KEY_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ID_FORMAT = /^[0-9a-f]{32}$/;
const HASH_FORMAT = /^[0-9a-f]{64}$/;
const CODE_FORMAT = /^[0-9]{6}$/;

/** 验证码按操作隔离，注册不能作为改密证明。 */
export type CodePurpose = 'register' | 'reset' | 'change';
/** 内部绑定资料，不是客户端提交即可信的身份证明。 */
export interface CodeContext {
  challengeId: string;
  emailLookup: string;
  purpose: CodePurpose;
}
/** 旧密钥仅供短期验证；必须与邮箱加密、邮箱查找密钥独立，由配置层装配。 */
export interface CodeKeyring {
  currentKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

/** 严格校验调用者输入，持久化损坏不能扩大到任意计算或跨用途使用。 */
export function validCodeContext(value: CodeContext): boolean {
  return (
    ID_FORMAT.test(value.challengeId) &&
    value.challengeId.length === ID_BYTES * 2 &&
    HASH_FORMAT.test(value.emailLookup) &&
    value.emailLookup.length === KEY_BYTES * 2 &&
    ['register', 'reset', 'change'].includes(value.purpose)
  );
}
/** 挑战编号为 128 位随机值，只用来定位，不能证明知道验证码。 */
export function newChallengeId(): string {
  return randomBytes(ID_BYTES).toString('hex');
}
/** 均匀生成六位数字，保留前导零；不通过取模引入偏差。 */
export function newEmailCode(): string {
  return String(randomInt(CODE_SPACE)).padStart(CODE_DIGITS, '0');
}

/** 复制密钥快照；完整元组域分离，数据库离线枚举需要额外取得此密钥。 */
export class CodeCredentials {
  private readonly keys = new Map<string, Buffer>();
  readonly currentKeyId: string;

  constructor(ring: CodeKeyring) {
    for (const [id, key] of ring.keys) {
      if (!KEY_ID_FORMAT.test(id) || id.trim() !== id || !Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('code-keyring-invalid');
      this.keys.set(id, Buffer.from(key));
    }
    if (!KEY_ID_FORMAT.test(ring.currentKeyId) || !this.keys.has(ring.currentKeyId)) throw new Error('code-keyring-invalid');
    this.currentKeyId = ring.currentKeyId;
  }

  /** 只输出 HMAC；原文仅在生成、核验和交给发送器时短暂存在。 */
  mac(context: CodeContext, code: string, keyId = this.currentKeyId): string {
    if (!validCodeContext(context) || !CODE_FORMAT.test(code) || code.length !== CODE_DIGITS) throw new Error('code-input-invalid');
    const key = this.keys.get(keyId);
    if (!key) throw new Error('code-key-unavailable');
    const message = JSON.stringify(['yi:email-code', 1, context.purpose, context.challengeId, context.emailLookup, code]);
    return createHmac('sha256', key).update(message).digest('hex');
  }

  /** 损坏凭据拒绝；未知旧密钥明确失败，不回退到当前密钥。 */
  matches(context: CodeContext, code: string, stored: { mac: string; keyId: string }): boolean {
    if (!HASH_FORMAT.test(stored.mac) || stored.mac.length !== KEY_BYTES * 2 || !CODE_FORMAT.test(code) || code.length !== CODE_DIGITS) return false;
    return timingSafeEqual(Buffer.from(this.mac(context, code, stored.keyId), 'hex'), Buffer.from(stored.mac, 'hex'));
  }
}
