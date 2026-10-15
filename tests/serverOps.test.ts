/** 联机服务端：日志事件、维护模式、健康检查、关闭与监控指标（07-operations.md、API-061、OPS-045） */
import http from 'node:http';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MemoryStore } from '../server/rooms';
import { startHost } from '../server/host';
import { withHealth } from '../server/health';
import { Metrics } from '../server/metrics';
import type { Log, LogEntry, LogLevel } from '../server/log';
import { CLOSE_CODE, CONFIRM_SECS, PROTO_VERSION, type C2S } from '../src/shared/protocol';
import { newUid, Client, world, play, startGame, matchUp } from './serverWorld';

describe('服务端日志的事件（07-operations.md 第 8 节）', () => {
  /** 带日志的服务端：logs 依次记下每一行的级别、事件码与内容 */
  const logged = () => {
    const logs: { level: LogLevel; event: string; entry: LogEntry }[] = [];
    const w = world(new MemoryStore(), { log: (level, event, entry = {}) => logs.push({ level, event, entry }) });
    const events = (...names: string[]) => logs.filter(row => names.includes(row.event));
    return { ...w, logs, events };
  };

  it('排位一局：上线、配对、开局、终局、两人的段位变化依次记下，带玩家、房间与对局编号', () => {
    const { srv, events } = logged();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    const { sa } = matchUp(a, b, 'ranked');
    const [blk, wht] = sa.color === 1 ? [a, b] : [b, a];
    blk.send({ t: 'move', x: 7, y: 7 });
    wht.send({ t: 'resign' });
    expect(events('player.online').map(row => row.entry.playerId)).toEqual([a.id, b.id]);
    expect(events('match.paired', 'game.start', 'game.over', 'rating.changed').map(row => [row.event, row.entry])).toEqual([
      ['match.paired', expect.objectContaining({ mode: 'ranked', playerId: b.id, opponentId: a.id })],
      ['game.start', expect.objectContaining({ roomId: 1, gameId: 1, kind: 'ranked' })],
      ['game.over', expect.objectContaining({ roomId: 1, gameId: 1, winner: 1, reason: 'resign', moves: 1 })],
      ['rating.changed', expect.objectContaining({ playerId: blk.id, roomId: 1, gameId: 1, before: 1200, after: 1216 })],
      ['rating.changed', expect.objectContaining({ playerId: wht.id, roomId: 1, gameId: 1, before: 1200, after: 1184 })],
    ]);
  });

  it('好友房间：开房间记下房间号；再来一局换新的对局编号，房间号不变', () => {
    const { srv, events } = logged();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b);
    a.send({ t: 'resign' });
    a.send({ t: 'rematch' });
    b.send({ t: 'reply', kind: 'rematch', ok: true });
    expect(events('room.created')).toEqual([{ level: 'info', event: 'room.created', entry: expect.objectContaining({ roomId: 1, playerId: a.id }) }]);
    expect(events('game.start').map(row => [row.entry.roomId, row.entry.gameId])).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });

  it('好友房间的路数与匹配相同：围棋选 15 路时按 19 路开局，五子棋固定 15 路', () => {
    const { srv } = logged();
    const go = startGame(new Client(srv, '甲'), new Client(srv, '乙'), { type: 1, size: 15, renju: true });
    const gomoku = startGame(new Client(srv, '丙'), new Client(srv, '丁'), { type: 0, size: 19 });
    expect([go.sa.size, go.sa.renju, gomoku.sa.size, gomoku.sa.renju]).toEqual([19, false, 15, true]);
  });

  it('断开与重连：断开时记下关闭码，重连时记下回到的房间', () => {
    const { srv, events } = logged();
    const a = new Client(srv, '甲'),
      c = new Client(srv, '丙');
    startGame(a, c);
    srv.disconnect(c.sess, c.conn, 1006);
    new Client(srv, '丙', c.token);
    expect(events('player.offline', 'player.resumed').map(row => [row.event, row.entry])).toEqual([
      ['player.offline', expect.objectContaining({ playerId: c.id, code: 1006 })],
      ['player.resumed', expect.objectContaining({ playerId: c.id, roomId: 1 })],
    ]);
  });

  it('消息洪泛：限流每秒只记一行并带累计违规次数，断开时记下 1008', () => {
    const { srv, events } = logged();
    const a = new Client(srv, '甲');
    for (let i = 0; i < 50; i++) a.send({ t: 'ping' });
    expect(events('rate.limited', 'conn.kicked', 'player.offline').map(row => [row.level, row.event, row.entry])).toEqual([
      ['warn', 'rate.limited', { playerId: a.id, count: 1 }],
      ['warn', 'conn.kicked', expect.objectContaining({ playerId: a.id, code: CLOSE_CODE.policy })],
      ['info', 'player.offline', expect.objectContaining({ playerId: a.id, code: CLOSE_CODE.policy })],
    ]);
  });

  it('真实连接关闭时，日志中的关闭码取自对方发来的关闭帧', async () => {
    let offline: (code: unknown) => void = () => {};
    const offlineCode = new Promise(res => (offline = res));
    const log: Log = (_level, event, entry) => {
      if (event === 'player.offline') offline(entry?.code);
    };
    const host = await startHost(0, { host: '127.0.0.1', log });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}`);
      await new Promise(res => ws.on('open', res));
      ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: '甲', uid: newUid() }));
      await new Promise(res => ws.once('message', res));
      ws.close(4100);
      expect(await offlineCode).toBe(4100);
    } finally {
      await host.close();
    }
  });
});

const MAINT = '服务器即将维护，暂不开始新的对局';

/** 带日志的服务端，以及处在各种状态的玩家：对局中（甲乙）、排队（丙）、待确认（丁戊）、等待对手（己）、在大厅（庚） */
function busyWorld() {
  const logs: { event: string; entry: LogEntry }[] = [];
  const env = world(new MemoryStore(), { log: (_level, event, entry = {}) => logs.push({ event, entry }) });
  const client = (name: string) => new Client(env.srv, name);
  const [black, white, queuer, pairA, pairB, host, idler] = [
    client('甲'),
    client('乙'),
    client('丙'),
    client('丁'),
    client('戊'),
    client('己'),
    client('庚'),
  ] as const;
  startGame(black, white);
  queuer.send({ t: 'queue', mode: 'match', type: 1, size: 19 });
  expect(queuer.expect('queued')).toBeTruthy();
  pairA.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
  pairB.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
  expect(pairA.expect('found') && pairB.expect('found')).toBeTruthy();
  host.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
  const code = host.expect('created')?.code ?? '';
  const all = [black, white, queuer, pairA, pairB, host, idler];
  for (const cl of all) cl.drain();
  return { ...env, logs, black, white, queuer, pairA, pairB, host, idler, code };
}

describe('维护模式（OPS-045）', () => {
  it('进入时取消排队、待确认的配对与等待对手的房间，受影响的收到 error，其余在线玩家收到 info；对局照常下完', () => {
    const { srv, advance, logs, black, white, queuer, pairA, pairB, host, idler, code } = busyWorld();
    srv.connect({ send: () => {}, close: () => {} }); // 尚未握手的连接不计入在线玩家
    expect(srv.health()).toEqual({ players: 7, games: 1, maintenance: false });
    expect(srv.maintain()).toBe(true);
    for (const cl of [queuer, pairA, pairB, host]) expect(cl.inbox, cl.name).toEqual([{ t: 'error', text: MAINT }]);
    for (const cl of [black, white, idler]) expect(cl.inbox, cl.name).toEqual([{ t: 'info', text: MAINT }]);
    expect(srv.health()).toEqual({ players: 7, games: 1, maintenance: true });
    expect(srv.queued('match', 1)).toBe(0);
    // 已取消的配对到时也不会开局，也不再有任何消息；等待中的房间已不在
    pairA.drain();
    pairB.drain();
    pairA.send({ t: 'confirm', ok: true });
    pairB.send({ t: 'confirm', ok: true });
    advance(CONFIRM_SECS + 1);
    expect([...pairA.inbox, ...pairB.inbox]).toEqual([]);
    idler.send({ t: 'join', code });
    expect(idler.expect('joinNo')).toEqual({ t: 'joinNo', reason: MAINT });
    play(black, white, [[black, 7, 7]]); // 对局中的照常下
    // 只记一行；再次进入什么也不做
    expect(srv.maintain()).toBe(false);
    expect(logs.filter(row => row.event === 'server.maintenance').map(row => row.entry)).toEqual([expect.objectContaining({ games: 1, players: 7 })]);
  });

  it('此后拒绝排队、开房、加入与再来一局；新上线的玩家在 welcome 之后收到通知', () => {
    const { srv, black, white, queuer, idler } = busyWorld();
    black.send({ t: 'resign' });
    expect(white.expect('over')).toBeTruthy();
    srv.maintain();
    queuer.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(queuer.inbox).toEqual([
      { t: 'error', text: MAINT },
      { t: 'error', text: MAINT },
    ]);
    expect(srv.queued('match', 0)).toBe(0);
    idler.drain();
    idler.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
    expect(idler.inbox).toEqual([{ t: 'error', text: MAINT }]);
    black.drain();
    black.send({ t: 'rematch' });
    expect(black.inbox).toEqual([{ t: 'info', text: MAINT }]);
    expect(white.has('ask')).toBe(false);
    const late = new Client(srv, '辛');
    expect(late.welcome).toBeTruthy();
    expect(late.inbox).toEqual([{ t: 'info', text: MAINT }]);
    expect(srv.health()).toEqual({ players: 8, games: 0, maintenance: true });
  });

  it('进入时撤回待回应的再来一局申请：对方随后同意也不开局', () => {
    const { srv } = world();
    const [asker, replier] = [new Client(srv, '甲'), new Client(srv, '乙')];
    startGame(asker, replier);
    asker.send({ t: 'resign' });
    asker.send({ t: 'rematch' });
    expect(replier.expect('ask')).toEqual({ t: 'ask', kind: 'rematch' });
    srv.maintain();
    asker.drain();
    replier.drain();
    replier.send({ t: 'reply', kind: 'rematch', ok: true });
    expect([...asker.inbox, ...replier.inbox]).toEqual([]);
  });
});

describe('健康检查（API-061）', () => {
  const build = { version: '9.8.7', commit: 'abc1234' };

  it('本机的 GET /healthz 返回版本号、提交号、协议版本、在线玩家、对局数与维护状态', async () => {
    const host = await startHost(0, { host: '127.0.0.1', build });
    try {
      const url = `http://127.0.0.1:${host.port}/healthz`;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await res.json()).toEqual({ version: '9.8.7', commit: 'abc1234', proto: PROTO_VERSION, players: 0, games: 0, maintenance: false });
      host.server.maintain();
      expect((await (await fetch(url + '?t=1')).json()).maintenance).toBe(true);
      expect((await fetch(url, { method: 'POST' })).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${host.port}/healthz/x`)).status).toBe(404);
    } finally {
      await host.close();
    }
  });

  it('不是由本机直接发出的请求交给下一个处理者（下载页对其返回 404）：外部请求与经反向代理转来的请求都是，/healthz 与 /metrics 都是', () => {
    const health = () => ({ players: 1, games: 0, maintenance: false });
    const handled: string[] = [];
    const web = withHealth(
      build,
      health,
      req => handled.push(`${req.url} ${req.socket.remoteAddress}`),
      () => 'yi_connections 0\n',
    );
    const call = (url: string, remoteAddress: string, headers: http.IncomingHttpHeaders = {}) => {
      let status = 0;
      const res = { writeHead: (code: number) => (status = code), end: () => {} };
      web({ method: 'GET', url, headers, socket: { remoteAddress } } as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
      return status;
    };
    const proxied = { 'x-forwarded-for': '203.0.113.7' };
    for (const url of ['/healthz', '/metrics']) {
      expect([call(url, '203.0.113.7'), call(url, '::ffff:10.0.0.2'), call(url, '127.0.0.1', proxied)]).toEqual([0, 0, 0]);
      expect([call(url, '::1'), call(url, '::ffff:127.0.0.1')]).toEqual([200, 200]);
    }
    expect(handled).toEqual([
      '/healthz 203.0.113.7',
      '/healthz ::ffff:10.0.0.2',
      '/healthz 127.0.0.1',
      '/metrics 203.0.113.7',
      '/metrics ::ffff:10.0.0.2',
      '/metrics 127.0.0.1',
    ]);
  });
});

describe('关闭（OPS-052）', () => {
  it('关闭时以 1001 断开全部连接，含尚未握手的', async () => {
    const host = await startHost(0, { host: '127.0.0.1' });
    const url = `ws://127.0.0.1:${host.port}`;
    /** 连上（hello 为 true 时完成握手）；closed 为这条连接被关闭时的关闭码 */
    const connect = async (hello: boolean) => {
      const ws = new WebSocket(url);
      const closed = new Promise<number>(res => ws.on('close', code => res(code)));
      await new Promise(res => ws.on('open', res));
      if (hello) {
        ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: '甲', uid: newUid() }));
        await new Promise(res => ws.once('message', res));
      }
      return { closed };
    };
    const conns = [await connect(true), await connect(false)];
    await host.close();
    expect(await Promise.all(conns.map(conn => conn.closed))).toEqual([CLOSE_CODE.restart, CLOSE_CODE.restart]);
  });
});

describe('监控指标的统计点（OPS-071）', () => {
  /** 带指标的服务端；value 取某个样本的值（没有时为 undefined） */
  const counted = () => {
    const metrics = new Metrics({ version: '1.0.0', commit: 'c' });
    const env = world(new MemoryStore(), { metrics });
    const value = (sample: string) =>
      metrics.snapshot({ connections: 0, playersOnline: 0, rooms: [], queue: [], downloadsActive: 0, eventLoopLagSeconds: 0, residentMemoryBytes: 0 })[sample];
    return { ...env, metrics, value };
  };

  it('入站消息按类型计数，非法消息记为 invalid；下发的错误按错误码计数；限流计次', () => {
    const { srv, value } = counted();
    const [black, white] = [new Client(srv, '甲'), new Client(srv, '乙')];
    startGame(black, white);
    white.send({ t: 'move', x: 7, y: 7 }); // 还没轮到白方
    black.send({ t: 'join', code: '0000' }); // 已在房间里
    black.send({ bad: 1 } as unknown as C2S);
    for (let i = 0; i < 100; i++) black.send({ t: 'ping' }); // 超出令牌桶
    expect(value('yi_messages_total{type="hello"}')).toBe(2);
    expect(value('yi_messages_total{type="invalid"}')).toBe(1);
    expect(value('yi_errors_total{code="game.not-your-turn"}')).toBe(1);
    expect(value('yi_errors_total{code="room.already-in"}')).toBe(1);
    expect(value('yi_errors_total{code="proto.invalid-message"}')).toBe(1);
    expect(value('yi_errors_total{code="rate.limited"}')).toBe(1);
    expect(value('yi_rate_limited_total')).toBeGreaterThanOrEqual(1);
  });

  it('终局按种类与原因计数', () => {
    const { srv, value } = counted();
    const [black, white] = [new Client(srv, '甲'), new Client(srv, '乙')];
    startGame(black, white);
    black.send({ t: 'resign' });
    expect(value('yi_games_finished_total{kind="friend",reason="resign"}')).toBe(1);
  });

  it('房间按种类与状态统计（含点目），排队按模式与棋类统计', () => {
    const { srv } = counted();
    const client = (name: string) => new Client(srv, name);
    const [black, white, host, queuer] = [client('甲'), client('乙'), client('丙'), client('丁')] as const;
    startGame(black, white, { type: 1, size: 9 });
    black.send({ t: 'pass' });
    white.send({ t: 'pass' }); // 双方停一手，进入点目
    host.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
    queuer.send({ t: 'queue', mode: 'ranked', type: 1, size: 19 });
    expect(srv.stats()).toEqual({
      rooms: [
        { kind: 'friend', state: 'scoring', count: 1 },
        { kind: 'friend', state: 'wait', count: 1 },
      ],
      queue: [{ mode: 'ranked', type: 'go', count: 1 }],
    });
  });
});

describe('/metrics（API-061、OPS-071）', () => {
  it('本机的 GET /metrics 返回 Prometheus 文本：连接数、在线玩家、处理耗时按注入的时钟计；未设指标时 404', async () => {
    const metrics = new Metrics({ version: '1.0.0', commit: 'c' });
    let clock = 100;
    const host = await startHost(0, { host: '127.0.0.1', metrics, now: () => (clock += 0.002), eventLoopLag: () => 0.25 });
    const plain = await startHost(0, { host: '127.0.0.1' });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}`);
      await new Promise(res => ws.on('open', res));
      ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: '甲', uid: newUid() }));
      await new Promise(res => ws.once('message', res));
      const res = await fetch(`http://127.0.0.1:${host.port}/metrics`);
      expect(res.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8');
      const lines = (await res.text()).split('\n');
      expect(lines).toEqual(
        expect.arrayContaining(['yi_connections 1', 'yi_players_online 1', 'yi_event_loop_lag_seconds 0.25', 'yi_message_handle_seconds_count 1']),
      );
      expect(lines).toContain('yi_message_handle_seconds_bucket{le="0.001"} 0');
      expect(lines).toContain('yi_message_handle_seconds_bucket{le="+Inf"} 1'); // 注入的时钟每读一次前进 2 毫秒，耗时必大于 1 毫秒
      expect((await fetch(`http://127.0.0.1:${plain.port}/metrics`)).status).toBe(404);
      ws.close();
    } finally {
      await host.close();
      await plain.close();
    }
  });
});
// ---------------- 未预期的异常（API-023、EDGE-002） ----------------

/** 写段位时可以出错的存档（模拟文件系统出错）：broken 为 true 时 set 抛出 */
