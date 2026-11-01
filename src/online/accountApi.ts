/**
 * 账号接口的客户端（docs/plan/account-api.md）：按契约发请求、逐项校验回应（API-016 的原则同样适用于 HTTP），
 * 把 RFC 9457 错误转为错误码；网络中断、超时或回应不合格一律按 server.internal 处理（契约第 5.2.2 条）。
 * 不保存登录状态，令牌由调用者传入；登录状态见 account.ts。fetch 由调用者注入，便于测试。
 */
import { bool, isRecord, match, text } from '../shared/check';
import { ERRORS, type ErrorLevel } from '../shared/errors';
import { parsePublicId } from '../shared/publicId';

/** 契约中的邮件语言（I18N-001 的语言标记） */
export type MailLanguage = 'zh-Hans' | 'lzh' | 'en-GB';
/** 验证码的用途 */
export type CodePurpose = 'register' | 'reset';

/** 一次失败：错误码、级别与可选的附加内容；status 为 0 表示没有收到合格的回应 */
export interface AccountProblem {
  status: number;
  code: string;
  level: ErrorLevel;
  retryAfterMs?: number;
  field?: string;
  errorId?: string;
}

/** 接口调用的结果 */
export type AccountResult<T> = { ok: true; value: T } | { ok: false; problem: AccountProblem };

/** 当前账号的公开资料（契约第 4 章） */
export interface AccountUser {
  publicId: string;
  name: string;
  emailVerified: boolean;
  consentsCurrent: boolean;
  onlineAllowed: boolean;
}

/** 登录或注册成功：令牌、绝对期限与资料 */
export interface SignedIn {
  token: string;
  expiresAt: string;
  user: AccountUser;
}

/** 必需协议的版本与官网地址 */
export interface RequiredConsents {
  privacy: string;
  terms: string;
  privacyUrl: string;
  termsUrl: string;
}

/** 验证码受理结果 */
export interface CodeAdmission {
  challengeId: string;
  expiresAt: string;
  resendAfterMs: number;
}

/** 验证码邮件的发送进度 */
export type CodeState = 'pending' | 'sent' | 'retry';

/** 注册表单 */
export interface RegisterForm {
  name: string;
  email: string;
  password: string;
  challengeId: string;
  code: string;
  consent: { accepted: true; privacy: string; terms: string };
}

/** 注入的请求函数：与 window.fetch 相同的签名 */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const HEX_ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{32}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const URL_MAX = 200;
/** 官网的主机：文书页面所在 */
const OFFICIAL_SITE = 'yi.lightking.com.cn';
const NAME_MAX = 64;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$/;
const LEVELS: readonly string[] = ['E1', 'E2', 'E3', 'E4', 'E5'];
/** 回应中的错误级别 */
const isLevel = (val: unknown): val is ErrorLevel => typeof val === 'string' && LEVELS.includes(val);
/** 一次请求的最长等待；超过即中止并按 server.internal 处理 */
export const REQUEST_TIMEOUT_MS = 15_000;
const NO_CONTENT = 204;
/** 没有收到合格回应时的错误 */
const OFFLINE: AccountProblem = { status: 0, code: 'server.internal', level: 'E5' };

/** 由联机地址推出账号接口的地址：wss://主机/… → https://主机/api/v1，ws:// → http://（本机测试）；不合格时为 undefined */
export function apiBase(server: string): string | undefined {
  try {
    const url = new URL(server);
    const scheme = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : undefined;
    return scheme ? `${scheme}//${url.host}/api/v1` : undefined;
  } catch {
    return undefined; // 地址不合格：账号功能不可用，调用者据此不显示入口
  }
}

/** 资料对象：只接受契约中的字段，公开 UID 须为规范值 */
export function parseUser(raw: unknown): AccountUser | undefined {
  if (!isRecord(raw)) return undefined;
  const { publicId, name, emailVerified, consentsCurrent, onlineAllowed } = raw;
  if (typeof publicId !== 'string' || parsePublicId(publicId) !== publicId || !text(NAME_MAX)(name) || !name) return undefined;
  if (!bool(emailVerified) || !bool(consentsCurrent) || !bool(onlineAllowed)) return undefined;
  return { publicId, name, emailVerified, consentsCurrent, onlineAllowed };
}

/** 登录或注册的回应 */
function parseSignedIn(raw: unknown): SignedIn | undefined {
  if (!isRecord(raw) || !match(TOKEN)(raw.token) || !match(ISO_UTC)(raw.expiresAt)) return undefined;
  const user = parseUser(raw.user);
  return user ? { token: raw.token, expiresAt: raw.expiresAt, user } : undefined;
}

/** 错误回应：错误码与级别来自回应；级别未知时按错误码表，再不知道时按 E5（API-024） */
export function parseProblem(status: number, raw: unknown): AccountProblem {
  if (!isRecord(raw) || typeof raw.code !== 'string' || !/^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/.test(raw.code)) return { ...OFFLINE, status };
  const known: Record<string, { level: ErrorLevel }> = ERRORS;
  const level = isLevel(raw.level) ? raw.level : (known[raw.code]?.level ?? 'E5');
  const problem: AccountProblem = { status, code: raw.code, level };
  if (typeof raw.retryAfterMs === 'number' && Number.isSafeInteger(raw.retryAfterMs) && raw.retryAfterMs >= 0) problem.retryAfterMs = raw.retryAfterMs;
  if (isRecord(raw.params) && typeof raw.params.field === 'string') problem.field = raw.params.field;
  if (match(/^[0-9a-f-]{36}$/)(raw.errorId)) problem.errorId = raw.errorId;
  return problem;
}

/** 账号接口；base 为 apiBase 的结果 */
export class AccountApi {
  constructor(
    private readonly base: string,
    private readonly fetcher: Fetcher,
  ) {}

  /** 当前必需的协议版本 */
  requiredConsents(): Promise<AccountResult<RequiredConsents>> {
    return this.call('GET', '/consents/required', {}, raw => {
      if (!isRecord(raw) || !match(VERSION)(raw.privacy) || !match(VERSION)(raw.terms)) return undefined;
      if (!this.siteUrl(raw.privacyUrl) || !this.siteUrl(raw.termsUrl)) return undefined;
      return { privacy: raw.privacy, terms: raw.terms, privacyUrl: raw.privacyUrl, termsUrl: raw.termsUrl };
    });
  }

  /** 申请验证码 */
  requestCode(purpose: CodePurpose, email: string, language: MailLanguage): Promise<AccountResult<CodeAdmission>> {
    return this.call('POST', '/email-codes', { body: { purpose, email, language } }, raw => {
      if (!isRecord(raw) || !match(HEX_ID)(raw.challengeId) || !match(ISO_UTC)(raw.expiresAt)) return undefined;
      const wait = raw.resendAfterMs;
      if (typeof wait !== 'number' || !Number.isSafeInteger(wait) || wait < 0) return undefined;
      return { challengeId: raw.challengeId, expiresAt: raw.expiresAt, resendAfterMs: wait };
    });
  }

  /** 验证码邮件的发送进度 */
  codeState(challengeId: string): Promise<AccountResult<CodeState>> {
    if (!HEX_ID.test(challengeId)) return Promise.resolve({ ok: false, problem: { status: 0, code: 'code.not-found', level: 'E2' } });
    return this.call('GET', `/email-codes/${challengeId}`, {}, raw => {
      const state = isRecord(raw) ? raw.state : undefined;
      return state === 'pending' || state === 'sent' || state === 'retry' ? state : undefined;
    });
  }

  /** 注册并登录 */
  register(form: RegisterForm): Promise<AccountResult<SignedIn>> {
    return this.call('POST', '/accounts', { body: form }, parseSignedIn);
  }

  /** 邮箱与密码登录 */
  login(email: string, password: string): Promise<AccountResult<SignedIn>> {
    return this.call('POST', '/sessions', { body: { email, password } }, parseSignedIn);
  }

  /** 退出当前登录 */
  logout(token: string): Promise<AccountResult<void>> {
    return this.callEmpty('DELETE', '/sessions/current', { token });
  }

  /** 以验证码重置密码 */
  resetPassword(form: { email: string; password: string; challengeId: string; code: string }): Promise<AccountResult<void>> {
    return this.callEmpty('POST', '/password-resets', { body: form });
  }

  /** 当前资料 */
  me(token: string): Promise<AccountResult<AccountUser>> {
    return this.call('GET', '/me', { token }, parseUser);
  }

  /** 修改雅号 */
  rename(token: string, name: string): Promise<AccountResult<AccountUser>> {
    return this.call('PUT', '/me/name', { token, body: { name } }, parseUser);
  }

  /** 以旧密码修改密码；成功后全部会话失效 */
  changePassword(token: string, oldPassword: string, password: string): Promise<AccountResult<void>> {
    return this.callEmpty('PUT', '/me/password', { token, body: { oldPassword, password } });
  }

  /** 同意当前必需的协议版本 */
  acceptConsents(token: string, consent: RegisterForm['consent']): Promise<AccountResult<AccountUser>> {
    return this.call('POST', '/me/consents', { token, body: consent }, parseUser);
  }

  /** 官网上的文书地址：只接受官网或与接口同一主机（本机调试时）的 https 地址 */
  private siteUrl(raw: unknown): raw is string {
    if (!text(URL_MAX)(raw)) return false;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && (url.host === OFFICIAL_SITE || url.host === new URL(this.base).host);
    } catch {
      return false; // 不是网址：回应不合格
    }
  }

  /** 发一次请求，成功时以 parse 校验回应；失败时转为错误码，回应不合格时为 server.internal */
  private async call<T>(method: string, path: string, opt: Send, parse: (raw: unknown) => T | undefined): Promise<AccountResult<T>> {
    const sent = await this.send(method, path, opt);
    if (!sent.ok) return sent;
    const value = parse(sent.value.raw);
    return value === undefined ? { ok: false, problem: { ...OFFLINE, status: sent.value.status } } : { ok: true, value };
  }

  /** 成功时没有回应体的请求：只接受 204 */
  private async callEmpty(method: string, path: string, opt: Send): Promise<AccountResult<void>> {
    const sent = await this.send(method, path, opt);
    if (!sent.ok) return sent;
    return sent.value.status === NO_CONTENT ? { ok: true, value: undefined } : { ok: false, problem: { ...OFFLINE, status: sent.value.status } };
  }

  /** 发出请求并读回应；请求超时、网络中断时为 server.internal，非 2xx 时转为错误码 */
  private async send(method: string, path: string, opt: Send): Promise<AccountResult<{ status: number; raw: unknown }>> {
    const headers: Record<string, string> = {};
    if (opt.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opt.token !== undefined) headers.Authorization = `Bearer ${opt.token}`;
    const body = opt.body === undefined ? undefined : JSON.stringify(opt.body);
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      return { ok: false, problem: OFFLINE }; // 网络中断或超时：不清除保存的登录（契约第 5.2.2 条）
    }
    const raw = await readJson(response);
    return response.ok ? { ok: true, value: { status: response.status, raw } } : { ok: false, problem: parseProblem(response.status, raw) };
  }
}

/** 一次请求的令牌与请求体 */
interface Send {
  token?: string;
  body?: unknown;
}

/** 读回应体为 JSON；没有内容或不是 JSON 时为 undefined */
async function readJson(response: Response): Promise<unknown> {
  try {
    const body = await response.text();
    return body ? (JSON.parse(body) as unknown) : undefined;
  } catch {
    return undefined; // 回应不是 JSON：由调用者按不合格处理
  }
}
