/** 联机服务端的运行（server/serve.ts）：启动、日志汇总与指标快照、维护模式、关闭，数据库与端口出错时的退出码 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { parseConfig } from '../server/config';
import { Logger } from '../server/log';
import { KEYS_CREDENTIAL, newAccountKeys, SMTP_CREDENTIAL } from '../server/accountSecrets';
import { ACCOUNT_PRUNE_MS } from '../server/accountService';
import { LOG_FLUSH_MS, SNAPSHOT_MS, serve, type ServeDeps } from '../server/serve';
import { PROTO_VERSION } from '../src/shared/protocol';
import { newUid } from './serverWorld';

let dir = '';
const handles: (() => void)[] = [];

/** 以假的进程依赖运行 serve：记下日志、退出码、信号处理函数与定时器 */
function harness(port = 0, env: Record<string, string> = {}) {
  const lines: { event: string; [key: string]: unknown }[] = [];
  const logger = new Logger({ ver: 'test', write: line => lines.push(JSON.parse(line)), now: () => 1000 });
  const config = { ...parseConfig([], { YI_DB: path.join(dir, 'yi.db'), ...env }, dir).config, port };
  const exits: number[] = [];
  const signals = new Map<string, () => void>();
  const timers = new Map<number, { fn: () => void; stopped: boolean }>();
  let snapshotsAfter = 0;
  const deps: ServeDeps = {
    config,
    logger,
    build: { version: '3.0.0', commit: 'abc1234' },
    now: () => 1000,
    exit: code => exits.push(code),
    onSignal: (signal, handler) => signals.set(signal, handler),
    every: (ms, fn) => {
      const timer = { fn, stopped: false };
      timers.set(ms, timer);
      return () => (timer.stopped = true);
    },
    eventLoopLag: () => 0.01,
    afterSnapshot: () => snapshotsAfter++,
  };
  const events = () => lines.map(line => line.event);
  return { deps, lines, events, exits, signals, timers, snapshots: () => snapshotsAfter };
}

/** 等 exit 被调用（关闭是异步的） */
async function exited(exits: number[]) {
  for (let i = 0; i < 100 && !exits.length; i++) await new Promise(resolve => setImmediate(resolve));
  return exits;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-serve-'));
});

afterEach(() => {
  for (const close of handles.splice(0)) close();
  fs.rmSync(dir, { recursive: true });
});

describe('服务端的运行', () => {
  it('启动：打开数据库、监听端口，写 server.start；按间隔输出日志汇总与指标快照', async () => {
    const run = harness();
    await serve(run.deps);
    expect(run.events()).toEqual(['db.migrating', 'db.migrated', 'db.opened', 'server.start']);
    const start = run.lines.at(-1);
    expect(start).toMatchObject({ msg: '弈 联机服务端已启动', protoRange: [4, 4], dbFile: path.join(dir, 'yi.db') });
    const [port] = start?.ports as number[];
    const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
    expect(health).toMatchObject({ version: '3.0.0', commit: 'abc1234', maintenance: false });
    expect([...run.timers.keys()]).toEqual([LOG_FLUSH_MS, SNAPSHOT_MS]);
    run.timers.get(SNAPSHOT_MS)?.fn();
    expect(run.lines.at(-1)).toMatchObject({ event: 'metrics.snapshot', yi_event_loop_lag_seconds: 0.01 });
    expect(run.snapshots()).toBe(1);
    run.signals.get('SIGTERM')?.();
    expect(await exited(run.exits)).toEqual([0]);
  });

  it('SIGUSR2 进入维护模式；SIGINT 关闭：写 server.stop、停止定时器、关闭数据库与端口后以 0 退出', async () => {
    const run = harness();
    await serve(run.deps);
    const [port] = run.lines.at(-1)?.ports as number[];
    run.signals.get('SIGUSR2')?.();
    expect(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).toMatchObject({ maintenance: true });
    run.signals.get('SIGINT')?.();
    expect(await exited(run.exits)).toEqual([0]);
    expect(run.events()).toContain('server.stop');
    expect([...run.timers.values()].map(timer => timer.stopped)).toEqual([true, true]);
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'yi.db-wal'))).toBe(false); // 最后一个连接关闭时 SQLite 做检查点并删除 WAL 文件
  });
});

/** 连上 port 并握手；next(type) 等到这一类消息为止 */
async function player(port: number, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox: { t: string; code?: string }[] = [];
  let wake = () => {};
  ws.on('message', data => {
    inbox.push(JSON.parse(String(data)));
    wake();
  });
  const next = async (type: string) => {
    for (;;) {
      const i = inbox.findIndex(msg => msg.t === type);
      if (i >= 0) return inbox.splice(0, i + 1).at(-1);
      await new Promise<void>(res => (wake = res));
    }
  };
  await new Promise(res => ws.on('open', res));
  ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name, uid: newUid() }));
  await next('welcome');
  return { send: (msg: object) => ws.send(JSON.stringify(msg)), next, close: () => ws.close() };
}

describe('数据库的监控指标', () => {
  it('指标快照中有数据库文件的大小，开局写对局记录的事务计入事务耗时', async () => {
    const run = harness();
    await serve(run.deps);
    const [port = 0] = run.lines.at(-1)?.ports as number[];
    const [host, guest] = [await player(port, '甲'), await player(port, '乙')];
    host.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
    guest.send({ t: 'join', code: (await host.next('created'))?.code });
    await guest.next('start');
    run.timers.get(SNAPSHOT_MS)?.fn();
    const bytes = fs.statSync(path.join(dir, 'yi.db')).size + fs.statSync(path.join(dir, 'yi.db-wal')).size;
    expect(run.lines.at(-1)).toMatchObject({ event: 'metrics.snapshot', yi_db_transaction_seconds_count: 1, yi_db_file_bytes: bytes, yi_join_fail_ips: 0 });
    host.close();
    guest.close();
    run.signals.get('SIGTERM')?.();
    expect(await exited(run.exits)).toEqual([0]);
  });
});

describe('服务端运行时出错', () => {
  it('数据库损坏时写 db.open-failed，以 65 退出，不监听端口', async () => {
    fs.writeFileSync(path.join(dir, 'yi.db'), 'garbage'.repeat(1000));
    const run = harness();
    await serve(run.deps);
    expect(run.exits).toEqual([65]);
    expect(run.events()).toEqual(['db.open-failed']);
    expect(run.timers.size).toBe(0);
  });

  it('端口被占用时写 server.listen-failed，关闭数据库、停止定时器，以 1 退出', async () => {
    const busy = net.createServer();
    await new Promise<void>(resolve => busy.listen(0, '127.0.0.1', resolve));
    handles.push(() => busy.close());
    const port = (busy.address() as net.AddressInfo).port;
    const run = harness(port, { HOST: '127.0.0.1' });
    await serve(run.deps);
    expect(run.exits).toEqual([1]);
    expect(run.lines.at(-1)).toMatchObject({ event: 'server.listen-failed', ports: [port] });
    expect(run.timers.get(LOG_FLUSH_MS)?.stopped).toBe(true);
    expect(fs.existsSync(path.join(dir, 'yi.db-wal'))).toBe(false); // 数据库已关闭
  });
});

describe('账号功能', () => {
  /** 打开账号功能的环境变量；凭据目录在临时目录下 */
  const accountsOn = () => ({ YI_ACCOUNTS: '1', YI_PRIVACY_VERSION: 'p1', YI_TERMS_VERSION: 't1', CREDENTIALS_DIRECTORY: path.join(dir, 'creds') });
  const smtp = { host: 'smtpdm.example.com', port: 465, username: 'a@b.cn', password: 'fixture', fromAddress: 'a@b.cn', fromName: '弈' };

  it('关闭时账号接口一律 404，不注册定时清理', async () => {
    const run = harness();
    await serve(run.deps);
    const [port] = run.lines.at(-1)?.ports as number[];
    expect((await fetch(`http://127.0.0.1:${port}/api/v1/consents/required`)).status).toBe(404);
    expect(run.timers.has(ACCOUNT_PRUNE_MS)).toBe(false);
    run.signals.get('SIGTERM')?.();
    await exited(run.exits);
  });

  it('凭据合格时提供账号接口，按 IP 限流时回应统一错误格式；关闭时停止定时清理', async () => {
    fs.mkdirSync(path.join(dir, 'creds'));
    fs.writeFileSync(path.join(dir, 'creds', KEYS_CREDENTIAL), newAccountKeys());
    fs.writeFileSync(path.join(dir, 'creds', SMTP_CREDENTIAL), JSON.stringify(smtp));
    const run = harness(0, accountsOn());
    await serve(run.deps);
    expect(run.events()).toEqual(['db.migrating', 'db.migrated', 'db.opened', 'account.enabled', 'server.start']);
    const [port] = run.lines.at(-1)?.ports as number[];
    const url = `http://127.0.0.1:${port}/api/v1/consents/required`;
    expect(await (await fetch(url)).json()).toMatchObject({ privacy: 'p1', terms: 't1' });
    const external = { headers: { 'X-Forwarded-For': '203.0.113.7', Origin: 'app://yi' } };
    let answer = await fetch(url, external);
    for (let i = 0; i < 40 && answer.status !== 429; i++) answer = await fetch(url, external);
    expect([answer.status, answer.headers.get('content-type'), answer.headers.get('access-control-allow-origin')]).toEqual([
      429,
      'application/problem+json; charset=utf-8',
      'app://yi',
    ]);
    run.signals.get('SIGTERM')?.();
    expect(await exited(run.exits)).toEqual([0]);
    expect(run.timers.get(ACCOUNT_PRUNE_MS)?.stopped).toBe(true);
  });

  it('凭据缺失时逐项写 account.secrets-invalid、不监听端口，以 78 退出；日志不含密钥', async () => {
    fs.mkdirSync(path.join(dir, 'creds'));
    fs.writeFileSync(path.join(dir, 'creds', SMTP_CREDENTIAL), JSON.stringify({ ...smtp, password: 'leak-me', port: 0 }));
    const run = harness(0, accountsOn());
    await serve(run.deps);
    expect(run.exits).toEqual([78]);
    expect(run.events()).toEqual(['db.migrating', 'db.migrated', 'db.opened', 'account.secrets-invalid', 'account.secrets-invalid']);
    expect(run.lines.slice(-2).map(line => line.credential)).toEqual([KEYS_CREDENTIAL, SMTP_CREDENTIAL]);
    expect(JSON.stringify(run.lines)).not.toContain('leak-me');
    expect(run.timers.size).toBe(0);
  });
});
