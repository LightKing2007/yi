/** 联机服务端：限流与违规、全局上限、连接层的限制（API-040 至 API-047） */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PENDING_MAX } from '../server/rooms';
import { HTTP_LIMITS, hardenHttp, startHost } from '../server/host';
import { fileServer } from '../server/files';
import { CLOSE_CODE, HELLO_SECS, PROTO_VERSION, type S2C } from '../src/shared/protocol';
import { must } from './must';
import { expectClientAccepts, newUid, Client, world, startGame } from './serverWorld';

const LIMITED = { t: 'error', code: 'rate.limited', level: 'E3' };
/** 绕过类型检查，发一条任意内容的消息 */
const raw = (client: Client, m: unknown) => {
  client.sess = client.srv.message(client.sess, m, client.conn);
};

describe('限流与违规（API-042 至 API-046）', () => {
  it('消息洪泛：超出令牌桶的消息被丢弃且只提示一次，持续洪泛即以 1008 断开，5 分钟内同一身份连不上', () => {
    const { srv, advance } = world();
    const jia = new Client(srv, '甲');
    jia.drain();
    for (let i = 0; i < 50; i++) jia.send({ t: 'ping' }); // 握手已用掉 1 个令牌，余 39 个
    expect(jia.inbox.filter(m => m.t === 'pong')).toHaveLength(39);
    expect(jia.inbox.filter(m => m.t === 'error')).toEqual([LIMITED]);
    expect(jia.closeCode).toBe(CLOSE_CODE.policy); // 第 10 条被丢弃的消息累计到上限
    const again = new Client(srv, '甲', undefined, jia.uid);
    expect(again.welcome).toBeUndefined();
    expect(again.inbox).toEqual([LIMITED]);
    expect(again.closeCode).toBe(CLOSE_CODE.policy);
    expect(new Client(srv, '乙').welcome).toBeTruthy(); // 其他身份不受影响
    advance(5 * 60);
    expect(new Client(srv, '甲', undefined, jia.uid).welcome).toBeTruthy();
  });

  it('令牌按每秒 20 个恢复：洪泛停下 1 秒后照常处理', () => {
    const { srv, advance } = world();
    const jia = new Client(srv, '甲');
    for (let i = 0; i < 40; i++) jia.send({ t: 'ping' });
    expect(jia.inbox.at(-1)).toEqual(LIMITED);
    advance(1);
    jia.drain();
    for (let i = 0; i < 20; i++) jia.send({ t: 'ping' });
    expect(jia.inbox).toEqual(Array(20).fill({ t: 'pong' }));
    expect(jia.closed).toBe(false);
  });

  it('对局中 60 秒内累计 10 次非法消息即被断开，带令牌也重连不上，到时按掉线判负', () => {
    const { srv, idle } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    for (let i = 0; i < 9; i++) raw(jia, { t: 'move', x: -1, y: 0 });
    expect(jia.closed).toBe(false);
    raw(jia, { t: 'move', x: -1, y: 0 });
    expect(jia.closeCode).toBe(CLOSE_CODE.policy);
    expect(yi.expect('peer')?.online).toBe(false);
    const back = new Client(srv, '甲', jia.token, jia.uid);
    expect(back.closeCode).toBe(CLOSE_CODE.policy);
    idle(61, yi);
    expect(yi.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'disconnect' });
  });

  it('违规分散在 60 秒以外的不累计', () => {
    const { srv, idle } = world();
    const jia = new Client(srv, '甲');
    for (let i = 0; i < 9; i++) raw(jia, { t: 'nope' });
    idle(60, jia);
    for (let i = 0; i < 9; i++) raw(jia, { t: 'nope' });
    expect(jia.closed).toBe(false);
  });
});

describe('握手时限、改名与匹配队列的次数（API-044）', () => {
  it('握手超时：10 秒内没有发来合法的 hello 即以 4008 关闭，心跳回应不延长时限', () => {
    const { srv, advance } = world();
    let code: number | undefined;
    const sess = must(
      srv.connect({
        send: () => {},
        close: closeCode => {
          code = closeCode;
        },
      }) ?? undefined,
      '服务端接受的连接',
    );
    srv.message(sess, { t: 'ping' });
    advance(HELLO_SECS - 1);
    srv.touch(sess);
    expect(code).toBeUndefined();
    advance(2);
    expect(code).toBe(CLOSE_CODE.helloTimeout);
    const jia = new Client(srv, '甲');
    advance(HELLO_SECS * 2);
    expect(jia.closed).toBe(false);
  });

  it('改名：与当前昵称相同的不计次数，真正改名每 10 秒至多 1 次（API-044）', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      ding = new Client(srv, '丁');
    jia.drain();
    for (let i = 0; i < 5; i++) jia.send({ t: 'name', name: '甲' }); // 客户端每次匹配前都会发一次
    jia.send({ t: 'name', name: '乙' });
    expect(jia.inbox).toEqual([]);
    jia.send({ t: 'name', name: '丙' });
    expect(jia.inbox).toEqual([LIMITED]);
    jia.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    ding.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(ding.expect('found')?.opp.name).toBe('乙');
  });

  it('进入、退出匹配队列合计每 10 秒至多 10 次（API-044）', () => {
    const { srv, idle } = world();
    const jia = new Client(srv, '甲');
    for (let i = 0; i < 5; i++) {
      jia.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
      jia.send({ t: 'unqueue' });
    }
    jia.drain();
    jia.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(jia.inbox).toEqual([LIMITED]);
    expect(srv.queued('match', 0)).toBe(0);
    idle(10, jia);
    jia.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(srv.queued('match', 0)).toBe(1);
  });
});

describe('全局上限（API-046）', () => {
  it('满员时对局中掉线的玩家带令牌重连，仍能回到原来的对局，不被告知服务器繁忙', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    for (let i = 2; i < 2048; i++) new Client(srv, '丙');
    expect(srv.health().players).toBe(2048);
    yi.drop();
    const back = new Client(srv, '乙', yi.token, yi.uid);
    expect(back.has('error')).toBe(false);
    expect(back.welcome?.id).toBe(yi.id);
    expect(back.expect('sync')).toBeTruthy();
    expect(jia.expect('peer', m => m.online)).toBeTruthy();
  });

  it('满员时新玩家握手被告知服务器繁忙，并以 1013 断开（API-046）', () => {
    const { srv } = world();
    for (let i = 0; i < 2048; i++) new Client(srv, '丙');
    const late = new Client(srv, '丁');
    expect(late.welcome).toBeUndefined();
    expect(late.inbox).toEqual([{ t: 'error', code: 'server.full', level: 'E2' }]);
    expect(late.closeCode).toBe(CLOSE_CODE.overload);
    expect(srv.health().players).toBe(2048);
  });

  it('同时建立 500 条尚未握手的连接（服务端压测的情形）时全部接受，随后都能握手', () => {
    const { srv } = world();
    const conns = Array.from({ length: 500 }, () => ({ send: () => {}, close: () => {} }));
    const sessions = conns.map(conn => srv.connect(conn));
    expect(sessions.filter(sess => sess === null)).toHaveLength(0);
    sessions.forEach((sess, i) => sess && srv.message(sess, { t: 'hello', v: PROTO_VERSION, name: '丙', uid: newUid() }, conns[i]));
    expect(srv.health().players).toBe(500);
  });

  it('尚未握手的连接达到上限时，新连接直接被告知服务器繁忙（API-046）', () => {
    const { srv } = world();
    for (let i = 0; i < PENDING_MAX; i++) expect(srv.connect({ send: () => {}, close: () => {} })).not.toBeNull();
    const inbox: S2C[] = [];
    expect(srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: () => {} })).toBeNull();
    expect(inbox).toEqual([{ t: 'error', code: 'server.full', level: 'E2' }]);
  });
});

describe('连接层的限制（API-041、API-042、API-047）', () => {
  /** 连上并握手：收到 welcome 时返回 'welcome' 并断开，连接被关闭时返回关闭码 */
  const attempt = (url: string) =>
    new Promise<number | 'welcome'>((res, rej) => {
      const ws = new WebSocket(url);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: '甲', uid: newUid() })));
      ws.on('message', () => {
        ws.terminate();
        res('welcome');
      });
      ws.on('close', code => res(code));
      ws.on('error', rej);
    });
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise(r => setTimeout(r, 5));
  };

  it('同一 IP 每分钟新建连接超过 30 次即以 1013 关闭，此后 60 秒内仍被拒', async () => {
    let clock = 1000;
    const host = await startHost(0, { host: '127.0.0.1', now: () => clock });
    const url = `ws://127.0.0.1:${host.port}`;
    try {
      for (let i = 0; i < 30; i++) {
        expect(await attempt(url)).toBe('welcome');
        await until(() => host.server.online() === 0); // 等服务端处理完断开，免得撞上同时连接数的上限
      }
      expect(await attempt(url)).toBe(CLOSE_CODE.overload);
      clock += 59;
      expect(await attempt(url)).toBe(CLOSE_CODE.overload);
      clock += 1;
      expect(await attempt(url)).toBe('welcome');
    } finally {
      await host.close();
    }
  });

  it('经本机反向代理的连接按真实地址计数：同一地址的第 9 条连接以 1013 关闭，其他地址照常连上（API-040）', async () => {
    const host = await startHost(0, { host: '127.0.0.1' });
    const url = `ws://127.0.0.1:${host.port}`;
    const opened: WebSocket[] = [];
    /** 以代理转来的方式连上并握手，连接保持不断：收到 welcome 时返回 'welcome'，连接被关闭时返回关闭码 */
    const viaProxy = (ip: string) =>
      new Promise<number | 'welcome'>((res, rej) => {
        const ws = new WebSocket(url, { headers: { 'X-Forwarded-For': ip } });
        opened.push(ws);
        ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: '甲', uid: newUid() })));
        ws.once('message', () => res('welcome'));
        ws.on('close', code => res(code));
        ws.on('error', rej);
      });
    try {
      for (let i = 0; i < 8; i++) expect(await viaProxy('198.51.100.1')).toBe('welcome');
      expect(await viaProxy('198.51.100.1')).toBe(CLOSE_CODE.overload);
      expect(await viaProxy('198.51.100.2')).toBe('welcome');
    } finally {
      for (const ws of opened) ws.terminate();
      await host.close();
    }
  });
});

describe('连接与下载的超时（API-047）', () => {
  it('真实连接上握手超时以 4008 关闭', async () => {
    let clock = 1000;
    const host = await startHost(0, { host: '127.0.0.1', now: () => clock });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}`);
      const closed = new Promise<number>(r => ws.on('close', code => r(code)));
      await new Promise((res, rej) => {
        ws.on('open', res);
        ws.on('error', rej);
      });
      clock += HELLO_SECS + 1;
      expect(await closed).toBe(CLOSE_CODE.helloTimeout);
    } finally {
      await host.close();
    }
  });

  it('HTTP 服务器设有超时与请求头上限（API-047）', () => {
    const server = http.createServer();
    hardenHttp(server);
    expect({
      headersTimeout: server.headersTimeout,
      requestTimeout: server.requestTimeout,
      keepAliveTimeout: server.keepAliveTimeout,
      maxHeadersCount: server.maxHeadersCount,
    }).toEqual(HTTP_LIMITS);
  });

  it('下载方长时间不读取时断开下载，释放下载名额（API-047）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    const file = 'Yi-2.0.5-linux-x86_64.AppImage';
    fs.closeSync(fs.openSync(path.join(dir, file), 'w'));
    fs.truncateSync(path.join(dir, file), 256 * 1024 * 1024); // 稀疏文件：远大于套接字缓冲区，不占磁盘
    const handle = fileServer(dir, { stallMs: 100, minBytesPerSec: 1024 });
    /** 服务端这一侧的响应关闭时，是否已把文件写完 */
    let finished: (done: boolean) => void = () => {};
    const closed = new Promise<boolean>(r => {
      finished = r;
    });
    const srv = http.createServer((req, res) => {
      res.on('close', () => finished(res.writableFinished));
      handle(req, res);
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    try {
      const { port } = srv.address() as { port: number };
      const req = http.get(`http://127.0.0.1:${port}/${file}`, r => r.pause()); // 收到响应头后不再读取
      req.on('error', () => {}); // 被断开时的 ECONNRESET 正是预期
      expect(await closed).toBe(false);
    } finally {
      srv.closeAllConnections();
      await new Promise(r => srv.close(r));
      fs.rmSync(dir, { recursive: true });
    }
  });
});
