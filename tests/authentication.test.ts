/** 认证业务的真实 SQLite 事务、可控异步竞态与真实 scrypt 全流程；不连接邮件服务。 */
import { afterEach, expect, it } from 'vitest';
import { Authentication } from '../server/authentication';
import { CODE_TTL_MS, LOGIN_LOCK_MS } from '../server/authPolicy';
import { AUTH_CHANGED_HASH, AUTH_TEST_HASH } from './authWorld';
import { AuthenticationWorld } from './authenticationWorld';
import { deferred } from './emailCodesWorld';

const worlds: AuthenticationWorld[] = [];
const world = () => {
  const value = new AuthenticationWorld();
  worlds.push(value);
  return value;
};
afterEach(() => {
  for (const value of worlds.splice(0)) value.close();
});

it('注册原子消费验证码、创建账号与协议并签发会话，只返回公开投影', async () => {
  const ctx = world();
  const proof = await ctx.code();
  const result = await ctx.auth.register(ctx.registration(proof));
  expect(result.user).toEqual({ publicId: expect.any(String), name: '棋友', emailVerified: true, consentsCurrent: true, onlineAllowed: true });
  expect(result.token).toMatch(/^[0-9a-f]{32}$/);
  expect(ctx.auth.me(result.token)).toEqual(result.user);
  expect(ctx.auth.online(result.token)).toBeDefined();
  const stored = ctx.accounts.byEmailLookup(ctx.vault.lookup(proof.email));
  expect(stored?.passwordHash).toBe(AUTH_CHANGED_HASH);
  if (!stored) throw new Error('test-account-missing');
  expect(ctx.vault.open(stored.email, { purpose: 'account-email', recordId: String(stored.userId) })).toBe(proof.email);
  expect(ctx.row(proof.challengeId)).toMatchObject({ state: 'consumed', code_mac: null });
  await expect(ctx.auth.register(ctx.registration(proof))).rejects.toThrow('auth-denied');
  expect(ctx.passwords.hash).toHaveBeenCalledTimes(1);
});

it('注册数据库写入失败或派生故障不遗留部分用户，也不消耗有效挑战', async () => {
  const ctx = world();
  const proof = await ctx.code();
  ctx.db.exec("CREATE TRIGGER test_account_failure BEFORE INSERT ON accounts BEGIN SELECT RAISE(ABORT, 'fixture-write'); END");
  await expect(ctx.auth.register(ctx.registration(proof))).rejects.toThrow('fixture-write');
  for (const table of ['users', 'accounts', 'consents']) expect(ctx.db.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total).toBe(1);
  expect(ctx.check(proof.challengeId, proof.code, 'register', proof.email)).toBeDefined();
  ctx.db.exec('DROP TRIGGER test_account_failure');
  ctx.passwords.hash.mockRejectedValueOnce(new Error('fixture-derive'));
  await expect(ctx.auth.register(ctx.registration(proof))).rejects.toThrow('fixture-derive');
  expect(ctx.row(proof.challengeId)?.state).toBe('sent');
});

it('同一验证码的并发注册只有一个提交，派生期间到期不能注册', async () => {
  const ctx = world();
  const proof = await ctx.code();
  const started = deferred();
  const complete = deferred();
  let calls = 0;
  ctx.passwords.hash.mockImplementation(async () => {
    if (++calls === 2) started.resolve();
    await complete.promise;
    return AUTH_CHANGED_HASH;
  });
  const results = Promise.allSettled([ctx.auth.register(ctx.registration(proof)), ctx.auth.register(ctx.registration(proof))]);
  await started.promise;
  complete.resolve();
  expect((await results).map(item => item.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(ctx.db.prepare('SELECT count(*) AS total FROM accounts').get()?.total).toBe(2);
  const other = world();
  const expiry = await other.code();
  const hashing = deferred();
  const finish = deferred();
  other.passwords.hash.mockImplementation(async () => {
    hashing.resolve();
    await finish.promise;
    return AUTH_CHANGED_HASH;
  });
  const pending = other.auth.register(other.registration(expiry));
  const rejected = expect(pending).rejects.toThrow('auth-denied');
  await hashing.promise;
  other.now += CODE_TTL_MS;
  finish.resolve();
  await rejected;
  expect(other.db.prepare('SELECT count(*) AS total FROM accounts').get()?.total).toBe(1);
});

it('缺失账号仍执行允许格式的虚拟验证，不能通过虚拟口令获得会话', async () => {
  const ctx = world();
  ctx.passwords.verify.mockResolvedValue(true);
  await expect(ctx.login('old-password', 'missing@example.com')).rejects.toThrow('auth-denied');
  expect(ctx.passwords.verify).toHaveBeenCalledWith('old-password', expect.stringMatching(/^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/));
  expect(ctx.db.prepare('SELECT count(*) AS total FROM sessions').get()?.total).toBe(0);
  const limits = ctx.db.prepare("SELECT history FROM auth_limits WHERE scope = 'login-account'").get();
  expect(JSON.parse(String(limits?.history)).times).toHaveLength(1);
});

it('账号第五次失败锁定，正确口令不能绕过，期限后成功只清账号失败', async () => {
  const ctx = world();
  for (let i = 0; i < 4; i++) await expect(ctx.login('wrong')).rejects.toThrow('auth-denied');
  await expect(ctx.login('wrong')).rejects.toMatchObject({ reason: 'limited', retryAfterMs: LOGIN_LOCK_MS });
  await expect(ctx.login()).rejects.toMatchObject({ reason: 'limited', retryAfterMs: LOGIN_LOCK_MS });
  expect(ctx.passwords.verify).toHaveBeenCalledTimes(5);
  ctx.now += LOGIN_LOCK_MS;
  expect((await ctx.login()).token).toHaveLength(32);
  expect(ctx.db.prepare("SELECT count(*) AS total FROM auth_limits WHERE scope = 'login-account'").get()?.total).toBe(0);
  expect(ctx.db.prepare("SELECT count(*) AS total FROM auth_limits WHERE scope = 'login-ip'").get()?.total).toBe(1);
});

it('来源第十次后在派生前拒绝，滚动边界可再登录，读取资料不续活', async () => {
  const ctx = world();
  let token = '';
  for (let i = 0; i < 10; i++) token = (await ctx.login()).token;
  await expect(ctx.login()).rejects.toMatchObject({ reason: 'limited', retryAfterMs: 60000 });
  expect(ctx.passwords.verify).toHaveBeenCalledTimes(10);
  const before = ctx.db.prepare('SELECT last_seen_at FROM sessions').all();
  ctx.now += 60000;
  expect(ctx.auth.me(token)).toBeDefined();
  expect(ctx.db.prepare('SELECT last_seen_at FROM sessions').all()).toEqual(before);
  expect((await ctx.login()).token).toHaveLength(32);
});

it('协议更新后登录仍可查看资料，联机需验证邮箱并明确同意当前版本', async () => {
  const ctx = world();
  const token = (await ctx.login()).token;
  expect(ctx.auth.me(token)).toMatchObject({ emailVerified: true, consentsCurrent: false, onlineAllowed: false });
  expect(ctx.auth.online(token)).toBeUndefined();
  expect(ctx.auth.acceptConsents(token, { accepted: false, privacy: 'v1', terms: 'v1' })).toBe(false);
  expect(ctx.auth.acceptConsents(token, { accepted: true, privacy: 'v1', terms: 'v1' })).toBe(true);
  expect(ctx.auth.online(token)?.userId).toBe(ctx.user.userId);
  const updated = new Authentication(ctx.db, ctx.vault, ctx.codes, {
    required: { privacy: 'v2', terms: 'v1' },
    passwords: ctx.passwords,
    now: () => ctx.now,
  });
  expect(updated.me(token)?.consentsCurrent).toBe(false);
  expect(updated.online(token)).toBeUndefined();
  expect(updated.acceptConsents(token, { accepted: true, privacy: 'v1', terms: 'v1' })).toBe(false);
  expect(updated.acceptConsents(token, { accepted: true, privacy: 'v2', terms: 'v1' })).toBe(true);
  expect(updated.online(token)).toBeDefined();
  ctx.db.prepare('UPDATE accounts SET email_verified_at = ? WHERE user_id = ?').run(ctx.now + 1, ctx.user.userId);
  expect(ctx.auth.online(token)).toBeUndefined();
  expect(ctx.auth.acceptConsents('invalid', { accepted: true, privacy: 'v1', terms: 'v1' })).toBe(false);
  ctx.auth.logout(token);
  expect(ctx.auth.me(token)).toBeUndefined();
  expect(ctx.notifications).toEqual([{ event: { userId: ctx.user.userId, sessionId: expect.any(Number) }, committed: true, remainingSessions: 0 }]);
});

it('重置密码原子撤销全部旧会话，通知在提交后发送，验证码不能重放', async () => {
  const ctx = world();
  const first = (await ctx.login()).token;
  const second = (await ctx.login()).token;
  const proof = await ctx.code('player@example.com', 'reset');
  await ctx.auth.reset({ ...proof, password: 'new-password', sourceHash: 'a'.repeat(64) });
  expect(ctx.auth.me(first)).toBeUndefined();
  expect(ctx.auth.me(second)).toBeUndefined();
  expect(ctx.accounts.byUserId(ctx.user.userId)).toMatchObject({ passwordHash: AUTH_CHANGED_HASH, authVersion: 2 });
  expect(ctx.notifications).toEqual([{ event: { userId: ctx.user.userId }, committed: true, remainingSessions: 0 }]);
  await expect(ctx.auth.reset({ ...proof, password: 'new-password', sourceHash: 'a'.repeat(64) })).rejects.toThrow('auth-denied');
  await expect(ctx.login()).rejects.toThrow('auth-denied');
  expect((await ctx.login('new-password')).token).toHaveLength(32);
});

it('重置时账号不存在也派生并返回完成，消费有效证明而不创建账号', async () => {
  const ctx = world();
  const proof = await ctx.code('unknown@example.com', 'reset');
  await expect(ctx.auth.reset({ ...proof, password: 'new-password', sourceHash: 'a'.repeat(64) })).resolves.toBeUndefined();
  expect(ctx.passwords.hash).toHaveBeenCalledTimes(1);
  expect(ctx.passwords.verify).not.toHaveBeenCalled();
  expect(ctx.db.prepare('SELECT count(*) AS total FROM accounts').get()?.total).toBe(1);
  expect(ctx.row(proof.challengeId)?.state).toBe('consumed');
  expect(ctx.notifications).toEqual([]);
});

it('登录验证期间重置后，旧验证结果不能签发任何新会话', async () => {
  const ctx = world();
  const proof = await ctx.code('player@example.com', 'reset');
  const started = deferred();
  const complete = deferred();
  ctx.passwords.verify.mockImplementation(async () => {
    started.resolve();
    await complete.promise;
    return true;
  });
  const login = ctx.login();
  const rejected = expect(login).rejects.toThrow('auth-denied');
  await started.promise;
  await ctx.auth.reset({ ...proof, password: 'new-password', sourceHash: 'a'.repeat(64) });
  complete.resolve();
  await rejected;
  expect(ctx.db.prepare('SELECT count(*) AS total FROM sessions').get()?.total).toBe(0);
});

it('重置派生期间世代变化则全部回滚，保留挑战且不发送撤销通知', async () => {
  const ctx = world();
  const proof = await ctx.code('player@example.com', 'reset');
  const started = deferred();
  const complete = deferred();
  ctx.passwords.hash.mockImplementation(async () => {
    started.resolve();
    await complete.promise;
    return AUTH_CHANGED_HASH;
  });
  const resetting = ctx.auth.reset({ ...proof, password: 'new-password', sourceHash: 'a'.repeat(64) });
  const rejected = expect(resetting).rejects.toThrow('auth-denied');
  await started.promise;
  ctx.repo.revokeUser(ctx.user.userId);
  complete.resolve();
  await rejected;
  expect(ctx.accounts.byUserId(ctx.user.userId)?.passwordHash).toBe(AUTH_TEST_HASH);
  expect(ctx.row(proof.challengeId)?.state).toBe('sent');
  expect(ctx.notifications).toEqual([]);
});

it('修改密码须校验旧口令，成功撤销全部会话并仅在提交后通知', async () => {
  const ctx = world();
  const token = (await ctx.login()).token;
  const other = (await ctx.login()).token;
  const input = { token, oldPassword: 'wrong', password: 'new-password', sourceHash: 'a'.repeat(64) };
  await expect(ctx.auth.changePassword(input)).rejects.toThrow('auth-denied');
  expect(ctx.passwords.hash).not.toHaveBeenCalled();
  await ctx.auth.changePassword({ ...input, oldPassword: 'old-password' });
  expect(ctx.auth.me(token)).toBeUndefined();
  expect(ctx.auth.me(other)).toBeUndefined();
  expect(ctx.accounts.byUserId(ctx.user.userId)).toMatchObject({ authVersion: 2, passwordHash: AUTH_CHANGED_HASH });
  expect(ctx.notifications).toEqual([{ event: { userId: ctx.user.userId }, committed: true, remainingSessions: 0 }]);
});

it('改密派生期间退出，旧会话不能完成改密', async () => {
  const ctx = world();
  const token = (await ctx.login()).token;
  const started = deferred();
  const complete = deferred();
  ctx.passwords.hash.mockImplementation(async () => {
    started.resolve();
    await complete.promise;
    return AUTH_CHANGED_HASH;
  });
  const pending = ctx.auth.changePassword({ token, oldPassword: 'old-password', password: 'new-password', sourceHash: 'a'.repeat(64) });
  const rejected = expect(pending).rejects.toThrow('auth-session');
  await started.promise;
  ctx.auth.logout(token);
  complete.resolve();
  await rejected;
  expect(ctx.accounts.byUserId(ctx.user.userId)).toMatchObject({ authVersion: 1, passwordHash: AUTH_TEST_HASH });
});

it('验证等待期间出现账号锁定，正确登录和改密结果也不能越过锁定', async () => {
  const ctx = world();
  const token = (await ctx.login()).token;
  const started = deferred();
  const complete = deferred();
  let calls = 0;
  ctx.passwords.verify.mockImplementation(async () => {
    if (++calls === 2) started.resolve();
    await complete.promise;
    return true;
  });
  const login = expect(ctx.login()).rejects.toMatchObject({ reason: 'limited' });
  const change = expect(
    ctx.auth.changePassword({ token, oldPassword: 'old-password', password: 'new-password', sourceHash: 'b'.repeat(64) }),
  ).rejects.toMatchObject({ reason: 'limited' });
  await started.promise;
  const { AuthLimitRepo } = await import('../server/db/authLimits');
  const limits = new AuthLimitRepo(ctx.db);
  for (let i = 0; i < 5; i++) limits.failure(ctx.user.emailLookup, ctx.now);
  complete.resolve();
  await Promise.all([login, change]);
  expect(ctx.accounts.byUserId(ctx.user.userId)).toMatchObject({ authVersion: 1, passwordHash: AUTH_TEST_HASH });
});

it('格式、同意、错误挑战和外层事务先于昂贵派生拒绝', async () => {
  const ctx = world();
  const proof = await ctx.code();
  const input = ctx.registration(proof);
  await expect(ctx.auth.register({ ...input, name: '\u202e棋' })).rejects.toThrow('auth-invalid');
  await expect(ctx.auth.register({ ...input, consent: null })).rejects.toThrow('auth-consent');
  await expect(ctx.auth.register({ ...input, password: 'short' })).rejects.toThrow('auth-invalid');
  await expect(ctx.auth.register({ ...input, sourceHash: 'a'.repeat(64) + '\n' })).rejects.toThrow('auth-invalid');
  await expect(ctx.auth.register({ ...input, code: '999999' })).rejects.toThrow('auth-denied');
  ctx.db.exec('BEGIN');
  try {
    await expect(ctx.auth.login(input)).rejects.toThrow('auth-not-committed');
  } finally {
    ctx.db.exec('ROLLBACK');
  }
  expect(ctx.passwords.hash).not.toHaveBeenCalled();
  expect(ctx.passwords.verify).not.toHaveBeenCalled();
  ctx.now = NaN;
  await expect(ctx.login()).rejects.toThrow('auth-clock-invalid');
});

it('真实 scrypt 完成注册、登录、重置和改密，原文口令和旧凭据失效一致', async () => {
  const ctx = world();
  const events: boolean[] = [];
  const auth = new Authentication(ctx.db, ctx.vault, ctx.codes, {
    required: { privacy: 'v1', terms: 'v1' },
    now: () => ctx.now,
    onRevoke: () => events.push(!ctx.db.isTransaction),
  });
  const raw = '  e\u0301密碼🙂  ';
  const proof = await ctx.code();
  const registered = await auth.register({ ...ctx.registration(proof), password: raw });
  auth.logout(registered.token);
  const login = await auth.login({ email: proof.email, password: raw, sourceHash: 'a'.repeat(64) });
  await expect(auth.login({ email: proof.email, password: raw.trim(), sourceHash: 'a'.repeat(64) })).rejects.toThrow('auth-denied');
  await expect(auth.login({ email: proof.email, password: raw.normalize('NFC'), sourceHash: 'a'.repeat(64) })).rejects.toThrow('auth-denied');
  ctx.now += 60000;
  const reset = await ctx.code(proof.email, 'reset');
  await auth.reset({ ...reset, password: 'new-password', sourceHash: 'a'.repeat(64) });
  expect(auth.me(login.token)).toBeUndefined();
  await expect(auth.login({ email: proof.email, password: raw, sourceHash: 'a'.repeat(64) })).rejects.toThrow('auth-denied');
  const current = await auth.login({ email: proof.email, password: 'new-password', sourceHash: 'a'.repeat(64) });
  await auth.changePassword({ token: current.token, oldPassword: 'new-password', password: 'changed-password', sourceHash: 'a'.repeat(64) });
  expect(auth.me(current.token)).toBeUndefined();
  expect((await auth.login({ email: proof.email, password: 'changed-password', sourceHash: 'a'.repeat(64) })).user.onlineAllowed).toBe(true);
  expect(events).toEqual([true, true, true]);
}, 30000);

it('验证码有效但邮箱已注册时给出 taken，不派生、不消费验证码', async () => {
  const ctx = world();
  const proof = await ctx.code('player@example.com');
  await expect(ctx.auth.register(ctx.registration(proof))).rejects.toMatchObject({ reason: 'taken' });
  expect(ctx.passwords.hash).not.toHaveBeenCalled();
  expect(ctx.row(proof.challengeId)?.state).toBe('sent');
  await expect(ctx.auth.register({ ...ctx.registration(proof), code: '999999' })).rejects.toMatchObject({ reason: 'denied' });
});

it('派生期间同一邮箱被注册时回滚为 taken，验证码保留', async () => {
  const ctx = world();
  const proof = await ctx.code();
  ctx.passwords.hash.mockImplementation(async () => {
    ctx.account(proof.email);
    return AUTH_CHANGED_HASH;
  });
  await expect(ctx.auth.register(ctx.registration(proof))).rejects.toMatchObject({ reason: 'taken' });
  expect(ctx.db.prepare('SELECT count(*) AS total FROM accounts').get()?.total).toBe(2);
  expect(ctx.row(proof.challengeId)?.state).toBe('sent');
});

it('改密时令牌失效为 session，旧密码错误为 denied', async () => {
  const ctx = world();
  const token = (await ctx.login()).token;
  const input = { token, oldPassword: 'old-password', password: 'new-password', sourceHash: 'a'.repeat(64) };
  await expect(ctx.auth.changePassword({ ...input, token: 'f'.repeat(32) })).rejects.toMatchObject({ reason: 'session' });
  await expect(ctx.auth.changePassword({ ...input, oldPassword: 'wrong' })).rejects.toMatchObject({ reason: 'denied' });
  expect(ctx.passwords.hash).not.toHaveBeenCalled();
});

it('修改雅号规范化并保留 UID，更新活动时间；格式不符或令牌失效时不写入', async () => {
  const ctx = world();
  const token = (await ctx.login()).token;
  const before = ctx.auth.me(token);
  ctx.now += 60000;
  const renamed = ctx.auth.rename(token, '  新雅号  ');
  expect(renamed).toEqual({ ...before, name: '新雅号' });
  expect(ctx.auth.me(token)).toEqual(renamed);
  expect(ctx.accounts.byUserId(ctx.user.userId)?.publicId).toBe(before?.publicId);
  expect(ctx.db.prepare('SELECT last_seen_at FROM sessions').get()?.last_seen_at).toBe(ctx.now);
  expect(() => ctx.auth.rename(token, '‮棋')).toThrow('auth-invalid');
  expect(() => ctx.auth.rename(token, '')).toThrow('auth-invalid');
  ctx.auth.logout(token);
  expect(() => ctx.auth.rename(token, '另一个')).toThrow('auth-session');
  expect(ctx.accounts.byUserId(ctx.user.userId)?.name).toBe('新雅号');
});

it('补签协议更新活动时间，只读资料不更新', async () => {
  const ctx = world();
  const token = (await ctx.login()).token;
  const created = ctx.now;
  ctx.now += 60000;
  ctx.auth.me(token);
  expect(ctx.db.prepare('SELECT last_seen_at FROM sessions').get()?.last_seen_at).toBe(created);
  expect(ctx.auth.acceptConsents(token, { accepted: true, privacy: 'v1', terms: 'v1' })).toBe(true);
  expect(ctx.db.prepare('SELECT last_seen_at FROM sessions').get()?.last_seen_at).toBe(ctx.now);
});
