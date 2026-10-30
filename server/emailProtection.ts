/** 邮箱字段的认证加密与独立查找标识；调用者先规范化邮箱，不接触数据库、配置或发信（DAT-072）。 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const EMAIL_MAX_BYTES = 254;
const RECORD_MAX_BYTES = 128;
const KEY_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const HEX_FORMAT = /^[0-9a-f]+$/;
const ALGORITHM = 'aes-256-gcm';

/** 用途与不可变内部记录编号共同绑定密文；挑战不能直接作为已注册账号的邮箱密文。 */
export interface EmailContext {
  purpose: 'account-email' | 'registration-email';
  recordId: string;
}

/** 固定版本封包；hex 小写，nonce 12 字节、完整标签 16 字节，密文不超过邮箱的字节上限。 */
export interface ProtectedEmail {
  v: 1;
  keyId: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

/** 当前密钥用于写入，旧密钥保留解密；查找密钥独立于全部加密密钥。 */
export interface EmailKeyring {
  currentKeyId: string;
  encryption: ReadonlyMap<string, Buffer>;
  lookup: Buffer;
}

/** 只检查底层编码与字节上限，邮箱语法、小写及 NFC 规则由调用者处理。 */
function validEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const bytes = Buffer.from(email, 'utf8');
  return bytes.length > 0 && bytes.length <= EMAIL_MAX_BYTES && bytes.toString('utf8') === email;
}

/** 版本、字段用途、密钥编号和记录编号用 JSON 元组编码，避免拼接分隔符的歧义。 */
function aad(context: EmailContext, keyId: string): Buffer {
  const { purpose, recordId } = context;
  if ((purpose !== 'account-email' && purpose !== 'registration-email') || typeof recordId !== 'string' || !recordId.length) {
    throw new Error('email-context-invalid');
  }
  if (Buffer.byteLength(recordId, 'utf8') > RECORD_MAX_BYTES) throw new Error('email-context-invalid');
  return Buffer.from(JSON.stringify(['yi:email-field', 1, keyId, purpose, recordId]));
}

/** 封包严格校验后才交给 crypto，不信任存储或外部调用者提供的长度与版本。 */
function envelope(value: unknown): ProtectedEmail {
  if (!value || typeof value !== 'object') throw new Error('email-envelope-invalid');
  const field = value as Record<string, unknown>;
  if (field.v !== 1 || typeof field.keyId !== 'string' || !KEY_ID_FORMAT.test(field.keyId)) throw new Error('email-envelope-invalid');
  const validHex = (text: unknown, bytes: number) => typeof text === 'string' && text.length === bytes * 2 && HEX_FORMAT.test(text);
  if (!validHex(field.nonce, NONCE_BYTES) || !validHex(field.tag, TAG_BYTES)) throw new Error('email-envelope-invalid');
  const ciphertext = field.ciphertext;
  if (typeof ciphertext !== 'string' || ciphertext.length < 2 || ciphertext.length > EMAIL_MAX_BYTES * 2) throw new Error('email-envelope-invalid');
  if (ciphertext.length % 2 !== 0 || !HEX_FORMAT.test(ciphertext)) throw new Error('email-envelope-invalid');
  return { v: 1, keyId: field.keyId, nonce: field.nonce as string, tag: field.tag as string, ciphertext };
}

/** 复制密钥快照供一个认证服务共享；配置变更须显式重新装配，不随调用者修改 Buffer 而悄悄换密钥。 */
export class EmailProtection {
  private readonly encryption = new Map<string, Buffer>();
  private readonly lookupKey: Buffer;
  private readonly currentKeyId: string;

  constructor(keys: EmailKeyring) {
    if (!KEY_ID_FORMAT.test(keys.currentKeyId) || !Buffer.isBuffer(keys.lookup) || keys.lookup.length !== KEY_BYTES) {
      throw new Error('email-keyring-invalid');
    }
    for (const [keyId, key] of keys.encryption) {
      if (!KEY_ID_FORMAT.test(keyId) || !Buffer.isBuffer(key) || key.length !== KEY_BYTES || key.equals(keys.lookup)) {
        throw new Error('email-keyring-invalid');
      }
      this.encryption.set(keyId, Buffer.from(key));
    }
    if (!this.encryption.has(keys.currentKeyId)) throw new Error('email-keyring-invalid');
    this.currentKeyId = keys.currentKeyId;
    this.lookupKey = Buffer.from(keys.lookup);
  }

  /** 每次独立随机 nonce；返回对象中不包含邮箱明文。 */
  seal(email: string, context: EmailContext): ProtectedEmail {
    if (!validEmail(email)) throw new Error('email-input-invalid');
    const key = this.key(this.currentKeyId);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(context, this.currentKeyId));
    const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
    return { v: 1, keyId: this.currentKeyId, nonce: nonce.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') };
  }

  /** 缺密钥、损坏封包或认证失败均明确失败，不返回未认证的部分明文。 */
  open(value: unknown, context: EmailContext): string {
    const packet = envelope(value);
    const key = this.key(packet.keyId);
    const authenticated = aad(context, packet.keyId);
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(packet.nonce, 'hex'), { authTagLength: TAG_BYTES });
      decipher.setAAD(authenticated);
      decipher.setAuthTag(Buffer.from(packet.tag, 'hex'));
      const email = Buffer.concat([decipher.update(Buffer.from(packet.ciphertext, 'hex')), decipher.final()]).toString('utf8');
      if (!validEmail(email)) throw new Error('email-input-invalid');
      return email;
    } catch {
      // 不保留底层异常的明文或细节，调用者将此故障统一映射到关闭相关账号操作。
      throw new Error('email-authentication-failed');
    }
  }

  /** 确定性查找凭据；独立域分离，换密钥后的数据库双索引迁移由账号仓储实现。 */
  lookup(email: string): string {
    if (!validEmail(email)) throw new Error('email-input-invalid');
    const message = JSON.stringify(['yi:email-lookup', 1, email]);
    return createHmac('sha256', this.lookupKey).update(message).digest('hex');
  }

  /** 密钥缺失拒绝操作，不退回当前密钥、默认值或明文。 */
  private key(keyId: string): Buffer {
    const key = this.encryption.get(keyId);
    if (!key) throw new Error('email-key-unavailable');
    return key;
  }
}
