/**
 * 开发用的账号接口替身：在页面内按契约（docs/plan/account-api.md）回应账号请求，不连服务端、不发邮件。
 * 供界面文字排版检查（fit-driver.ts）走遍账号各屏，也可在开发服务器的页面中手工试用：
 *   const m = await import('/scripts/account-stub.ts'); m.startStub();
 * 约定：验证码 000000 视为错误，其余六位数字均有效；邮箱 taken@example.com 视为已注册；密码 wrong-password 视为错误。
 */
import { startAccounts } from '../src/app/account';
import type { Fetcher } from '../src/online/accountApi';

/** 替身的状态：stale 为真时资料显示协议待补签 */
export const stub = { name: '黑白', stale: false, signedIn: false };

/** 用到的 HTTP 状态码 */
const HTTP = { ok: 200, created: 201, accepted: 202, noContent: 204, unauthorized: 401, notFound: 404, conflict: 409, unprocessable: 422 } as const;
const TOKEN_REPEAT = 16;
const TOKEN = 'a1'.repeat(TOKEN_REPEAT);
const CHALLENGE = 'c0'.repeat(TOKEN_REPEAT);
/** 验证码的有效期与重发间隔、登录的有效期，与服务端默认值一致 */
const CODE_TTL_MS = 600_000;
const RESEND_MS = 60_000;
const LOGIN_TTL_MS = 2_592_000_000;
const SITE = 'https://yi.lightking.com.cn';
const BAD_CODE = '000000';
const BAD_PASSWORD = 'wrong-password';

type Body = Record<string, unknown>;

const user = () => ({ publicId: '7KM4P9D2', name: stub.name, emailVerified: true, consentsCurrent: !stub.stale, onlineAllowed: true });
const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, code: string) => reply(status, { code, level: 'E2' });
const signedIn = () => {
  stub.signedIn = true;
  return reply(HTTP.created, { token: TOKEN, expiresAt: new Date(Date.now() + LOGIN_TTL_MS).toISOString(), user: user() });
};

type Handler = (body: Body) => Response;

/** 不需要登录的请求 */
const OPEN = new Map<string, Handler>([
  [
    'GET /consents/required',
    () =>
      reply(HTTP.ok, { privacy: '2026-10-31', terms: '2026-10-31', privacyUrl: `${SITE}/legal/privacy-policy/`, termsUrl: `${SITE}/legal/terms-of-service/` }),
  ],
  [
    'POST /email-codes',
    () => reply(HTTP.accepted, { challengeId: CHALLENGE, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), resendAfterMs: RESEND_MS }),
  ],
  [`GET /email-codes/${CHALLENGE}`, () => reply(HTTP.ok, { state: 'sent' })],
  [
    'POST /accounts',
    body => {
      if (body.code === BAD_CODE) return problem(HTTP.unprocessable, 'code.invalid');
      if (body.email === 'taken@example.com') return problem(HTTP.conflict, 'account.email-taken');
      stub.name = String(body.name);
      return signedIn();
    },
  ],
  ['POST /sessions', body => (body.password === BAD_PASSWORD ? problem(HTTP.unauthorized, 'auth.credentials-invalid') : signedIn())],
  ['POST /password-resets', body => (body.code === BAD_CODE ? problem(HTTP.unprocessable, 'code.invalid') : reply(HTTP.noContent))],
  [
    'DELETE /sessions/current',
    () => {
      stub.signedIn = false;
      return reply(HTTP.noContent);
    },
  ],
]);

/** 需要登录的请求 */
const AUTHED = new Map<string, Handler>([
  ['GET /me', () => reply(HTTP.ok, user())],
  [
    'PUT /me/name',
    body => {
      stub.name = String(body.name);
      return reply(HTTP.ok, user());
    },
  ],
  [
    'PUT /me/password',
    body => {
      if (body.oldPassword === BAD_PASSWORD) return problem(HTTP.unauthorized, 'auth.credentials-invalid');
      stub.signedIn = false;
      return reply(HTTP.noContent);
    },
  ],
  [
    'POST /me/consents',
    () => {
      stub.stale = false;
      return reply(HTTP.ok, user());
    },
  ],
]);

/** 按方法与路径回应 */
const stubFetch: Fetcher = async (url, init) => {
  const key = `${init.method ?? 'GET'} ${new URL(url).pathname.replace(/^\/api\/v1/, '')}`;
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Body) : {};
  const open = OPEN.get(key),
    authed = AUTHED.get(key);
  if (open) return open(body);
  if (!authed) return problem(HTTP.notFound, 'request.invalid');
  return stub.signedIn ? authed(body) : problem(HTTP.unauthorized, 'auth.required');
};

/** 以替身开启账号功能（页面中只需调用一次） */
export function startStub() {
  return startAccounts({ server: 'ws://127.0.0.1:1', fetcher: stubFetch });
}
