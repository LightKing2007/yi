/** 公开 UID：七位 Base32 随机数据加一位 Luhn mod 32 校验；仅用于识别与录入校验，不用于认证。 */
export const PUBLIC_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 随机数据字符数；完整 UID 另含一位校验字符。 */
export const PUBLIC_ID_DATA_LENGTH = 7;
const PUBLIC_ID_LENGTH = PUBLIC_ID_DATA_LENGTH + 1;
const DATA_FORMAT = /^[0-9A-HJKMNP-TV-Z]{7}$/;
const INPUT_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}$/;
const BASE = PUBLIC_ID_ALPHABET.length;

/** 只对规范的七位数据添加校验位；输入非法时拒绝，不截断或补零。 */
export function checkedPublicId(data: string): string {
  if (!DATA_FORMAT.test(data)) throw new Error('public-id-data-invalid');
  let sum = 0;
  let factor = 2;
  for (let i = data.length - 1; i >= 0; i--) {
    const product = PUBLIC_ID_ALPHABET.indexOf(data[i] ?? '') * factor;
    sum += Math.floor(product / BASE) + (product % BASE);
    factor = factor === 2 ? 1 : 2;
  }
  return data + PUBLIC_ID_ALPHABET[(BASE - (sum % BASE)) % BASE];
}

/** 接受大小写与一个四位分隔符；返回无分隔符的大写规范值，损坏输入返回 null。 */
export function parsePublicId(input: unknown): string | null {
  if (typeof input !== 'string' || (input.length !== PUBLIC_ID_LENGTH && input.length !== PUBLIC_ID_LENGTH + 1)) return null;
  const value = input.toUpperCase();
  if (!INPUT_FORMAT.test(value)) return null;
  const canonical = value.replace('-', '');
  return checkedPublicId(canonical.slice(0, PUBLIC_ID_DATA_LENGTH)) === canonical ? canonical : null;
}

/** 只格式化校验通过的 UID，显示为 XXXX-XXXX；不可把格式化结果当作身份凭据。 */
export function displayPublicId(input: string): string | null {
  const value = parsePublicId(input);
  const GROUP_LENGTH = 4;
  return value ? `${value.slice(0, GROUP_LENGTH)}-${value.slice(GROUP_LENGTH)}` : null;
}
