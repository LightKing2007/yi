/** 账号邮箱的统一规范化入口；支持 ASCII 非引号本地部分和 IDNA 域名，不折叠服务商专有别名。 */
import { domainToASCII } from 'node:url';

const RAW_MAX_BYTES = 1024;
const EMAIL_MAX_BYTES = 254;
const LOCAL_MAX_BYTES = 64;
const LABEL_MAX_BYTES = 63;
const LOCAL_FORMAT = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const LABEL_FORMAT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SPACE_CODE = 32;
const DELETE_CODE = 127;
const DOMAIN_DELIMITERS = ['/', '\\', '%', ':', '?', '#'];

/** 控制字符在修剪前拒绝，不能把邮件头换行当作可忽略空白。 */
function hasControl(value: string): boolean {
  return Array.from(value).some(char => char.charCodeAt(0) < SPACE_CODE || char.charCodeAt(0) === DELETE_CODE);
}

/** 支持 dot-atom 的子集；不尝试解释引号及国际化本地部分。 */
function validLocal(local: string): boolean {
  return LOCAL_FORMAT.test(local) && local.length <= LOCAL_MAX_BYTES && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
}

/** 返回小写、NFC、ASCII 域名地址；非法输入返回 undefined，密码不使用此函数。 */
export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || Buffer.byteLength(value) > RAW_MAX_BYTES || hasControl(value)) return undefined;
  if (Buffer.from(value).toString('utf8') !== value) return undefined;
  const parts = value.trim().normalize('NFC').toLowerCase().split('@');
  if (parts.length !== 2) return undefined;
  const local = parts[0] ?? '';
  const domainInput = parts[1] ?? '';
  if (DOMAIN_DELIMITERS.some(delimiter => domainInput.includes(delimiter))) return undefined;
  const domain = domainToASCII(domainInput);
  if (!validLocal(local)) return undefined;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => label.length > LABEL_MAX_BYTES || !LABEL_FORMAT.test(label))) return undefined;
  const email = `${local}@${domain}`;
  return Buffer.byteLength(email) <= EMAIL_MAX_BYTES ? email : undefined;
}
