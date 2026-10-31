/** 验证码状态机与限额的真实 SQLite 验证；全部网络边界使用受控发送器。 */
import { afterEach, expect, it, vi } from 'vitest';
import { CODE_COOLDOWN_MS, CODE_SEND_TIMEOUT_MS, CODE_TTL_MS } from '../server/authPolicy';
import { transaction } from '../server/db/transaction';
import { CodeWorld, deferred } from './emailCodesWorld';

const worlds: CodeWorld[] = [];
const world = (options?: ConstructorParameters<typeof CodeWorld>[0]) => {
  const value = new CodeWorld(options);
  worlds.push(value);
  return value;
};
afterEach(() => {
  for (const value of worlds.splice(0)) value.close();
});

it('入队只保存密文，发送时生成 HMAC，消费后立即清除凭据且不能重用', async () => {
  const ctx = world();
  const id = ctx.request();
  expect(ctx.row(id)).toMatchObject({ state: 'queued', code_mac: null, code_key_id: null });
  expect(JSON.stringify(ctx.row(id))).not.toContain('a@example.com');
  expect(ctx.check(id)).toBeUndefined();
  await ctx.codes.deliver(id);
  expect(ctx.mails).toEqual([{ challengeId: id, code: '001234', email: 'a@example.com', purpose: 'register', language: 'zh-Hans' }]);
  expect(ctx.row(id)).toMatchObject({ state: 'sent', email_payload: null, code_key_id: 'test' });
  expect(String(ctx.row(id)?.code_mac)).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(ctx.row(id))).not.toContain('001234');
  const proof = ctx.check(id);
  expect(proof).toBeDefined();
  if (!proof) throw new Error('test-proof-missing');
  expect(ctx.codes.consume(proof)).toBe(true);
  expect(ctx.codes.consume(proof)).toBe(false);
  expect(ctx.check(id)).toBeUndefined();
  expect(ctx.row(id)).toMatchObject({ state: 'consumed', is_current: 0, code_mac: null, email_payload: null });
  await ctx.codes.deliver(id);
  expect(ctx.mails).toHaveLength(1);
});

it('错误码最多五次，不同邮箱或用途不能消耗别人的次数', async () => {
  const ctx = world();
  const id = ctx.request();
  await ctx.codes.deliver(id);
  expect(ctx.check(id, '001234', 'reset')).toBeUndefined();
  expect(ctx.check(id, '001234', 'register', 'b@example.com')).toBeUndefined();
  expect(ctx.row(id)?.attempts).toBe(0);
  const proof = ctx.check(id);
  if (!proof) throw new Error('test-proof-missing');
  for (let i = 0; i < 5; i++) expect(ctx.check(id, '999999')).toBeUndefined();
  expect(ctx.row(id)?.attempts).toBe(5);
  expect(ctx.check(id)).toBeUndefined();
  expect(ctx.codes.consume(proof)).toBe(false);
  expect(ctx.check(id, '999999')).toBeUndefined();
  expect(ctx.row(id)?.attempts).toBe(5);
});

it('精确到期和时钟倒退拒绝核验及预检后的消费', async () => {
  const ctx = world();
  const created = ctx.now;
  const id = ctx.request();
  await ctx.codes.deliver(id);
  const proof = ctx.check(id);
  if (!proof) throw new Error('test-proof-missing');
  ctx.now = created - 1;
  expect(ctx.check(id)).toBeUndefined();
  ctx.now = created + CODE_TTL_MS - 1;
  expect(ctx.check(id)).toBeDefined();
  ctx.now++;
  expect(ctx.check(id)).toBeUndefined();
  expect(ctx.codes.consume(proof)).toBe(false);
});

it('消费参与外层事务，后续写入失败回滚，重复预检只有一次消费成功', async () => {
  const ctx = world();
  const id = ctx.request();
  await ctx.codes.deliver(id);
  const one = ctx.check(id);
  const two = ctx.check(id);
  if (!one || !two) throw new Error('test-proof-missing');
  expect(() =>
    transaction(ctx.db, () => {
      expect(ctx.codes.consume(one)).toBe(true);
      throw new Error('later-write');
    }),
  ).toThrow('later-write');
  expect(ctx.codes.consume(two)).toBe(true);
  expect(ctx.codes.consume(one)).toBe(false);
});

it('重新申请使旧挑战失效，旧发送迟到成功不能复活或覆盖新挑战', async () => {
  const started = deferred();
  const complete = deferred();
  const ctx = world({
    sender: async () => {
      started.resolve();
      await complete.promise;
    },
  });
  const old = ctx.request();
  const sending = ctx.codes.deliver(old);
  await started.promise;
  ctx.now += CODE_COOLDOWN_MS;
  const current = ctx.request();
  complete.resolve();
  await sending;
  expect(ctx.row(old)).toMatchObject({ state: 'superseded', is_current: 0, email_payload: null, code_mac: null });
  expect(ctx.check(old)).toBeUndefined();
  expect(ctx.row(current)?.state).toBe('queued');
  await ctx.codes.deliver(current);
  expect(ctx.check(current)).toBeDefined();
});

it('旧的成功预检不能消费重发后的挑战，即使两代数字相同', async () => {
  const ctx = world();
  const id = ctx.request();
  await ctx.codes.deliver(id);
  const proof = ctx.check(id);
  if (!proof) throw new Error('test-proof-missing');
  ctx.now += CODE_COOLDOWN_MS;
  const next = ctx.request();
  await ctx.codes.deliver(next);
  expect(ctx.codes.consume(proof)).toBe(false);
  expect(ctx.check(next)).toBeDefined();
});

it('不能在外层未提交事务发信，调换临时密文在发送前拒绝解密', async () => {
  const ctx = world();
  const id = ctx.request();
  ctx.db.exec('BEGIN');
  try {
    await expect(ctx.codes.deliver(id)).rejects.toThrow('code-not-committed');
  } finally {
    ctx.db.exec('ROLLBACK');
  }
  expect(ctx.mails).toHaveLength(0);
  const other = ctx.request('b@example.com');
  ctx.db.prepare('UPDATE email_challenges SET email_payload = ? WHERE challenge_id = ?').run(ctx.row(other)?.email_payload ?? null, id);
  await expect(ctx.codes.deliver(id)).rejects.toThrow('email-authentication-failed');
  expect(ctx.row(id)?.state).toBe('queued');
  expect(ctx.mails).toHaveLength(0);
});

it('发送失败清除临时机密，额度和冷却仍保留', async () => {
  const ctx = world({
    sender: async () => {
      throw new Error('provider-secret');
    },
  });
  const id = ctx.request();
  await ctx.codes.deliver(id);
  expect(ctx.row(id)).toMatchObject({ state: 'failed', email_payload: null, code_mac: null, code_key_id: null });
  expect(ctx.check(id)).toBeUndefined();
  expect(ctx.codes.request({ email: ' A@EXAMPLE.COM ', purpose: 'reset', sourceHash: 'b'.repeat(64) })).toEqual({ retryAfterMs: CODE_COOLDOWN_MS });
  expect(ctx.deadlines[0]?.cancelled).toBe(true);
});

it('发送截止事件中止适配器，迟到成功保持 unknown，重启恢复同样不能复活', async () => {
  const started = deferred();
  const complete = deferred();
  let signal: AbortSignal | undefined;
  const ctx = world({
    sender: async (_mail, value) => {
      signal = value;
      started.resolve();
      await complete.promise;
    },
  });
  const id = ctx.request();
  const sending = ctx.codes.deliver(id);
  await started.promise;
  expect(ctx.deadlines[0]?.ms).toBe(CODE_SEND_TIMEOUT_MS);
  ctx.deadlines[0]?.fire();
  await sending;
  expect(signal?.aborted).toBe(true);
  expect(ctx.row(id)).toMatchObject({ state: 'unknown', email_payload: null, code_mac: null });
  complete.resolve();
  await complete.promise;
  expect(ctx.check(id)).toBeUndefined();
  ctx.now += CODE_COOLDOWN_MS;
  const second = ctx.request();
  const later = ctx.codes.deliver(second);
  await started.promise;
  // 用独立 queued->sending 转换模拟重启前已经开始、但没有回执的任务。
  await later;
  ctx.now += CODE_COOLDOWN_MS;
  const third = ctx.request();
  expect(ctx.codes.repo.start(third, { mac: 'a'.repeat(64), keyId: 'test' }, ctx.now)).toBe(true);
  expect(ctx.codes.repo.recover()).toBe(1);
  ctx.codes.repo.finish(third, 'sent', ctx.now);
  expect(ctx.row(third)).toMatchObject({ state: 'unknown', email_payload: null, code_mac: null });
});

it('过期任务不再发送，发送中到期清除机密，清理挑战不清掉日限额', async () => {
  const complete = deferred();
  const started = deferred();
  const ctx = world({
    sender: async () => {
      started.resolve();
      await complete.promise;
    },
  });
  const first = ctx.request();
  const sending = ctx.codes.deliver(first);
  await started.promise;
  ctx.now += CODE_TTL_MS;
  complete.resolve();
  await sending;
  expect(ctx.row(first)).toMatchObject({ state: 'unknown', code_mac: null, email_payload: null });
  for (let i = 1; i < 10; i++) {
    ctx.now += CODE_COOLDOWN_MS;
    ctx.request('a@example.com', 'register', i.toString(16).padStart(64, '0'));
  }
  ctx.now += CODE_TTL_MS;
  const last = ctx.serial.toString(16).padStart(32, '0');
  await ctx.codes.deliver(last);
  expect(ctx.row(last)?.state).toBe('queued');
  expect(ctx.codes.repo.prune(ctx.now)).toBe(10);
  expect(ctx.codes.request({ email: 'a@example.com', purpose: 'reset', sourceHash: 'b'.repeat(64) })).toHaveProperty('retryAfterMs');
});

it('全局和来源预算在昂贵操作前扣取，后续邮箱拒绝也计入来源', () => {
  const limited = world({ globalPerMinute: 1 });
  limited.request();
  expect(limited.codes.request({ email: 'b@example.com', purpose: 'reset', sourceHash: 'b'.repeat(64) })).toEqual({ retryAfterMs: 60000 });
  limited.now += 60000;
  expect(limited.request('b@example.com')).toHaveLength(32);
  const ctx = world();
  ctx.request();
  for (let i = 1; i < 10; i++)
    expect(ctx.codes.request({ email: 'a@example.com', purpose: 'reset', sourceHash: 'a'.repeat(64) })).toHaveProperty('retryAfterMs');
  expect(ctx.codes.request({ email: 'b@example.com', purpose: 'reset', sourceHash: 'a'.repeat(64) })).toEqual({ retryAfterMs: 3600000 });
});

it('非法预算、来源、时钟与随机输入拒绝；碰撞有限重试且内部错误回滚额度', async () => {
  for (const budget of [0, 1001, NaN]) expect(() => world({ globalPerMinute: budget })).toThrow('code-budget-invalid');
  const nextId = vi.fn(() => '1'.repeat(32));
  const ctx = world({ nextId });
  ctx.request();
  ctx.now += CODE_COOLDOWN_MS;
  expect(() => ctx.request('b@example.com')).toThrow('code-id-exhausted');
  expect(nextId).toHaveBeenCalledTimes(6);
  const row = ctx.db.prepare("SELECT history FROM auth_limits WHERE scope = 'code-global'").get();
  expect(JSON.parse(String(row?.history)).times).toHaveLength(1);
  expect(() => ctx.codes.request({ email: 'a@example.com', purpose: 'register', sourceHash: 'a'.repeat(64) + '\n' })).toThrow('code-input-invalid');
  const invalid = world({ nextId: () => 'bad' });
  expect(() => invalid.request()).toThrow('code-random-invalid');
  const badCode = world({ nextCode: () => '123456\n' });
  const id = badCode.request();
  await expect(badCode.codes.deliver(id)).rejects.toThrow('code-input-invalid');
  ctx.now = NaN;
  expect(() => ctx.request()).toThrow('auth-clock-invalid');
});

it('发送期间时钟回退，成功、失败或超时均结束为 unknown 并清除机密', async () => {
  for (const outcome of ['sent', 'failed', 'timeout']) {
    const entered = deferred();
    const complete = deferred();
    let deliveries = 0;
    const ctx = world({
      sender: async () => {
        deliveries++;
        ctx.now--;
        entered.resolve();
        if (outcome === 'failed') throw new Error('provider-failed');
        if (outcome === 'timeout') await complete.promise;
      },
    });
    const id = ctx.request();
    const delivery = ctx.codes.deliver(id);
    await entered.promise;
    if (outcome === 'timeout') ctx.deadlines[0]?.fire();
    await delivery;
    complete.resolve();
    expect(ctx.row(id)).toMatchObject({ state: 'unknown', email_payload: null, code_mac: null, code_key_id: null, sent_at: null });
    ctx.now += 2;
    expect(ctx.check(id)).toBeUndefined();
    await ctx.codes.deliver(id);
    expect(deliveries).toBe(1);
  }
});

it('发送后时钟损坏仍先清除机密，再明确拒绝而不留下 sending', async () => {
  const ctx = world({
    sender: async () => {
      ctx.now = NaN;
    },
  });
  const id = ctx.request();
  await expect(ctx.codes.deliver(id)).rejects.toThrow('auth-clock-invalid');
  expect(ctx.row(id)).toMatchObject({ state: 'unknown', email_payload: null, code_mac: null, code_key_id: null, sent_at: null });
});

it('受理结果带十分钟期限与六十秒冷却，与实际冷却拒绝一致', () => {
  const ctx = world();
  const admitted = ctx.codes.request({ email: 'a@example.com', purpose: 'register', sourceHash: 'a'.repeat(64) });
  expect(admitted).toEqual({ challengeId: expect.any(String), expiresAt: ctx.now + CODE_TTL_MS, resendAfterMs: CODE_COOLDOWN_MS });
  expect(ctx.codes.request({ email: 'a@example.com', purpose: 'register', sourceHash: 'a'.repeat(64) })).toEqual({ retryAfterMs: CODE_COOLDOWN_MS });
  if (!('challengeId' in admitted)) throw new Error('test-admission-rejected');
  expect(ctx.row(admitted.challengeId)?.expires_at).toBe(admitted.expiresAt);
});

it('发送进度按状态映射且只读，失效、替换、消费、用尽或不存在时为空', async () => {
  const ctx = world();
  const id = ctx.request();
  const expiresAt = ctx.now + CODE_TTL_MS;
  expect(ctx.codes.delivery(id)).toEqual({ state: 'pending', expiresAt });
  await ctx.codes.deliver(id);
  expect(ctx.codes.delivery(id)).toEqual({ state: 'sent', expiresAt });
  for (let i = 0; i < 4; i++) ctx.check(id, '999999');
  expect(ctx.codes.delivery(id)?.state).toBe('sent');
  expect(ctx.row(id)).toMatchObject({ state: 'sent', attempts: 4 });
  ctx.check(id, '999999');
  expect(ctx.codes.delivery(id)).toBeUndefined();
  expect(ctx.codes.delivery('f'.repeat(32))).toBeUndefined();
  ctx.now += CODE_COOLDOWN_MS;
  const used = ctx.request();
  await ctx.codes.deliver(used);
  const proof = ctx.check(used);
  if (!proof) throw new Error('test-proof-missing');
  ctx.codes.consume(proof);
  expect(ctx.codes.delivery(used)).toBeUndefined();
  const old = ctx.request('b@example.com');
  ctx.now += CODE_COOLDOWN_MS;
  ctx.request('b@example.com');
  expect(ctx.codes.delivery(old)).toBeUndefined();
  const late = ctx.request('c@example.com');
  ctx.now += CODE_TTL_MS;
  expect(ctx.codes.delivery(late)).toBeUndefined();
});

it('发送失败与超时结果不明都提示重新申请', async () => {
  const failing = world({ sender: async () => Promise.reject(new Error('fixture-send')) });
  const failed = failing.request();
  await failing.codes.deliver(failed);
  expect(failing.row(failed)?.state).toBe('failed');
  expect(failing.codes.delivery(failed)?.state).toBe('retry');
  const started = deferred();
  const complete = deferred();
  const hanging = world({
    sender: async () => {
      started.resolve();
      await complete.promise;
    },
  });
  const unknown = hanging.request();
  const pending = hanging.codes.deliver(unknown);
  await started.promise;
  expect(hanging.codes.delivery(unknown)?.state).toBe('pending');
  hanging.deadlines[0]?.fire();
  await pending;
  complete.resolve();
  expect(hanging.row(unknown)?.state).toBe('unknown');
  expect(hanging.codes.delivery(unknown)?.state).toBe('retry');
});

it('发送时带上申请时的界面语言，未指明时为中文', async () => {
  const ctx = world();
  const id = ctx.request();
  await ctx.codes.deliver(id, 'lzh');
  expect(ctx.mails.map(mail => mail.language)).toEqual(['lzh']);
});
