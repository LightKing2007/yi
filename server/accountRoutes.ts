/**
 * 账号接口各路径的处理（账号接口契约第 3 章）：逐字段校验请求，调用认证与验证码业务，把业务结果映射为状态码与错误码。
 * 通用的读取、来源与错误响应在 apiHttp.ts，入口与分发在 accountApi.ts。
 */
import type { IncomingMessage } from 'node:http';
import { isRecord } from '../src/shared/check';
import { accountName, accountPassword } from './accountInput';
import { ApiProblem, bearer, invalidField, SITE_ORIGIN, type Problem } from './apiHttp';
import { AuthenticationError, type AccountProfile, type Authentication } from './authentication';
import { DEFAULT_MAIL_LANGUAGE, MAIL_LANGUAGES, type MailLanguage } from './codeMailText';
import type { RequiredConsents } from './db/consents';
import { normalizeEmail } from './emailAddress';
import type { EmailCodes } from './emailCodes';
import { PasswordBusyError } from './passwords';

const HEX_ID = /^[0-9a-f]{32}$/;
const CODE = /^[0-9]{6}$/;
const EMAIL_MAX_BYTES = 254;
/** 密码任务忙时建议的等待时长 */
const BUSY_RETRY_MS = 1000;

/** 路由所需的业务与配置 */
export interface RouteDeps {
  auth: Authentication;
  codes: EmailCodes;
  required: RequiredConsents;
  /** 验证码受理后调用，由装配层安排异步发送 */
  queued?: (challengeId: string, language: MailLanguage) => void;
}

/** 一次已通过来源与方法检查的调用 */
export interface Call {
  req: IncomingMessage;
  body: Record<string, unknown>;
  source: string;
  param?: string;
}

/** 成功的结果；body 为空时响应 204 */
export interface Reply {
  status: number;
  body?: unknown;
}

/** 某个路径上某个方法的处理；fields 为请求体的已知字段，undefined 表示不带请求体 */
export interface Handler {
  fields?: readonly string[];
  run: (call: Call, deps: RouteDeps) => Reply | Promise<Reply>;
}

const fail = (problem: Problem) => new ApiProblem(problem);
const LOGIN_REQUIRED: Problem = { status: 401, code: 'auth.required' };

/** 邮箱字段：字符串、字节上限且能规范化 */
function email(body: Record<string, unknown>): string {
  const value = body.email;
  if (typeof value !== 'string' || Buffer.byteLength(value) > EMAIL_MAX_BYTES || !normalizeEmail(value)) throw invalidField('email');
  return value;
}

/** 密码字段；creation 时按新密码的最低长度检查 */
function password(body: Record<string, unknown>, field: string, creation: boolean): string {
  const value = accountPassword(body[field], creation);
  if (value === undefined) throw invalidField(field);
  return value;
}

/** 按正则检查的字符串字段 */
function matched(body: Record<string, unknown>, field: string, format: RegExp): string {
  const value = body[field];
  if (typeof value !== 'string' || !format.test(value)) throw invalidField(field);
  return value;
}

/** 雅号字段 */
function name(body: Record<string, unknown>): string {
  if (!accountName(body.name)) throw invalidField('name');
  return String(body.name);
}

/** 需要登录的调用：令牌由入口解析，缺失时直接 401 */
function token(call: Call): string {
  const value = bearer(call.req);
  if (!value) throw fail(LOGIN_REQUIRED);
  return value;
}

/** 认证业务失败映射为错误响应；denied 的含义随接口不同，由调用者给出 */
function mapped(error: unknown, denied: Problem): never {
  if (error instanceof PasswordBusyError) throw fail({ status: 503, code: 'auth.busy', retryAfterMs: BUSY_RETRY_MS });
  if (!(error instanceof AuthenticationError)) throw error;
  const table: Record<AuthenticationError['reason'], Problem> = {
    invalid: { status: 400, code: 'request.invalid' },
    denied,
    consent: { status: 422, code: 'consent.outdated' },
    limited: { status: 429, code: 'rate.limited', retryAfterMs: error.retryAfterMs },
    taken: { status: 409, code: 'account.email-taken' },
    session: LOGIN_REQUIRED,
  };
  throw fail(table[error.reason]);
}

/** 毫秒时刻转为 RFC 3339 UTC 字符串（API-062） */
const iso = (ms: number) => new Date(ms).toISOString();

/** 登录或注册成功的响应体 */
const signedIn = (result: { token: string; expiresAt: number; user: AccountProfile }): Reply => ({
  status: 201,
  body: { token: result.token, expiresAt: iso(result.expiresAt), user: result.user },
});

const CODE_INVALID: Problem = { status: 422, code: 'code.invalid' };

/** POST /api/v1/email-codes：统一受理，不透露账号是否存在（契约第 3.3 条）；language 缺省时为中文 */
const requestCode: Handler = {
  fields: ['purpose', 'email', 'language'],
  run: ({ body, source }, deps) => {
    const purpose = body.purpose;
    if (purpose !== 'register' && purpose !== 'reset') throw invalidField('purpose');
    const language = MAIL_LANGUAGES.find(item => item === (body.language === undefined ? DEFAULT_MAIL_LANGUAGE : body.language));
    if (!language) throw invalidField('language');
    const admission = deps.codes.request({ email: email(body), purpose, sourceHash: source });
    if ('retryAfterMs' in admission) throw fail({ status: 429, code: 'rate.limited', retryAfterMs: admission.retryAfterMs });
    deps.queued?.(admission.challengeId, language);
    return { status: 202, body: { challengeId: admission.challengeId, expiresAt: iso(admission.expiresAt), resendAfterMs: admission.resendAfterMs } };
  },
};

/** GET /api/v1/email-codes/{challengeId}：只读的发送进度（契约第 3.4 条） */
const codeDelivery: Handler = {
  run: ({ param }, deps) => {
    const found = param && HEX_ID.test(param) ? deps.codes.delivery(param) : undefined;
    if (!found) throw fail({ status: 404, code: 'code.not-found' });
    return { status: 200, body: { state: found.state, expiresAt: iso(found.expiresAt) } };
  },
};

/** POST /api/v1/accounts：注册并登录（契约第 3.5 条） */
const register: Handler = {
  fields: ['name', 'email', 'password', 'challengeId', 'code', 'consent'],
  run: async ({ body, source }, deps) => {
    const input = {
      name: name(body),
      email: email(body),
      password: password(body, 'password', true),
      challengeId: matched(body, 'challengeId', HEX_ID),
      code: matched(body, 'code', CODE),
      consent: isRecord(body.consent) ? body.consent : undefined,
      sourceHash: source,
    };
    if (!input.consent) throw invalidField('consent');
    try {
      return signedIn(await deps.auth.register(input));
    } catch (error) {
      return mapped(error, CODE_INVALID);
    }
  },
};

/** POST /api/v1/sessions：邮箱与密码登录（契约第 3.6 条） */
const login: Handler = {
  fields: ['email', 'password'],
  run: async ({ body, source }, deps) => {
    const input = { email: email(body), password: password(body, 'password', false), sourceHash: source };
    try {
      return signedIn(await deps.auth.login(input));
    } catch (error) {
      return mapped(error, { status: 401, code: 'auth.credentials-invalid' });
    }
  },
};

/** DELETE /api/v1/sessions/current：已失效的令牌同样 204，退出可以安全重试（契约第 3.7 条） */
const logout: Handler = {
  run: (call, deps) => {
    deps.auth.logout(token(call));
    return { status: 204 };
  },
};

/** POST /api/v1/password-resets：账号是否存在都返回 204（契约第 3.8 条） */
const reset: Handler = {
  fields: ['email', 'password', 'challengeId', 'code'],
  run: async ({ body, source }, deps) => {
    const input = {
      email: email(body),
      password: password(body, 'password', true),
      challengeId: matched(body, 'challengeId', HEX_ID),
      code: matched(body, 'code', CODE),
      sourceHash: source,
    };
    try {
      await deps.auth.reset(input);
      return { status: 204 };
    } catch (error) {
      return mapped(error, CODE_INVALID);
    }
  },
};

/** GET /api/v1/me：只读，不延长闲置期限（契约第 3.9 条） */
const me: Handler = {
  run: (call, deps) => {
    const user = deps.auth.me(token(call));
    if (!user) throw fail(LOGIN_REQUIRED);
    return { status: 200, body: user };
  },
};

/** PUT /api/v1/me/name（契约第 3.10 条） */
const rename: Handler = {
  fields: ['name'],
  run: (call, deps) => {
    const value = name(call.body);
    try {
      return { status: 200, body: deps.auth.rename(token(call), value) };
    } catch (error) {
      return mapped(error, LOGIN_REQUIRED);
    }
  },
};

/** PUT /api/v1/me/password：旧密码错误与令牌失效是两个错误码（契约第 3.11.1 条） */
const changePassword: Handler = {
  fields: ['oldPassword', 'password'],
  run: async (call, deps) => {
    const input = {
      token: token(call),
      oldPassword: password(call.body, 'oldPassword', false),
      password: password(call.body, 'password', true),
      sourceHash: call.source,
    };
    try {
      await deps.auth.changePassword(input);
      return { status: 204 };
    } catch (error) {
      return mapped(error, { status: 401, code: 'auth.credentials-invalid' });
    }
  },
};

/** POST /api/v1/me/consents：先确认登录有效，再区分版本不符（契约第 3.11.2 条） */
const consents: Handler = {
  fields: ['accepted', 'privacy', 'terms'],
  run: (call, deps) => {
    const value = token(call);
    if (!deps.auth.me(value)) throw fail(LOGIN_REQUIRED);
    if (!deps.auth.acceptConsents(value, call.body)) throw fail({ status: 422, code: 'consent.outdated' });
    return { status: 200, body: deps.auth.me(value) };
  },
};

/** GET /api/v1/consents/required：当前必需版本与官网地址（契约第 3.2 条） */
const required: Handler = {
  run: (_call, deps) => ({
    status: 200,
    body: {
      privacy: deps.required.privacy,
      terms: deps.required.terms,
      privacyUrl: `${SITE_ORIGIN}/agreement/privacy-policy`,
      termsUrl: `${SITE_ORIGIN}/agreement/terms-of-service`,
    },
  }),
};

/** 路径到各方法的处理；带参数的路径以 {} 占位（契约第 3.1 条）。注销 DELETE /api/v1/me 尚未实现，不列出 */
export const ROUTES: Readonly<Record<string, Readonly<Record<string, Handler>>>> = {
  '/api/v1/consents/required': { GET: required },
  '/api/v1/email-codes': { POST: requestCode },
  '/api/v1/email-codes/{}': { GET: codeDelivery },
  '/api/v1/accounts': { POST: register },
  '/api/v1/sessions': { POST: login },
  '/api/v1/sessions/current': { DELETE: logout },
  '/api/v1/password-resets': { POST: reset },
  '/api/v1/me': { GET: me },
  '/api/v1/me/name': { PUT: rename },
  '/api/v1/me/password': { PUT: changePassword },
  '/api/v1/me/consents': { POST: consents },
};
