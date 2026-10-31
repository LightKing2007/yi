/** 雅号和密码的业务输入边界；雅号规范化，密码严格保留 UTF-8 原文。 */
const NAME_RAW_MAX_BYTES = 256;
const NAME_MAX_BYTES = 64;
const NAME_MAX_GRAPHEMES = 16;
const PASSWORD_MAX_BYTES = 1024;
const PASSWORD_MIN_CHARACTERS = 8;
const UNSAFE_NAME = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const GRAPHEMES = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** 雅号允许重名，最多十六个字素及六十四字节；拒绝控制、格式及双向控制字符。 */
export function accountName(value: unknown): string | undefined {
  if (typeof value !== 'string' || Buffer.byteLength(value) > NAME_RAW_MAX_BYTES || UNSAFE_NAME.test(value)) return undefined;
  const name = value.trim().normalize('NFC');
  if (!name.length || Buffer.byteLength(name) > NAME_MAX_BYTES) return undefined;
  return Array.from(GRAPHEMES.segment(name)).length <= NAME_MAX_GRAPHEMES ? name : undefined;
}

/** 新密码至少八个 Unicode 码点；登录允许既有策略口令，均拒绝损坏编码及超长，不修剪、不 NFC。 */
export function accountPassword(value: unknown, creation = false): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > PASSWORD_MAX_BYTES) return undefined;
  if (Buffer.from(value).toString('utf8') !== value) return undefined;
  if (creation && Array.from(value).length < PASSWORD_MIN_CHARACTERS) return undefined;
  return value;
}
