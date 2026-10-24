/** 联机服务端的运行（server/serve.ts）：启动、日志汇总与指标快照、维护模式、关闭，数据库与端口出错时的退出码 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { parseConfig } from '../server/config';
import { Logger } from '../server/log';
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
    expect(start).toMatchObject({ msg: '弈 联机服务端已启动', protoRange: [3, 3], dbFile: path.join(dir, 'yi.db') });
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
