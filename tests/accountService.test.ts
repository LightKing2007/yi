/** 账号功能的装配（accountService.ts）：真实 SQLite 与本机真实 HTTP，发信用假发送器；启动恢复、定时清理、受理即发信、限流回应。 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { ACCOUNT_PRUNE_MS, startAccounts } from '../server/accountService';
import { CODE_TTL_MS, SESSION_LIFETIME_MS } from '../server/authPolicy';
import { AccountRepo } from '../server/db/accounts';
import { AuthLimitRepo } from '../server/db/authLimits';
import { LoginSessionRepo } from '../server/db/loginSessions';
import { MEMORY, openDatabase } from '../server/db';
import type { CodeMail } from '../server/emailCodes';
import type { LogEntry } from '../server/log';

const key = (n: number) => Buffer.alloc(32, n);
const secrets = () => ({
  email: { currentKeyId: 'k1', encryption: new Map([['k1', key(1)]]), lookup: key(2) },
  code: { currentKeyId: 'k1', keys: new Map([['k1', key(3)]]) },
  source: key(4),
  smtp: { host: 'smtpdm.example.com', port: 465, username: 'a@b.cn', password: 'fixture', from: { address: 'a@b.cn', name: '弈' } },
});
const config = { privacyVersion: 'p1', termsVersion: 't1', credentialsDir: '/run/credentials/yi.service', codeBudget: 30 };
const closers: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** 装配一套账号功能并在本机随机端口上提供；定时器手动触发，发信记入 mails */
async function world(options: { devOrigin?: string } = {}) {
  let now = Date.UTC(2026, 10, 1);
  const db = openDatabase(MEMORY, { now: () => now, appVersion: '4.0.0' });
  closers.push(() => db.close());
  const mails: CodeMail[] = [];
  const logs: { level: string; event: string; entry?: LogEntry }[] = [];
  const timers: { ms: number; fn: () => void; stopped: boolean }[] = [];
  const start = () =>
    startAccounts({
      config: { ...config, ...options },
      secrets: secrets(),
      db,
      now: () => now,
      every: (ms, fn) => {
        const timer = { ms, fn, stopped: false };
        timers.push(timer);
        return () => (timer.stopped = true);
      },
      log: (level, event, entry) => logs.push({ level, event, entry }),
      sender: async mail => {
        mails.push(mail);
      },
    });
  const service = start();
  const server = http.createServer(service.api((_req, res) => res.writeHead(404).end()));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { db, mails, logs, timers, service, base, start, advance: (ms: number) => (now += ms) };
}

const count = (db: ReturnType<typeof openDatabase>, table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);

it('启动时记 account.enabled，定时清理按间隔注册且立即执行一次；关闭时停止', async () => {
  const ctx = await world();
  expect(ctx.logs).toEqual([{ level: 'info', event: 'account.enabled', entry: { msg: '账号功能已启用', recovered: 0, privacy: 'p1', terms: 't1' } }]);
  expect(ctx.timers.map(timer => timer.ms)).toEqual([ACCOUNT_PRUNE_MS]);
  ctx.service.close();
  expect(ctx.timers[0]?.stopped).toBe(true);
});

it('受理验证码后按申请的语言立即发信，必需协议版本来自配置', async () => {
  const ctx = await world();
  const required = await (await fetch(`${ctx.base}/api/v1/consents/required`)).json();
  expect(required).toMatchObject({ privacy: 'p1', terms: 't1' });
  const answer = await fetch(`${ctx.base}/api/v1/email-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'register', email: 'player@example.com', language: 'lzh' }),
  });
  expect(answer.status).toBe(202);
  const { challengeId } = (await answer.json()) as { challengeId: string };
  for (let i = 0; i < 20 && !ctx.mails.length; i++) await new Promise(resolve => setImmediate(resolve));
  expect(ctx.mails).toEqual([{ email: 'player@example.com', code: expect.stringMatching(/^\d{6}$/), purpose: 'register', challengeId, language: 'lzh' }]);
  expect((await (await fetch(`${ctx.base}/api/v1/email-codes/${challengeId}`)).json()).state).toBe('sent');
});

it('重启时把中断的发送记为结果不明；定时清理删去过期的挑战与登录会话', async () => {
  const ctx = await world();
  ctx.db.exec(
    'INSERT INTO email_challenges (challenge_id, email_lookup, purpose, state, is_current, email_payload, code_mac, code_key_id, created_at, expires_at) ' +
      `VALUES ('${'a'.repeat(32)}', '${'b'.repeat(64)}', 'register', 'sending', 1, '{}', '${'c'.repeat(64)}', 'k1', ` +
      `${Date.UTC(2026, 10, 1)}, ${Date.UTC(2026, 10, 1) + CODE_TTL_MS})`,
  );
  ctx.db.exec(
    'INSERT INTO email_challenges (challenge_id, email_lookup, purpose, state, is_current, created_at, expires_at) ' +
      `VALUES ('${'9'.repeat(32)}', '${'8'.repeat(64)}', 'reset', 'failed', 1, 0, 1)`,
  );
  ctx.service.close();
  ctx.logs.length = 0;
  ctx.start();
  expect(ctx.db.prepare('SELECT count(*) AS n FROM email_challenges WHERE challenge_id = ?').get('9'.repeat(32))?.n).toBe(0); // 启动时即清理一次
  expect(ctx.logs[0]?.entry).toMatchObject({ recovered: 1 });
  expect(ctx.db.prepare('SELECT state, code_mac FROM email_challenges').get()).toEqual({ state: 'unknown', code_mac: null });
  const user = new AccountRepo(ctx.db, () => '7KM4P9D2').create(
    {
      name: '棋友',
      emailLookup: 'd'.repeat(64),
      passwordHash: `scrypt$131072$8$1$${'01'.repeat(16)}$${'02'.repeat(64)}`,
      now: Date.UTC(2026, 10, 1),
      consents: [{ kind: 'privacy', version: 'p1' }],
    },
    () => ({ v: 1, keyId: 'k1', nonce: '00'.repeat(12), tag: '00'.repeat(16), ciphertext: '00' }),
  );
  new LoginSessionRepo(ctx.db).create('e'.repeat(64), user.userId, user.authVersion, Date.UTC(2026, 10, 1));
  new AuthLimitRepo(ctx.db).take({ scope: 'login-ip', subject: 'f'.repeat(64), max: 10, windowMs: 60_000 }, Date.UTC(2026, 10, 1));
  ctx.timers.at(-1)?.fn();
  expect([count(ctx.db, 'email_challenges'), count(ctx.db, 'sessions'), count(ctx.db, 'auth_limits')]).toEqual([1, 1, 1]);
  ctx.advance(SESSION_LIFETIME_MS);
  ctx.timers.at(-1)?.fn();
  expect([count(ctx.db, 'email_challenges'), count(ctx.db, 'sessions'), count(ctx.db, 'auth_limits')]).toEqual([0, 0, 0]);
});

it('按 IP 限流落在账号接口上时回应 problem+json 并回显允许的来源，其他路径沿用原回应', async () => {
  const ctx = await world({ devOrigin: 'http://localhost:5173' });
  const replies: { status: number; type?: string; origin?: string; body: string; retry?: string }[] = [];
  const server = http.createServer((req, res) => ctx.service.limited(res, 3, req));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const at = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const [path, origin] of [
    ['/api/v1/me', 'http://localhost:5173'],
    ['/api/v1/me', 'https://evil.example'],
    ['/download/', undefined],
  ] as const) {
    const answer = await fetch(at + path, { headers: origin ? { Origin: origin } : {} });
    replies.push({
      status: answer.status,
      type: answer.headers.get('content-type') ?? undefined,
      origin: answer.headers.get('access-control-allow-origin') ?? undefined,
      retry: answer.headers.get('retry-after') ?? undefined,
      body: await answer.text(),
    });
  }
  expect(replies[0]).toMatchObject({ status: 429, type: 'application/problem+json; charset=utf-8', origin: 'http://localhost:5173', retry: '3' });
  expect(JSON.parse(replies[0]?.body ?? '{}')).toMatchObject({ code: 'rate.limited', level: 'E3', retryAfterMs: 3000 });
  expect(replies[1]).toMatchObject({ status: 429, origin: undefined });
  expect(replies[2]).toMatchObject({ status: 429, type: 'text/plain; charset=utf-8', retry: '3' });
});
