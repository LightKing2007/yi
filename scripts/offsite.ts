/**
 * 段位存档的异地加密备份（DAT-061 第二层、DAT-063；整改项 P1-13）。
 *   服务器上（打包为 /opt/yi/offsite.cjs，由 yi-offsite.service 在每日本地备份成功后运行）：
 *     node offsite.cjs upload       取本地最新的一份备份，核对 .sha256，以 age 加密后上传到阿里云 OSS
 *   本机（npm run offsite -- …）：
 *     keygen 私钥文件               生成 age 密钥：私钥写入该文件（只留在本机，严禁放到服务器上），打出公钥
 *     decrypt 备份.age 私钥文件 输出  解密从 OSS 下载的备份，确认为合法 JSON 后写出
 * 上传的对象：daily/yi-ratings-时间.json.age（OSS 生命周期规则保留 30 日）与 monthly/yi-ratings-年月.json.age
 * （每日覆盖为当月最新的一份，保留 365 日，即 12 份月备）。访问密钥只有这两个前缀的 PutObject 权限。
 * 请求以 OSS V4 签名（OSS4-HMAC-SHA256），带 Content-MD5 由 OSS 核对内容；不引入阿里云的 SDK。
 */
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from 'age-encryption';

/** 上传的请求超时 */
const UPLOAD_TIMEOUT_MS = 60_000;
/** HTTP 200 */
const HTTP_OK = 200;
/** 备份文件名：backup.sh 写入的 yi-ratings-UTC时间.json */
const BACKUP_NAME = /^yi-ratings-(\d{8}T\d{6}Z)\.json$/;
/** 不编码的字符（RFC 3986 的非保留字符），与 OSS 的 SDK 一致 */
const UNRESERVED = /[A-Za-z0-9\-._~]/;
/** 百分号编码的进制与位数 */
const HEX = 16,
  HEX_DIGITS = 2;
/** 时间戳 YYYYMMDDTHHMMSSZ 中日期（YYYYMMDD）与年月（YYYYMM）的长度 */
const DATE_LEN = 8,
  MONTH_LEN = 6;
/** OSS 的回应不是错误文档时，错误信息中最多附上回应的多少个字符 */
const ERROR_BODY_CHARS = 300;
/** 错误文档中提取的字段（阿里云文档“OSS 错误响应”）：错误码、说明，以及拒绝访问时的原因明细 */
const ERROR_FIELDS = ['Code', 'Message', 'AccessDeniedDetail'];
/** decrypt 的参数个数：备份、私钥文件、输出文件 */
const DECRYPT_ARGS = 3;

/** 异地备份的配置：来自 /etc/yi/offsite.env（经 yi-offsite.service 的 EnvironmentFile） */
export interface OssConfig {
  bucket: string;
  region: string; // 如 cn-hangzhou
  accessKeyId: string;
  accessKeySecret: string;
}

/** 按配置项逐一校验环境变量（COD-053）；不合法时抛出，指明是哪一项 */
export function readConfig(env: NodeJS.ProcessEnv): OssConfig & { recipient: string; backupDir: string } {
  const pick = (name: string, pattern: RegExp) => {
    const value = env[name] ?? '';
    if (!pattern.test(value)) throw new Error(`环境变量 ${name} 未设置或格式不对`);
    return value;
  };
  return {
    bucket: pick('YI_OSS_BUCKET', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
    region: pick('YI_OSS_REGION', /^[a-z]{2}-[a-z0-9-]{2,30}$/),
    accessKeyId: pick('YI_OSS_ACCESS_KEY_ID', /^[A-Za-z0-9]{8,64}$/),
    accessKeySecret: pick('YI_OSS_ACCESS_KEY_SECRET', /^[A-Za-z0-9]{8,128}$/),
    recipient: pick('YI_AGE_RECIPIENT', /^age1[0-9a-z]{20,}$/),
    backupDir: env.YI_BACKUP_DIR || '/var/lib/yi/backup',
  };
}

/** 按 RFC 3986 编码；encodeSlash 为 false 时保留“/” */
function uriEncode(text: string, encodeSlash = true) {
  let out = '';
  for (const byte of Buffer.from(text, 'utf8')) {
    const ch = String.fromCharCode(byte);
    out += UNRESERVED.test(ch) || (ch === '/' && !encodeSlash) ? ch : '%' + byte.toString(HEX).toUpperCase().padStart(HEX_DIGITS, '0');
  }
  return out;
}

const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** 一次待签名的请求：headers 的名称不区分大小写；query 的值为空串时只写参数名 */
export interface SignInput {
  method: string;
  bucket: string;
  key: string;
  query?: Record<string, string>;
  headers: Record<string, string>;
  config: Pick<OssConfig, 'region' | 'accessKeyId' | 'accessKeySecret'>;
  time: Date;
}

/**
 * OSS V4 签名（OSS4-HMAC-SHA256，阿里云文档“在 Header 中包含 V4 签名”）：返回应带上的全部请求头，
 * 含 x-oss-date、x-oss-content-sha256 与 Authorization。只签默认的请求头（x-oss-*、content-type、content-md5）
 */
export function signV4(input: SignInput): Record<string, string> {
  const stamp = input.time
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const date = stamp.slice(0, DATE_LEN);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) headers[name.toLowerCase()] = value;
  headers['x-oss-date'] = stamp;
  headers['x-oss-content-sha256'] = 'UNSIGNED-PAYLOAD';
  const signed = Object.keys(headers)
    .filter(name => name.startsWith('x-oss-') || name === 'content-type' || name === 'content-md5')
    .sort();
  const query = Object.entries(input.query ?? {})
    .map(([name, value]) => [uriEncode(name), uriEncode(value)])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => (value ? `${name}=${value}` : name))
    .join('&');
  const canonical = [
    input.method,
    uriEncode(`/${input.bucket}/${input.key}`, false),
    query,
    signed.map(name => `${name}:${headers[name].trim()}\n`).join(''),
    '',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const scope = `${date}/${input.config.region}/oss/aliyun_v4_request`;
  const toSign = ['OSS4-HMAC-SHA256', stamp, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  let key = hmac('aliyun_v4' + input.config.accessKeySecret, date);
  for (const part of [input.config.region, 'oss', 'aliyun_v4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...headers, authorization: `OSS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${scope},Signature=${signature}` };
}

/** 一份备份对应的两个对象名：日备与当月的月备 */
export function objectKeys(file: string) {
  const stamp = BACKUP_NAME.exec(path.basename(file))?.[1];
  if (!stamp) throw new Error(`不是备份文件：${file}`);
  return [`daily/yi-ratings-${stamp}.json.age`, `monthly/yi-ratings-${stamp.slice(0, MONTH_LEN)}.json.age`];
}

/** 目录中最新的一份备份，并核对其 .sha256（backup.sh 写入，DAT-064）；没有或不符时抛出 */
export function latestBackup(dir: string) {
  const names = fs
    .readdirSync(dir)
    .filter(name => BACKUP_NAME.test(name))
    .sort();
  const name = names.at(-1);
  if (!name) throw new Error(`${dir} 中没有备份`);
  const data = fs.readFileSync(path.join(dir, name));
  const want = fs.readFileSync(path.join(dir, name + '.sha256'), 'utf8').split(/\s+/)[0];
  if (createHash('sha256').update(data).digest('hex') !== want) throw new Error(`${name} 与其 .sha256 不符`);
  return { file: path.join(dir, name), data };
}

/** 以 age 加密到公钥 recipient */
export async function encrypt(data: Uint8Array, recipient: string) {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter.encrypt(data);
}

/** 以私钥 identity 解密，并确认内容为合法 JSON；返回原文 */
export async function decrypt(data: Uint8Array, identity: string) {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const text = await decrypter.decrypt(data, 'text');
  JSON.parse(text);
  return text;
}

/**
 * OSS 错误回应的要点：从错误文档（XML）中取出 ERROR_FIELDS 各字段（嵌套的子字段写成“名称=值”），合并空白，以“；”连接（不含 RequestId 等）；
 * 不是错误文档时取原文的前 ERROR_BODY_CHARS 个字符
 */
export function ossError(body: string) {
  const parts: string[] = [];
  for (const field of ERROR_FIELDS) {
    const value = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`).exec(body)?.[1];
    const text = value
      ?.replace(/<(\w+)>([^<]*)<\/\1>/g, ' $1=$2 ') // 嵌套的子字段写成“名称=值”
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) parts.push(`${field}=${text}`);
  }
  return parts.length ? parts.join('；') : body.slice(0, ERROR_BODY_CHARS);
}

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string>; headers: { get(name: string): string | null } }>;

/** 上传一个对象：带 Content-MD5 由 OSS 核对内容，并核对返回的 ETag（简单上传时为内容的 MD5）；失败时抛出 */
export async function putObject(config: OssConfig, key: string, body: Uint8Array, options: { fetch: Fetch; now: () => Date }) {
  const md5 = createHash('md5').update(body);
  const md5Hex = md5.copy().digest('hex');
  const headers = signV4({
    method: 'PUT',
    bucket: config.bucket,
    key,
    headers: { 'Content-Type': 'application/octet-stream', 'Content-MD5': md5.digest('base64') },
    config,
    time: options.now(),
  });
  const url = `https://${config.bucket}.oss-${config.region}.aliyuncs.com/${uriEncode(key, false)}`;
  const res = await options.fetch(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  if (res.status !== HTTP_OK) throw new Error(`上传 ${key} 失败：HTTP ${res.status} ${ossError(await res.text())}`);
  const etag = (res.headers.get('etag') ?? '').replaceAll('"', '').toLowerCase();
  if (etag !== md5Hex) throw new Error(`上传 ${key} 后 ETag 不符：应为 ${md5Hex}，实为 ${etag}`);
}

/** 服务器上的 upload：加密最新的一份备份，上传日备与月备；返回打出的各行（行首为 systemd 的级别前缀） */
export async function upload(env: NodeJS.ProcessEnv, options: { fetch: Fetch; now: () => Date }) {
  const config = readConfig(env);
  const { file, data } = latestBackup(config.backupDir);
  const body = await encrypt(data, config.recipient);
  const keys = objectKeys(file);
  for (const key of keys) await putObject(config, key, body, options);
  return `<6>异地备份已上传：${path.basename(file)}（加密后 ${body.length} 字节）→ oss://${config.bucket}/{${keys.join(',')}}`;
}

/** 本机的 keygen：私钥写入 out（不覆盖已有文件，权限 600），返回公钥 */
export async function keygen(out: string) {
  const identity = await generateIdentity();
  fs.writeFileSync(out, identity + '\n', { flag: 'wx', mode: 0o600 });
  return identityToRecipient(identity);
}

/** 命令行入口 */
async function main(argv: string[]) {
  const [cmd, ...args] = argv;
  if (cmd === 'upload') {
    console.log(await upload(process.env, { fetch: globalThis.fetch as unknown as Fetch, now: () => new Date() }));
  } else if (cmd === 'keygen' && args.length === 1) {
    const recipient = await keygen(args[0]);
    console.log(`私钥已写入 ${args[0]}，请妥善保存在本机或密码管理器中，严禁放到服务器上（DAT-063）。\n公钥（安装异地备份时填写）：${recipient}`);
  } else if (cmd === 'decrypt' && args.length === DECRYPT_ARGS) {
    const text = await decrypt(fs.readFileSync(args[0]), fs.readFileSync(args[1], 'utf8').trim());
    fs.writeFileSync(args[2], text, { flag: 'wx', mode: 0o600 });
    console.log(`已解密为 ${args[2]}（${Object.keys(JSON.parse(text)).length} 条记录）`);
  } else {
    throw new Error('用法：upload | keygen 私钥文件 | decrypt 备份.age 私钥文件 输出文件');
  }
}

if (process.argv[1] && /offsite\.(ts|cjs)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((err: Error) => {
    console.error(`<3>${process.argv[2] === 'upload' ? '异地备份失败' : '失败'}：${err.message}`);
    process.exitCode = 1;
  });
}
