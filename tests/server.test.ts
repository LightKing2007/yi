/** 联机服务端：匹配 / 排位、配对确认、好友房间、段位、对局中的各种请求、断线重连、超时（用假时钟直接驱动 RoomServer），以及真实的 WebSocket 连接 */
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MemoryStore, RoomServer, type Session } from '../server/rooms';
import { startHost } from '../server/host';
import { PROTO_VERSION, type C2S, type S2C } from '../src/shared/protocol';

type Msg<T extends S2C['t']> = Extract<S2C, { t: T }>;

let uidSeq = 0;
const newUid = () => 'test-device-' + String(++uidSeq).padStart(8, '0');

class Client {
  inbox: S2C[] = [];
  sess: Session;
  id = 0;
  token = '';
  closed = false;
  welcome?: Msg<'welcome'>;
  constructor(public srv: RoomServer, public name: string, token?: string, public uid = newUid()) {
    this.sess = srv.connect({ send: m => { if (!this.closed) this.inbox.push(m); }, close: () => { this.closed = true; } })!;
    this.send({ t: 'hello', v: PROTO_VERSION, name, uid, token });
    const w = this.welcome = this.expect('welcome');
    if (w) { this.id = w.id; this.token = w.token; }
  }
  send(m: C2S) { this.sess = this.srv.message(this.sess, m); }
  /** 取出第一条该类型（且满足条件）的消息，连同它之前的消息一起丢掉 */
  expect<T extends S2C['t']>(t: T, where?: (m: Msg<T>) => boolean): Msg<T> | undefined {
    const i = this.inbox.findIndex(m => m.t === t && (!where || where(m as Msg<T>)));
    if (i < 0) return undefined;
    const m = this.inbox[i] as Msg<T>;
    this.inbox.splice(0, i + 1);
    return m;
  }
  has(t: S2C['t']) { return this.inbox.some(m => m.t === t); }
  drain() { this.inbox = []; }
  drop() { this.closed = true; this.srv.disconnect(this.sess); }
}

function world(store = new MemoryStore()) {
  let t = 1000;
  const srv = new RoomServer({ now: () => t, random: () => 0.3, store });
  const advance = (s: number) => { t += s; srv.tick(); };
  /** 时间流逝，期间这些客户端照常每 10 秒发一次心跳 */
  const idle = (s: number, ...cs: Client[]) => {
    while (s > 0) { const d = Math.min(s, 10); cs.forEach(c => c.send({ t: 'ping' })); advance(d); s -= d; }
  };
  return { srv, advance, idle, store };
}

function play(a: Client, b: Client, seq: [Client, number, number][]) {
  for (const [who, x, y] of seq) {
    who.send({ t: 'move', x, y });
    expect(a.expect('moved')).toBeTruthy();
    expect(b.expect('moved')).toBeTruthy();
  }
}

/** 好友房间开一局：a 开房间，b 用房号加入 */
function startGame(a: Client, b: Client, o: Partial<Extract<C2S, { t: 'create' }>> = {}) {
  a.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0, ...o });
  const code = a.expect('created')!.code;
  b.send({ t: 'join', code });
  return { code, sa: a.expect('start')!, sb: b.expect('start')! };
}

/** 两人进同一队列并都接受，返回双方的开局消息 */
function matchUp(a: Client, b: Client, mode: 'match' | 'ranked' = 'match', type = 0) {
  a.send({ t: 'queue', mode, type, size: 19 });
  b.send({ t: 'queue', mode, type, size: 19 });
  a.send({ t: 'confirm', ok: true });
  b.send({ t: 'confirm', ok: true });
  return { sa: a.expect('start')!, sb: b.expect('start')! };
}

describe('匹配与排位', () => {
  it('两人进入队列即配对，看到对方后双方接受才开局', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(a.expect('queued')).toEqual({ t: 'queued', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(a.expect('found')).toEqual({ t: 'found', opp: { name: '乙' }, secs: 15 });
    expect(b.expect('found')?.opp).toEqual({ name: '甲' });
    a.send({ t: 'confirm', ok: true });
    expect(b.expect('accepted')).toBeTruthy();
    expect(a.has('start')).toBe(false);
    b.send({ t: 'confirm', ok: true });
    const sa = a.expect('start')!, sb = b.expect('start')!;
    expect(sa.kind).toBe('match');
    expect(sa.color + sb.color).toBe(3);
    expect(sa.moveTime).toBe(30);
    expect(a.expect('turn')?.secs).toBe(30);
  });

  it('与等得最久的人配对；拒绝的退出，另一方继续匹配', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙'), c = new Client(srv, '丙');
    a.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    b.send({ t: 'queue', mode: 'match', type: 1, size: 19 });       // 路数不同，不配对
    expect(b.expect('queued')?.size).toBe(19);
    c.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(c.expect('found')?.opp.name).toBe('甲');
    c.send({ t: 'confirm', ok: false });
    expect(c.expect('unmatched')).toEqual({ t: 'unmatched', requeued: false, reason: '' });
    expect(a.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: '对方未接受' });
    expect(a.expect('queued')).toBeTruthy();
    const d = new Client(srv, '丁');
    d.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(d.expect('found')?.opp.name).toBe('甲');                   // 甲仍排在最前
  });

  it('确认超时：没接受的退出，接受了的继续匹配', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'confirm', ok: true });
    idle(16, a, b);
    expect(a.expect('unmatched')?.requeued).toBe(false);
    expect(b.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: '对方未确认' });
    expect(srv.queued('match', 0)).toBe(1);
  });

  it('取消匹配、掉线都会离开队列', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    a.send({ t: 'unqueue' });
    b.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    b.drop();
    expect(srv.queued('ranked', 0)).toBe(0);
  });

  it('排位：同一台设备不和自己配对；胜负按 Elo 计分并存档', () => {
    const store = new MemoryStore();
    const { srv } = world(store);
    const a = new Client(srv, '甲'), a2 = new Client(srv, '甲的小号', undefined, a.uid);
    a.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    a2.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    expect(a.has('found')).toBe(false);
    a2.send({ t: 'unqueue' });
    a.send({ t: 'unqueue' });

    const b = new Client(srv, '乙');
    const { sa, sb } = matchUp(a, b, 'ranked');
    expect(sa.kind).toBe('ranked');
    expect(sa.black.points).toBe(1200);
    const [blk, wht] = sa.color === 1 ? [a, b] : [b, a];
    blk.send({ t: 'resign' });
    expect(wht.expect('rated')).toEqual({ t: 'rated', type: 0, rating: { points: 1216, win: 1, loss: 0, draw: 0 }, delta: 16 });
    expect(blk.expect('rated')?.rating).toEqual({ points: 1184, win: 0, loss: 1, draw: 0 });
    wht.send({ t: 'rematch' });
    expect(wht.expect('info')?.text).toBe('排位赛不能再来一局');

    const again = new Client(srv, '胜者', undefined, wht.uid);       // 重新登录读回段位
    expect(again.welcome?.ratings.gomoku.points).toBe(1216);
    expect(again.welcome?.ratings.go.points).toBe(1200);
    expect(sb).toBeTruthy();
  });

  it('排位中途离开按输棋计分', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    matchUp(a, b, 'ranked', 1);
    a.send({ t: 'leave' });
    expect(a.expect('rated')?.delta).toBe(-16);
    expect(b.expect('over')?.reason).toBe('left');
    expect(b.expect('rated')?.rating.points).toBe(1216);
  });
});

describe('好友房间', () => {
  it('输入房号即开局；错误房号、自己的房号被拒；房主可以关闭', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    a.send({ t: 'create', type: 1, size: 13, hostColor: 1, renju: false, moveTime: 60 });
    const code = a.expect('created')!.code;
    expect(code).toMatch(/^\d{4}$/);
    a.send({ t: 'join', code });
    expect(a.expect('joinNo')?.reason).toBe('你已经在一个房间里了');
    b.send({ t: 'join', code: '0000' });
    expect(b.expect('joinNo')?.reason).toBe('房号不存在，或房间已经开始');
    a.send({ t: 'close' });
    b.send({ t: 'join', code });
    expect(b.expect('joinNo')).toBeTruthy();

    const { sa, sb } = startGame(a, b, { type: 1, size: 13, hostColor: 1, moveTime: 60 });
    expect(sa).toMatchObject({ kind: 'friend', color: 2, type: 1, size: 13, moveTime: 60 });
    expect(sb.color).toBe(1);
    expect(sb.white.points).toBeUndefined();
  });

  it('不在房间里时可以改名', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    a.send({ t: 'name', name: '甲甲' });
    const { sb } = startGame(a, b);
    a.send({ t: 'name', name: '不生效' });
    expect(sb.black.name).toBe('甲甲');
  });

  it('名字里的控制字符被清掉并截短', () => {
    const { srv } = world();
    const a = new Client(srv, '\n\t一二三四五六七八九十一二三四五六七八九十'), b = new Client(srv, '');
    const { sb } = startGame(a, b);
    expect(sb.black.name).toBe('一二三四五六七八九十一二三四五六');
    expect(sb.white.name).toBe('棋手');
  });

  it('版本不一致被拒', () => {
    const { srv } = world();
    const inbox: S2C[] = [];
    const s = srv.connect({ send: m => inbox.push(m), close: () => {} })!;
    srv.message(s, { t: 'hello', v: 1, name: 'x', uid: '' });
    expect(inbox[0]).toEqual({ t: 'error', text: '客户端版本与服务器不一致，请更新游戏' });
  });
});

describe('五子棋对局', () => {
  it('轮次、悔棋、求和、认输、再来一局、禁手、五连、离开', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    startGame(a, b);
    b.send({ t: 'move', x: 7, y: 7 });
    expect(b.expect('info')?.text).toBe('还没轮到你');
    a.send({ t: 'move', x: 7, y: 7 });
    expect(a.expect('moved') && b.expect('moved')).toBeTruthy();
    play(a, b, [[b, 0, 0], [a, 5, 7], [b, 0, 1], [a, 7, 5], [b, 0, 2], [a, 7, 6], [b, 0, 4], [a, 6, 7]]);

    b.send({ t: 'undo' });
    expect(a.expect('ask', m => m.kind === 'undo')).toBeTruthy();
    a.send({ t: 'reply', kind: 'undo', ok: false });
    expect(b.expect('answer', m => m.kind === 'undo' && !m.ok)).toBeTruthy();
    b.send({ t: 'undo' });
    a.expect('ask');
    a.send({ t: 'reply', kind: 'undo', ok: true });
    expect(a.expect('undone')?.n).toBe(2);
    expect(b.expect('undone')?.n).toBe(2);
    b.send({ t: 'undo' });
    a.expect('ask');
    b.send({ t: 'undo' });
    expect(b.expect('info')?.text).toBe('现在不能申请悔棋');
    a.send({ t: 'reply', kind: 'undo', ok: false });
    b.expect('answer');
    b.send({ t: 'undo' });
    expect(b.expect('info')?.text).toBe('本局悔棋次数已用完');

    a.drain(); b.drain();
    a.send({ t: 'draw' });
    b.expect('ask', m => m.kind === 'draw');
    b.send({ t: 'reply', kind: 'draw', ok: false });
    expect(a.expect('answer', m => m.kind === 'draw')).toBeTruthy();
    b.send({ t: 'resign' });
    const o = a.expect('over')!;
    expect(o).toEqual({ t: 'over', winner: 1, reason: 'resign' });
    expect(b.expect('over')).toBeTruthy();

    // 再来一局：交换先后手
    a.send({ t: 'rematch' });
    b.expect('ask', m => m.kind === 'rematch');
    b.send({ t: 'reply', kind: 'rematch', ok: true });
    expect(a.expect('start')?.color).toBe(2);
    expect(b.expect('start')?.color).toBe(1);

    // 禁手：执黑的乙下三三被拒
    a.drain(); b.drain();
    play(a, b, [[b, 5, 7], [a, 0, 0], [b, 6, 7], [a, 0, 2], [b, 7, 5], [a, 0, 4], [b, 7, 6], [a, 14, 14]]);
    b.send({ t: 'move', x: 7, y: 7 });
    expect(b.expect('info')?.text).toContain('三三');

    // 连成五子
    play(a, b, [[b, 8, 8], [a, 10, 0], [b, 9, 9], [a, 10, 2], [b, 10, 10], [a, 10, 4], [b, 11, 11], [a, 12, 0]]);
    b.send({ t: 'move', x: 12, y: 12 });
    expect(a.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'five' });
    a.send({ t: 'leave' });
    expect(b.expect('left')).toBeTruthy();
    b.send({ t: 'rematch' });
    expect(b.expect('info')?.text).toBe('对方已离开，无法再来一局');
    b.send({ t: 'leave' });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 15 });           // 离开后可以接着匹配
    expect(b.expect('queued')).toBeTruthy();
  });

  it('对局中离开按认输处理', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    startGame(a, b);
    a.send({ t: 'move', x: 7, y: 7 });
    a.send({ t: 'leave' });
    expect(b.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'left' });
    expect(b.expect('left')).toBeTruthy();
  });
});

describe('断线、超时', () => {
  it('用令牌重连：回到原对局并回放棋谱', () => {
    const { srv, advance } = world();
    const a = new Client(srv, '甲'), c = new Client(srv, '丙');
    startGame(a, c, { moveTime: 30 });
    a.send({ t: 'move', x: 7, y: 7 });
    c.send({ t: 'move', x: 8, y: 8 });
    advance(5);
    c.drop();
    expect(a.expect('peer')).toEqual({ t: 'peer', online: false, wait: 60 });
    for (let i = 0; i < 4; i++) { a.send({ t: 'ping' }); advance(10); }   // 掉线期间暂停计时，不会超时
    expect(a.has('over')).toBe(false);
    const c2 = new Client(srv, '丙', c.token);
    expect(c2.id).toBe(c.id);
    expect(c2.expect('start')?.color).toBe(2);
    expect(c2.expect('sync')?.acts).toEqual([{ k: 'M', x: 7, y: 7 }, { k: 'M', x: 8, y: 8 }]);
    expect(c2.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 25 });
    expect(a.expect('peer')).toEqual({ t: 'peer', online: true });
    a.send({ t: 'leave' });
    expect(c2.expect('over')?.reason).toBe('left');
  });

  it('掉线太久判负', () => {
    const { srv, advance } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    startGame(a, b);
    b.drop();
    advance(30);
    for (let i = 0; i < 4; i++) { a.send({ t: 'ping' }); advance(10); }
    expect(a.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'disconnect' });
  });

  it('长时间没有消息的连接被断开', () => {
    const { srv, advance } = world();
    const a = new Client(srv, '甲');
    advance(36);
    expect(a.closed).toBe(true);
    expect(srv.online()).toBe(0);
  });

  it('每步限时用完判负；申请无人回应按拒绝处理', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    startGame(a, b, { moveTime: 30 });
    expect(a.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 30 });
    a.send({ t: 'move', x: 7, y: 7 });
    a.send({ t: 'undo' });
    b.drain();
    idle(21, a, b);
    expect(a.expect('answer')).toEqual({ t: 'answer', kind: 'undo', ok: false });
    expect(b.expect('turn')?.color).toBe(2);             // 回应后重新计时
    idle(29, a, b);
    expect(a.has('over')).toBe(false);
    idle(2, a, b);
    expect(a.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'timeout' });
  });
});

describe('围棋对局', () => {
  it('停一手、点目、标记死子、双方确认', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    startGame(a, b, { type: 1, size: 9 });
    for (let y = 0; y < 9; y++) play(a, b, [[a, 2, y], [b, 6, y]]);
    play(a, b, [[a, 7, 4]]);                            // 白地里一颗孤零零的黑子
    b.send({ t: 'pass' }); a.expect('passed'); b.expect('passed');
    a.send({ t: 'pass' }); a.expect('passed'); b.expect('passed');
    expect(a.expect('turn')?.secs).toBe(-1);
    b.send({ t: 'mark', x: 7, y: 4 });
    expect(a.expect('marked') && b.expect('marked')).toBeTruthy();
    a.send({ t: 'agree' });
    expect(b.expect('agreed')?.color).toBe(1);
    b.send({ t: 'agree' });
    expect(a.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'score' });   // 白 45+7.5 胜黑 27
  });

  it('点目时恢复对局', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'), b = new Client(srv, '乙');
    startGame(a, b, { type: 1, size: 9 });
    a.send({ t: 'pass' }); b.send({ t: 'pass' });
    b.send({ t: 'resume' });
    expect(a.expect('resumed')).toBeTruthy();
    a.send({ t: 'move', x: 4, y: 4 });
    expect(b.expect('moved')).toEqual({ t: 'moved', x: 4, y: 4 });
  });
});

describe('WebSocket 传输', () => {
  it('两个真实连接开一局并在断线后重连', async () => {
    const host = await startHost(0, { host: '127.0.0.1' });
    const url = `ws://127.0.0.1:${host.port}`;
    const open = (name: string, token?: string) => new Promise<{ ws: WebSocket; next: (t: S2C['t']) => Promise<any> }>((res, rej) => {
      const ws = new WebSocket(url), inbox: S2C[] = [], waiters: [S2C['t'], (m: S2C) => void][] = [];
      ws.on('message', d => {
        const m = JSON.parse(String(d)) as S2C;
        const w = waiters.findIndex(([t]) => t === m.t);
        if (w >= 0) waiters.splice(w, 1)[0][1](m); else inbox.push(m);
      });
      const next = (t: S2C['t']) => new Promise<S2C>(r => {
        const i = inbox.findIndex(m => m.t === t);
        if (i >= 0) r(inbox.splice(i, 1)[0]); else waiters.push([t, r]);
      });
      ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name, uid: newUid(), token })); res({ ws, next }); });
      ws.on('error', rej);
    });
    try {
      const a = await open('甲'), b = await open('乙');
      await a.next('welcome');
      const wb = await b.next('welcome');
      a.ws.send(JSON.stringify({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 }));
      const { code } = await a.next('created');
      b.ws.send(JSON.stringify({ t: 'join', code }));
      expect((await b.next('start')).color).toBe(2);
      a.ws.send(JSON.stringify({ t: 'move', x: 7, y: 7 }));
      expect(await b.next('moved')).toEqual({ t: 'moved', x: 7, y: 7 });
      a.ws.send('不是 JSON');                              // 乱发的内容被忽略
      b.ws.terminate();
      expect((await a.next('peer')).online).toBe(false);
      const b2 = await open('乙', wb.token);
      expect((await b2.next('sync')).acts).toEqual([{ k: 'M', x: 7, y: 7 }]);
      expect((await a.next('peer')).online).toBe(true);
      a.ws.close(); b2.ws.close();
    } finally {
      await host.close();
    }
  });
});
