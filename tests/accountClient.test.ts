/** 账号接口的客户端（src/online/accountApi.ts、account.ts）：对真实服务端（本机 HTTP 与真实 SQLite）走通登录流程，并覆盖回应校验与网络失败。 */
import { afterEach, expect, it } from 'vitest';
import { AccountSession, type LoginStore } from '../src/online/account';
import { AccountApi, apiBase, parseProblem, parseUser, type Fetcher } from '../src/online/accountApi';
import { AccountApiWorld } from './accountApiWorld';

const worlds: AccountApiWorld[] = [];
afterEach(async () => {
  for (const value of worlds.splice(0)) await value.stop();
});
const world = async () => {
  const value = new AccountApiWorld();
  worlds.push(value);
  return value.start();
};

/** 内存中的保存处；saves 记下每次保存的令牌 */
function memoryStore(accept = true) {
  const store = {
    saved: undefined as { token: string; expiresAt: string } | undefined,
    saves: [] as string[],
    load: async () => store.saved,
    save: async (token: string, expiresAt: string) => {
      store.saves.push(token);
      if (accept) store.saved = { token, expiresAt };
      return accept;
    },
    clear: async () => {
      store.saved = undefined;
    },
  };
  return store;
}

const consent = { accepted: true as const, privacy: 'v1', terms: 'v1' };
const user = { publicId: '7KM4P9D2', name: '棋友', emailVerified: true, consentsCurrent: true, onlineAllowed: true };

it('由联机地址推出接口地址：wss 对应 https，ws 对应 http，其他协议不可用', () => {
  expect(apiBase('wss://yi.lightking.com.cn/ws')).toBe('https://yi.lightking.com.cn/api/v1');
  expect(apiBase('ws://127.0.0.1:8443')).toBe('http://127.0.0.1:8443/api/v1');
  expect(apiBase('https://yi.lightking.com.cn')).toBeUndefined();
  expect(apiBase('not a url')).toBeUndefined();
});

it('错误回应：级别缺失时按错误码表，错误码未知时按 E5，回应不合格时为 server.internal', () => {
  expect(parseProblem(429, { code: 'rate.limited', level: 'E3', retryAfterMs: 3000 })).toEqual({
    status: 429,
    code: 'rate.limited',
    level: 'E3',
    retryAfterMs: 3000,
  });
  expect(parseProblem(409, { code: 'account.email-taken' })).toEqual({ status: 409, code: 'account.email-taken', level: 'E2' });
  expect(parseProblem(418, { code: 'future.thing' })).toEqual({ status: 418, code: 'future.thing', level: 'E5' });
  expect(parseProblem(400, { code: 'request.invalid', level: 'E9', params: { field: 'email' } })).toEqual({
    status: 400,
    code: 'request.invalid',
    level: 'E4',
    field: 'email',
  });
  expect(parseProblem(500, { code: 'server.internal', level: 'E5', errorId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0' }).errorId).toBe(
    '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0',
  );
  for (const raw of [undefined, 'oops', { code: 'Not A Code' }, { code: 5 }])
    expect(parseProblem(502, raw)).toEqual({ status: 502, code: 'server.internal', level: 'E5' });
  expect(parseProblem(429, { code: 'rate.limited', retryAfterMs: -1 }).retryAfterMs).toBeUndefined();
});

it('资料对象只接受契约中的字段与规范的公开 UID', () => {
  expect(parseUser(user)).toEqual(user);
  expect(parseUser({ ...user, internalId: 7 })).toEqual(user);
  for (const bad of [{ ...user, publicId: '7km4p9d2' }, { ...user, publicId: '7KM4-P9D2' }, { ...user, name: '' }, { ...user, onlineAllowed: 'yes' }, null]) {
    expect(parseUser(bad)).toBeUndefined();
  }
});

it('注册、改名、补签、改密、重新登录与退出走通，令牌只在保存处与内存中', async () => {
  const ctx = await world();
  const api = new AccountApi(ctx.base, (url, init) => fetch(url, init));
  const store = memoryStore();
  const session = new AccountSession(api, store);
  const states: boolean[] = [];
  session.onChange(state => states.push(state.user !== undefined));
  const required = await api.requiredConsents();
  expect(required).toEqual({ ok: true, value: expect.objectContaining({ privacy: 'v1', terms: 'v1' }) });
  const code = await api.requestCode('register', 'new@example.com', 'lzh');
  if (!code.ok) throw new Error('fixture-code');
  expect(ctx.languages).toEqual(['lzh']);
  expect(await api.codeState(code.value.challengeId)).toEqual({ ok: true, value: 'pending' });
  await ctx.codes.deliver(code.value.challengeId);
  const form = { name: '棋友', email: 'new@example.com', password: 'new-password', challengeId: code.value.challengeId, code: '001234', consent };
  const registered = await session.register(form);
  expect(registered.ok).toBe(true);
  expect(session.current).toMatchObject({ saved: true, user: { name: '棋友' } });
  expect(JSON.stringify(session.current)).not.toContain(store.saves[0]);
  expect((await session.rename('新雅号')).ok).toBe(true);
  expect(session.current.user?.name).toBe('新雅号');
  expect((await session.acceptConsents(consent)).ok).toBe(true);
  expect((await session.changePassword('new-password', 'new-password')).ok).toBe(true);
  expect([session.signedIn, store.saved]).toEqual([false, undefined]);
  expect((await session.login('new@example.com', 'new-password')).ok).toBe(true);
  const token = store.saved?.token ?? '';
  await session.logout();
  expect([session.signedIn, store.saved, session.current.user]).toEqual([false, undefined, undefined]);
  expect(await api.me(token)).toEqual({ ok: false, problem: expect.objectContaining({ status: 401, code: 'auth.required' }) });
  expect(states.at(-1)).toBe(false);
});

it('启动时恢复保存的登录；令牌已失效时清除，网络中断时保留', async () => {
  const ctx = await world();
  const api = new AccountApi(ctx.base, (url, init) => fetch(url, init));
  const login = await api.login('player@example.com', 'old-password');
  if (!login.ok) throw new Error('fixture-login');
  const store = memoryStore();
  store.saved = { token: login.value.token, expiresAt: login.value.expiresAt };
  const restored = new AccountSession(api, store);
  expect((await restored.restore())?.ok).toBe(true);
  expect(restored.current).toMatchObject({ saved: true, user: { name: '棋友' } });
  const offline = new AccountSession(new AccountApi(ctx.base, () => Promise.reject(new TypeError('fixture-offline'))), store);
  expect(await offline.restore()).toEqual({ ok: false, problem: { status: 0, code: 'server.internal', level: 'E5' } });
  expect([offline.signedIn, store.saved?.token]).toEqual([true, login.value.token]);
  store.saved = { token: 'f'.repeat(32), expiresAt: login.value.expiresAt };
  const stale = new AccountSession(api, store);
  expect((await stale.restore())?.ok).toBe(false);
  expect([stale.signedIn, store.saved]).toEqual([false, undefined]);
  expect(await new AccountSession(api, memoryStore()).restore()).toBeUndefined();
});

it('加密保存不可用或出错时仍保持本次登录；没有登录时调用需要登录的接口直接返回 auth.required', async () => {
  const ctx = await world();
  const api = new AccountApi(ctx.base, (url, init) => fetch(url, init));
  const unsaved = new AccountSession(api, memoryStore(false));
  expect((await unsaved.login('player@example.com', 'old-password')).ok).toBe(true);
  expect(unsaved.current.saved).toBe(false);
  expect((await unsaved.refresh()).ok).toBe(true);
  const failing: LoginStore = {
    load: () => Promise.reject(new Error('x')),
    save: () => Promise.reject(new Error('x')),
    clear: () => Promise.reject(new Error('x')),
  };
  const broken = new AccountSession(api, failing);
  expect(await broken.restore()).toBeUndefined();
  expect((await broken.login('player@example.com', 'old-password')).ok).toBe(true);
  await broken.logout();
  expect(broken.signedIn).toBe(false);
  expect(await new AccountSession(api).rename('x')).toEqual({ ok: false, problem: { status: 401, code: 'auth.required', level: 'E2' } });
});

it('回应不合格时为 server.internal；业务拒绝原样给出错误码', async () => {
  const ctx = await world();
  const garbage: Fetcher = async () => new Response('{"token":"nope"}', { status: 201 });
  expect(await new AccountApi(ctx.base, garbage).login('a@b.cn', 'x')).toEqual({ ok: false, problem: { status: 201, code: 'server.internal', level: 'E5' } });
  const wrongEmpty: Fetcher = async () => new Response('{}', { status: 200 });
  expect((await new AccountApi(ctx.base, wrongEmpty).logout('f'.repeat(32))).ok).toBe(false);
  const api = new AccountApi(ctx.base, (url, init) => fetch(url, init));
  expect(await api.login('player@example.com', 'wrong-password')).toEqual({
    ok: false,
    problem: { status: 401, code: 'auth.credentials-invalid', level: 'E2' },
  });
  let requests = 0;
  const counting = new AccountApi(ctx.base, (url, init) => {
    requests++;
    return fetch(url, init);
  });
  expect(await counting.codeState('not-hex')).toEqual({ ok: false, problem: { status: 0, code: 'code.not-found', level: 'E2' } });
  expect(requests).toBe(0); // 编号不合格时不发请求
  const badToken: Fetcher = async () => new Response(JSON.stringify({ token: 'NOT-HEX', expiresAt: '2026-12-01T08:00:00.000Z', user }), { status: 201 });
  expect((await new AccountApi(ctx.base, badToken).login('a@b.cn', 'x')).ok).toBe(false);
  const offSite: Fetcher = async () =>
    new Response(JSON.stringify({ privacy: 'v1', terms: 'v1', privacyUrl: 'https://evil.example/p', termsUrl: 'https://evil.example/t' }), { status: 200 });
  expect((await new AccountApi('https://yi.lightking.com.cn/api/v1', offSite).requiredConsents()).ok).toBe(false);
});

it('等待期间退出时，迟到的结果不再作用于当前登录', async () => {
  const ctx = await world();
  let release = () => {};
  const gate = new Promise<void>(resolve => (release = resolve));
  const api = new AccountApi(ctx.base, async (url, init) => {
    const response = await fetch(url, init);
    if (url.endsWith('/me/name')) await gate; // 改名已在服务端完成，只把回应扣到退出之后
    return response;
  });
  const session = new AccountSession(api, memoryStore());
  await session.login('player@example.com', 'old-password');
  const renaming = session.rename('迟到');
  await session.logout();
  release();
  expect((await renaming).ok).toBe(true); // 改名本身成功，但结果不再作用于已退出的登录
  expect([session.signedIn, session.current.user]).toEqual([false, undefined]);
});

it('登录回应晚于退出或另一次登录到达时，不恢复登录、不覆盖新账号，也不留下保存的令牌', async () => {
  const ctx = await world();
  const gates: (() => void)[] = [];
  let held = () => {};
  /** 下一次登录回应被扣住时完成 */
  const nextHeld = () => new Promise<void>(resolve => (held = resolve));
  let hold = false;
  const api = new AccountApi(ctx.base, async (url, init) => {
    const response = await fetch(url, init);
    if (hold && url.endsWith('/sessions') && init.method === 'POST') {
      const gate = new Promise<void>(resolve => gates.push(resolve));
      held();
      await gate;
    }
    return response;
  });
  const store = memoryStore();
  const session = new AccountSession(api, store);
  hold = true;
  let waiting = nextHeld();
  const late = session.login('player@example.com', 'old-password');
  await waiting;
  await session.logout();
  gates.shift()?.();
  expect((await late).ok).toBe(false);
  expect([session.signedIn, store.saved]).toEqual([false, undefined]);
  waiting = nextHeld();
  const older = session.login('player@example.com', 'old-password');
  await waiting;
  hold = false;
  expect((await session.login('player@example.com', 'old-password')).ok).toBe(true);
  const newer = store.saved?.token;
  gates.shift()?.();
  expect((await older).ok).toBe(false);
  expect(store.saved?.token).toBe(newer);
  expect(session.signedIn).toBe(true);
});

it('换账号时先删去此前保存的登录：新账号保存失败也不会在下次启动时恢复成旧账号', async () => {
  const ctx = await world();
  ctx.account('second@example.com');
  const api = new AccountApi(ctx.base, (url, init) => fetch(url, init));
  const store = memoryStore();
  const first = new AccountSession(api, store);
  await first.login('player@example.com', 'old-password');
  expect(store.saved).toBeDefined();
  store.save = async () => false; // 换账号时加密保存不可用
  expect((await first.login('second@example.com', 'old-password')).ok).toBe(true);
  expect([first.current.saved, store.saved]).toEqual([false, undefined]);
});

it('保存期间退出时删去刚保存的登录', async () => {
  const ctx = await world();
  const api = new AccountApi(ctx.base, (url, init) => fetch(url, init));
  const store = memoryStore();
  let release = () => {};
  let started = () => {};
  const saving = new Promise<void>(resolve => (release = resolve));
  const savingStarted = new Promise<void>(resolve => (started = resolve));
  const original = store.save;
  store.save = async (token, expiresAt) => {
    started();
    await saving;
    return original(token, expiresAt);
  };
  const session = new AccountSession(api, store);
  const login = session.login('player@example.com', 'old-password');
  await savingStarted;
  const out = session.logout();
  release();
  await Promise.all([login, out]);
  expect([session.signedIn, store.saved]).toEqual([false, undefined]);
});
