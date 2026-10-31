/**
 * 账号功能的密钥与发信凭据（SEC-051）：从 systemd 凭据目录读取两份 JSON，校验后装成各模块的密钥环与 SMTP 配置。
 * - `yi-account-keys`：邮箱加密（可多把，按编号）、邮箱查找、验证码校验（可多把）与来源标识，各为 32 字节的 base64，互不相同
 * - `yi-smtp`：阿里云邮件推送的主机、端口、发信地址、SMTP 口令与发件人名称
 * 校验失败时只报出凭据名与期望的格式，严禁带出任何密钥或口令的内容（DAT-073）。生成方法见 scripts/account-keys.mjs。
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from '../src/shared/check';
import type { CodeKeyring } from './codeCredentials';
import type { EmailKeyring } from './emailProtection';

/** 凭据名，与 yi.service 中 LoadCredential= 的名称一致 */
export const KEYS_CREDENTIAL = 'yi-account-keys';
export const SMTP_CREDENTIAL = 'yi-smtp';
const KEY_BYTES = 32;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const BASE64 = /^[A-Za-z0-9+/]{43}=$/;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const ADDRESS = /^[\x21-\x3f\x41-\x7e]+@[A-Za-z0-9.-]+$/;
const PORT_MAX = 65535;
const NAME_MAX = 32;
const PASSWORD_MAX = 256;

/** 装配所需的全部密钥与发信配置 */
export interface AccountSecrets {
  email: EmailKeyring;
  code: CodeKeyring;
  source: Buffer;
  smtp: { host: string; port: number; username: string; password: string; from: { address: string; name: string } };
}

/** 凭据缺失或格式不符；problems 只含凭据名与期望的格式 */
export class AccountSecretsError extends Error {
  constructor(readonly problems: readonly { credential: string; expected: string }[]) {
    super('account-secrets-invalid');
  }
}

/** 一把 32 字节的密钥 */
function key(value: unknown): Buffer | undefined {
  return typeof value === 'string' && BASE64.test(value) ? Buffer.from(value, 'base64') : undefined;
}

/** { current, keys: { 编号: 密钥 } } 形式的密钥环 */
function ring(value: unknown): { currentKeyId: string; keys: Map<string, Buffer> } | undefined {
  if (!isRecord(value) || typeof value.current !== 'string' || !isRecord(value.keys)) return undefined;
  const entries = Object.entries(value.keys).map(([id, raw]) => [id, key(raw)] as const);
  if (!entries.length || entries.some(([id, raw]) => !KEY_ID.test(id) || !raw)) return undefined;
  const keys = new Map(entries.map(([id, raw]) => [id, raw as Buffer]));
  return keys.has(value.current) ? { currentKeyId: value.current, keys } : undefined;
}

/** 读取并解析一份 JSON 凭据；不存在或不是对象时为 undefined */
function read(dir: string, name: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined; // 不存在、无权读取或不是 JSON：一律按缺失报出，不带出内容
  }
}

/** 密钥部分；各把密钥两两不同，避免误把同一把用于不同用途 */
function parseKeys(value: Record<string, unknown> | undefined) {
  const email = ring(value?.emailEncryption);
  const code = ring(value?.codeMac);
  const lookup = key(value?.emailLookup);
  const source = key(value?.source);
  if (!email || !code || !lookup || !source) return undefined;
  const all = [...email.keys.values(), ...code.keys.values(), lookup, source].map(item => item.toString('hex'));
  if (new Set(all).size !== all.length || all.some(hex => hex.length !== KEY_BYTES * 2)) return undefined;
  return { email: { currentKeyId: email.currentKeyId, encryption: email.keys, lookup }, code: { currentKeyId: code.currentKeyId, keys: code.keys }, source };
}

/** 发信部分 */
function parseSmtp(value: Record<string, unknown> | undefined): AccountSecrets['smtp'] | undefined {
  if (!value) return undefined;
  const { host, port, username, password, fromAddress, fromName } = value;
  if (typeof host !== 'string' || !HOST.test(host) || !Number.isInteger(port) || Number(port) < 1 || Number(port) > PORT_MAX) return undefined;
  if (typeof username !== 'string' || !ADDRESS.test(username) || typeof fromAddress !== 'string' || !ADDRESS.test(fromAddress)) return undefined;
  if (typeof password !== 'string' || !password.length || password.length > PASSWORD_MAX || /[\r\n\0]/.test(password)) return undefined;
  if (typeof fromName !== 'string' || !fromName.length || [...fromName].length > NAME_MAX || /[\r\n\0]/.test(fromName)) return undefined;
  return { host, port: Number(port), username, password, from: { address: fromAddress, name: fromName } };
}

/** 读取凭据目录；任何一份不合格时抛出 AccountSecretsError */
export function loadAccountSecrets(dir: string): AccountSecrets {
  const keys = parseKeys(read(dir, KEYS_CREDENTIAL));
  const smtp = parseSmtp(read(dir, SMTP_CREDENTIAL));
  const problems = [
    ...(keys
      ? []
      : [{ credential: KEYS_CREDENTIAL, expected: 'emailEncryption、codeMac 为 { current, keys }，emailLookup、source 为 32 字节 base64，各把互不相同' }]),
    ...(smtp ? [] : [{ credential: SMTP_CREDENTIAL, expected: 'host、port、username、password、fromAddress、fromName 齐全且格式正确' }]),
  ];
  if (!keys || !smtp) throw new AccountSecretsError(problems);
  return { ...keys, smtp };
}

/**
 * 新生成一份账号密钥（`node server.cjs account-keys`）：各把 32 字节，取自密码学随机源，编号均为 k1。
 * 只写到标准输出，由 root 以 umask 077 重定向到凭据文件；程序不保存、不记日志
 */
export function newAccountKeys(): string {
  const fresh = () => randomBytes(KEY_BYTES).toString('base64');
  const keys = {
    emailEncryption: { current: 'k1', keys: { k1: fresh() } },
    emailLookup: fresh(),
    codeMac: { current: 'k1', keys: { k1: fresh() } },
    source: fresh(),
  };
  return JSON.stringify(keys, null, 2);
}
