/** 账号 HTTP 接口：真实 SQLite 与本机真实 HTTP，覆盖契约第 3 章的每个接口及每个错误码（API-022）。 */
import { createHmac } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { CODE_COOLDOWN_MS, CODE_TTL_MS } from '../server/authPolicy';
import { PasswordBusyError } from '../server/passwords';
import { ERRORS } from '../src/shared/errors';
import { AccountApiWorld, type Answer } from './accountApiWorld';

const worlds: AccountApiWorld[] = [];
const world = async () => {
  const value = new AccountApiWorld();
  worlds.push(value);
  return value.start();
};
afterEach(async () => {
  for (const value of worlds.splice(0)) await value.stop();
});

/** 错误响应的公共形状：problem+json、级别取自错误码表、不缓存 */
function problem(answer: Answer, status: number, code: keyof typeof ERRORS) {
  expect(answer.status).toBe(status);
  expect(answer.headers['content-type']).toBe('application/problem+json; charset=utf-8');
  expect(answer.headers['cache-control']).toBe('no-store');
  expect(answer.headers['x-content-type-options']).toBe('nosniff');
  expect(answer.headers['referrer-policy']).toBe('no-referrer');
  expect(answer.json).toMatchObject({ type: `https://yi.lightking.com.cn/errors/${code}`, status, code, level: ERRORS[code].level });
}

const form = (proof: { challengeId: string; code: string }, email = 'new@example.com') => ({
  name: '棋友',
  email,
  password: 'new-password',
  ...proof,
  consent: { accepted: true, privacy: 'v1', terms: 'v1' },
});

it('注册、资料、改名、补签、改密、登录与退出走通，响应只含契约字段', async () => {
  const ctx = await world();
  expect((await ctx.ask('GET', '/api/v1/consents/required')).json).toEqual({
    privacy: 'v1',
    terms: 'v1',
    privacyUrl: 'https://yi.lightking.com.cn/privacy-policy',
    termsUrl: 'https://yi.lightking.com.cn/terms-of-service',
  });
  const admitted = await ctx.ask('POST', '/api/v1/email-codes', { body: { purpose: 'register', email: 'new@example.com' } });
  expect(admitted.status).toBe(202);
  expect(admitted.json).toEqual({ challengeId: ctx.queued[0], expiresAt: new Date(ctx.now + CODE_TTL_MS).toISOString(), resendAfterMs: CODE_COOLDOWN_MS });
  const id = String(admitted.json.challengeId);
  expect((await ctx.ask('GET', `/api/v1/email-codes/${id}`)).json).toEqual({ state: 'pending', expiresAt: admitted.json.expiresAt });
  await ctx.codes.deliver(id);
  expect((await ctx.ask('GET', `/api/v1/email-codes/${id}`)).json.state).toBe('sent');
  const created = await ctx.ask('POST', '/api/v1/accounts', { body: form({ challengeId: id, code: '001234' }) });
  expect(created.status).toBe(201);
  expect(Object.keys(created.json).sort()).toEqual(['expiresAt', 'token', 'user']);
  expect(created.json.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const token = String(created.json.token);
  const me = await ctx.ask('GET', '/api/v1/me', { token });
  expect(me.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(me.headers['cache-control']).toBe('no-store');
  expect(Object.keys(me.json).sort()).toEqual(['consentsCurrent', 'emailVerified', 'name', 'onlineAllowed', 'publicId']);
  expect((await ctx.ask('PUT', '/api/v1/me/name', { token, body: { name: '新雅号' } })).json).toMatchObject({ name: '新雅号', publicId: me.json.publicId });
  expect((await ctx.ask('POST', '/api/v1/me/consents', { token, body: { accepted: true, privacy: 'v1', terms: 'v1' } })).status).toBe(200);
  const changed = await ctx.ask('PUT', '/api/v1/me/password', { token, body: { oldPassword: 'new-password', password: 'old-password' } });
  expect([changed.status, changed.text]).toEqual([204, '']);
  problem(await ctx.ask('GET', '/api/v1/me', { token }), 401, 'auth.required');
  ctx.passwords.verify.mockResolvedValue(true);
  const login = await ctx.ask('POST', '/api/v1/sessions', { body: { email: 'new@example.com', password: 'old-password' } });
  expect(login.status).toBe(201);
  const session = String(login.json.token);
  expect((await ctx.ask('DELETE', '/api/v1/sessions/current', { token: session })).status).toBe(204);
  expect((await ctx.ask('DELETE', '/api/v1/sessions/current', { token: session })).status).toBe(204);
  problem(await ctx.ask('GET', '/api/v1/me', { token: session }), 401, 'auth.required');
});

it('业务拒绝映射为契约错误码：邮箱已注册、验证码无效、协议过期、密码错误、找不到验证码', async () => {
  const ctx = await world();
  const taken = await ctx.mailed('player@example.com');
  problem(await ctx.ask('POST', '/api/v1/accounts', { body: form(taken, 'player@example.com') }), 409, 'account.email-taken');
  const proof = await ctx.mailed('new@example.com');
  problem(await ctx.ask('POST', '/api/v1/accounts', { body: form({ ...proof, code: '999999' }) }), 422, 'code.invalid');
  problem(
    await ctx.ask('POST', '/api/v1/accounts', { body: { ...form(proof), consent: { accepted: true, privacy: 'v0', terms: 'v1' } } }),
    422,
    'consent.outdated',
  );
  problem(
    await ctx.ask('POST', '/api/v1/password-resets', { body: { email: 'new@example.com', password: 'new-password', ...proof, code: '999999' } }),
    422,
    'code.invalid',
  );
  problem(await ctx.ask('POST', '/api/v1/sessions', { body: { email: 'player@example.com', password: 'wrong-password' } }), 401, 'auth.credentials-invalid');
  const token = String((await ctx.ask('POST', '/api/v1/sessions', { body: { email: 'player@example.com', password: 'old-password' } })).json.token);
  problem(
    await ctx.ask('PUT', '/api/v1/me/password', { token, body: { oldPassword: 'wrong-password', password: 'new-password' } }),
    401,
    'auth.credentials-invalid',
  );
  problem(await ctx.ask('POST', '/api/v1/me/consents', { token, body: { accepted: true, privacy: 'v0', terms: 'v1' } }), 422, 'consent.outdated');
  problem(await ctx.ask('GET', `/api/v1/email-codes/${'f'.repeat(32)}`), 404, 'code.not-found');
  problem(await ctx.ask('GET', '/api/v1/email-codes/not-hex'), 404, 'code.not-found');
  ctx.now += CODE_COOLDOWN_MS; // 同一邮箱的冷却不分用途
  const reset = await ctx.mailed('player@example.com', 'reset');
  const done = await ctx.ask('POST', '/api/v1/password-resets', { body: { email: 'player@example.com', password: 'new-password', ...reset } });
  expect(done.status).toBe(204);
  problem(await ctx.ask('GET', '/api/v1/me', { token }), 401, 'auth.required');
});

it('限流为 429，Retry-After 秒数与 retryAfterMs 一致；来源标识按真实地址计算', async () => {
  const ctx = await world();
  await ctx.ask('POST', '/api/v1/email-codes', { body: { purpose: 'register', email: 'a@example.com' } });
  const limited = await ctx.ask('POST', '/api/v1/email-codes', { body: { purpose: 'register', email: 'a@example.com' } });
  problem(limited, 429, 'rate.limited');
  expect([limited.json.retryAfterMs, limited.headers['retry-after']]).toEqual([CODE_COOLDOWN_MS, String(CODE_COOLDOWN_MS / 1000)]);
  await ctx.ask('POST', '/api/v1/sessions', {
    body: { email: 'player@example.com', password: 'wrong-password' },
    headers: { 'X-Forwarded-For': '203.0.113.9' },
  });
  const subjects = ctx.db.prepare("SELECT subject_hash FROM auth_limits WHERE scope IN ('code-ip', 'login-ip') ORDER BY scope").all();
  const hmac = (ip: string) => createHmac('sha256', ctx.sourceKey).update(ip).digest('hex');
  expect(subjects.map(row => row.subject_hash)).toEqual([hmac('127.0.0.1'), hmac('203.0.113.9')]);
  for (let i = 0; i < 10; i++) await ctx.ask('POST', '/api/v1/sessions', { body: { email: 'player@example.com', password: 'old-password' } });
  ctx.now += 500;
  const partial = await ctx.ask('POST', '/api/v1/sessions', { body: { email: 'player@example.com', password: 'old-password' } });
  problem(partial, 429, 'rate.limited');
  expect([partial.json.retryAfterMs, partial.headers['retry-after']]).toEqual([59500, '60']);
});

it('请求格式不符为 400，指出首个出错字段；GET 带请求体同样拒绝', async () => {
  const ctx = await world();
  const path = '/api/v1/sessions';
  const valid = { email: 'player@example.com', password: 'old-password' };
  // 整体不合格的请求体不指明字段，区别于字段校验失败
  const whole = async (body: unknown, headers?: Record<string, string>) => {
    const answer = await ctx.ask('POST', path, { body, headers });
    problem(answer, 400, 'request.invalid');
    expect(answer.json.params).toBeUndefined();
  };
  await whole(valid, { 'Content-Type': 'text/plain' });
  expect((await ctx.ask('POST', path, { body: valid, headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status).toBe(201);
  await whole('{"email":');
  await whole(JSON.stringify([valid]));
  const utf8 = Buffer.from(JSON.stringify({ ...valid, pad: '#' }));
  utf8[utf8.indexOf('#')] = 0xff;
  await whole(utf8);
  const extra = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`x${i}`, i]));
  problem(await ctx.ask('POST', path, { body: { ...valid, ...extra } }), 400, 'request.invalid');
  expect((await ctx.ask('POST', path, { body: { ...valid, ...Object.fromEntries(Object.entries(extra).slice(1)) } })).status).toBe(201);
  const field = await ctx.ask('POST', '/api/v1/accounts', { body: { ...form({ challengeId: 'x', code: '001234' }), name: '\u202e棋' } });
  problem(field, 400, 'request.invalid');
  expect(field.json.params).toEqual({ field: 'name' });
  const unsigned = { ...form({ challengeId: '0'.repeat(32), code: '001234' }), consent: undefined };
  expect((await ctx.ask('POST', '/api/v1/accounts', { body: unsigned })).json.params).toEqual({ field: 'consent' });
  expect((await ctx.ask('POST', '/api/v1/email-codes', { body: { purpose: 'change', email: 'a@example.com' } })).json.params).toEqual({ field: 'purpose' });
  expect((await ctx.ask('POST', path, { body: { email: 'a'.repeat(250) + '@x.cn', password: 'p' } })).json.params).toEqual({ field: 'email' });
  problem(await ctx.ask('GET', '/api/v1/consents/required', { body: '{}' }), 400, 'request.invalid');
});

it('请求体超过 4096 字节为 413 并关闭连接，恰好 4096 字节照常处理', async () => {
  const ctx = await world();
  const body = (size: number) => {
    const head = '{"email":"player@example.com","password":"old-password","pad":"';
    return head + 'x'.repeat(size - head.length - 2) + '"}';
  };
  const large = await ctx.ask('POST', '/api/v1/sessions', { body: body(4097) });
  problem(large, 413, 'request.too-large');
  expect(large.headers.connection).toBe('close');
  expect((await ctx.ask('POST', '/api/v1/sessions', { body: body(4096) })).status).toBe(201);
});

it('不支持的方法为 405 并带 Allow；未知 /api 路径 404，其他路径交给下一个处理者', async () => {
  const ctx = await world();
  const method = await ctx.ask('DELETE', '/api/v1/me');
  problem(method, 405, 'request.method-not-allowed');
  expect(method.headers.allow).toBe('GET');
  expect((await ctx.ask('GET', '/api/v2/me')).status).toBe(404);
  expect((await ctx.ask('GET', '/api/v1/email-codes/a/b')).status).toBe(404);
  const next = await ctx.ask('GET', '/download/');
  expect([next.status, next.text]).toEqual([418, 'next']);
});

it('来源只认精确允许名单：回显允许的来源并带 Vary，其余 403 且不执行业务；预检只列出该路径的方法', async () => {
  const ctx = await world();
  const allowed = await ctx.ask('GET', '/api/v1/consents/required', { headers: { Origin: 'app://yi' } });
  expect([allowed.headers['access-control-allow-origin'], allowed.headers.vary]).toEqual(['app://yi', 'Origin']);
  expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
  for (const origin of ['https://evil.example', 'app://yi.evil', 'null']) {
    const denied = await ctx.ask('POST', '/api/v1/email-codes', { body: { purpose: 'register', email: 'a@example.com' }, headers: { Origin: origin } });
    problem(denied, 403, 'request.origin-denied');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  }
  expect(ctx.queued).toEqual([]);
  const options = await ctx.ask('OPTIONS', '/api/v1/me/password', { headers: { Origin: 'app://yi' } });
  expect(options.status).toBe(204);
  expect(options.headers).toMatchObject({
    'access-control-allow-origin': 'app://yi',
    'access-control-allow-methods': 'PUT',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '600',
  });
});

it('缺少或格式不符的令牌为 401；密码任务忙为 503；未预期异常为 500 且只带 errorId', async () => {
  const ctx = await world();
  problem(await ctx.ask('GET', '/api/v1/me'), 401, 'auth.required');
  problem(await ctx.ask('DELETE', '/api/v1/sessions/current'), 401, 'auth.required');
  problem(await ctx.ask('GET', '/api/v1/me', { headers: { Authorization: `Bearer ${'A'.repeat(32)}` } }), 401, 'auth.required');
  problem(await ctx.ask('PUT', '/api/v1/me/name', { token: 'f'.repeat(32), body: { name: '棋友' } }), 401, 'auth.required');
  problem(await ctx.ask('POST', '/api/v1/me/consents', { token: 'f'.repeat(32), body: { accepted: true, privacy: 'v1', terms: 'v1' } }), 401, 'auth.required');
  ctx.passwords.verify.mockRejectedValueOnce(new PasswordBusyError());
  const busy = await ctx.ask('POST', '/api/v1/sessions', { body: { email: 'player@example.com', password: 'old-password' } });
  problem(busy, 503, 'auth.busy');
  expect([busy.json.retryAfterMs, busy.headers['retry-after']]).toEqual([1000, '1']);
  ctx.passwords.verify.mockRejectedValueOnce(new Error('fixture-secret /srv/path'));
  const broken = await ctx.ask('POST', '/api/v1/sessions', { body: { email: 'player@example.com', password: 'old-password' } });
  problem(broken, 500, 'server.internal');
  expect(broken.json.errorId).toMatch(/^[0-9a-f-]{36}$/);
  expect(broken.text).not.toContain('fixture-secret');
  expect(ctx.logs).toEqual([{ level: 'error', event: 'internal.error', entry: expect.objectContaining({ errorId: broken.json.errorId }) }]);
});

it('响应与日志中没有密码、验证码、邮箱及其查找标识', async () => {
  const ctx = await world();
  const proof = await ctx.mailed('new@example.com');
  const created = await ctx.ask('POST', '/api/v1/accounts', { body: form(proof) });
  const lookup = ctx.vault.lookup('new@example.com');
  for (const secret of ['new-password', '001234', 'new@example.com', lookup]) {
    expect(created.text).not.toContain(secret);
    expect(JSON.stringify(ctx.logs)).not.toContain(secret);
  }
});
