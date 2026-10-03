/** 联机服务端：匹配 / 排位、配对确认、好友房间、段位、对局中的各种请求、断线重连、超时、限流（用假时钟直接驱动 RoomServer），以及真实的 WebSocket 连接；服务端发出的每条消息都检查能否通过客户端的校验 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MemoryStore, RoomServer, type Conn, type RoomServerOptions, type Session } from '../server/rooms';
import { HTTP_LIMITS, hardenHttp, startHost } from '../server/host';
import { fileServer } from '../server/files';
import { CLOSE_CODE, HELLO_SECS, PROTO_VERSION, type C2S, type S2C } from '../src/shared/protocol';
import { parseS2C } from '../src/shared/parse';

type Msg<T extends S2C['t']> = Extract<S2C, { t: T }>;

/** 服务端发出的每条消息经 JSON 传输后都必须通过客户端的校验（API-016），否则客户端会把它丢掉 */
function expectClientAccepts(m: S2C) {
  const wire = JSON.parse(JSON.stringify(m));
  expect(parseS2C(wire), m.t).toEqual(wire);
  return m;
}

let uidSeq = 0;
const newUid = () => 'test-device-' + String(++uidSeq).padStart(8, '0');

class Client {
  inbox: S2C[] = [];
  sess: Session;
  conn: Conn;
  id = 0;
  token = '';
  closed = false;
  closeCode?: number; // 服务端关闭这条连接时用的关闭码（直接切断时为 undefined）
  welcome?: Msg<'welcome'>;
  constructor(
    public srv: RoomServer,
    public name: string,
    token?: string,
    public uid = newUid(),
  ) {
    this.conn = {
      send: m => {
        expectClientAccepts(m); // 连接关闭后发出的消息也要检查
        if (!this.closed) this.inbox.push(m);
      },
      close: code => {
        this.closed = true;
        this.closeCode = code;
      },
    };
    this.sess = srv.connect(this.conn)!;
    this.send({ t: 'hello', v: PROTO_VERSION, name, uid, token });
    const w = (this.welcome = this.expect('welcome'));
    if (w) {
      this.id = w.id;
      this.token = w.token;
    }
  }
  send(m: C2S) {
    this.sess = this.srv.message(this.sess, m, this.conn);
  }
  /** 取出第一条该类型（且满足条件）的消息，连同它之前的消息一起丢掉 */
  expect<T extends S2C['t']>(t: T, where?: (m: Msg<T>) => boolean): Msg<T> | undefined {
    const i = this.inbox.findIndex(m => m.t === t && (!where || where(m as Msg<T>)));
    if (i < 0) return undefined;
    const m = this.inbox[i] as Msg<T>;
    this.inbox.splice(0, i + 1);
    return m;
  }
  has(t: S2C['t']) {
    return this.inbox.some(m => m.t === t);
  }
  drain() {
    this.inbox = [];
  }
  drop() {
    this.closed = true;
    this.srv.disconnect(this.sess, this.conn);
  }
  /** 网络断了但服务端还没发现：这条连接收不到消息，也不再发出任何消息 */
  silence() {
    this.closed = true;
  }
}

function world(store = new MemoryStore(), opt: RoomServerOptions = {}) {
  let t = 1000;
  const srv = new RoomServer({ now: () => t, random: () => 0.3, store, ...opt });
  const advance = (s: number) => {
    t += s;
    srv.tick();
  };
  /** 时间流逝，期间这些客户端照常每 10 秒发一次心跳 */
  const idle = (s: number, ...cs: Client[]) => {
    while (s > 0) {
      const d = Math.min(s, 10);
      cs.forEach(c => c.send({ t: 'ping' }));
      advance(d);
      s -= d;
    }
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
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(a.expect('queued')).toEqual({ t: 'queued', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(a.expect('found')).toEqual({ t: 'found', opp: { name: '乙' }, secs: 15 });
    expect(b.expect('found')?.opp).toEqual({ name: '甲' });
    a.send({ t: 'confirm', ok: true });
    expect(b.expect('accepted')).toBeTruthy();
    expect(a.has('start')).toBe(false);
    b.send({ t: 'confirm', ok: true });
    const sa = a.expect('start')!,
      sb = b.expect('start')!;
    expect(sa.kind).toBe('match');
    expect(sa.color + sb.color).toBe(3);
    expect(sa.moveTime).toBe(30);
    expect(a.expect('turn')?.secs).toBe(30);
  });

  it('与等得最久的人配对；拒绝的退出，另一方继续匹配', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙'),
      c = new Client(srv, '丙');
    a.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    b.send({ t: 'queue', mode: 'match', type: 1, size: 19 }); // 路数不同，不配对
    expect(b.expect('queued')?.size).toBe(19);
    c.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(c.expect('found')?.opp.name).toBe('甲');
    c.send({ t: 'confirm', ok: false });
    expect(c.expect('unmatched')).toEqual({ t: 'unmatched', requeued: false, reason: '' });
    expect(a.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: '对方未接受' });
    expect(a.expect('queued')).toBeTruthy();
    const d = new Client(srv, '丁');
    d.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(d.expect('found')?.opp.name).toBe('甲'); // 甲仍排在最前
  });

  it('确认超时：没接受的退出，接受了的继续匹配', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
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
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    a.send({ t: 'unqueue' });
    b.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    b.drop();
    expect(srv.queued('ranked', 0)).toBe(0);
  });

  it('排位：同一台设备不和自己配对；胜负按 Elo 计分并存档', () => {
    const store = new MemoryStore();
    const { srv } = world(store);
    const a = new Client(srv, '甲'),
      a2 = new Client(srv, '甲的小号', undefined, a.uid);
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

    const again = new Client(srv, '胜者', undefined, wht.uid); // 重新登录读回段位
    expect(again.welcome?.ratings.gomoku.points).toBe(1216);
    expect(again.welcome?.ratings.go.points).toBe(1200);
    expect(sb).toBeTruthy();
  });

  it('排位中途离开按输棋计分', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
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
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
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
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'name', name: '甲甲' });
    const { sb } = startGame(a, b);
    a.send({ t: 'name', name: '不生效' });
    expect(sb.black.name).toBe('甲甲');
  });

  it('名字里的控制字符被清掉并截短', () => {
    const { srv } = world();
    const a = new Client(srv, '\n\t一二三四五六七八九十一二三四五六七八九十'),
      b = new Client(srv, '');
    const { sb } = startGame(a, b);
    expect(sb.black.name).toBe('一二三四五六七八九十一二三四五六');
    expect(sb.white.name).toBe('棋手');
  });

  it('版本不一致被拒', () => {
    const { srv } = world();
    const inbox: S2C[] = [];
    const s = srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: () => {} })!;
    srv.message(s, { t: 'hello', v: 1, name: 'x', uid: '' });
    expect(inbox[0]).toEqual({ t: 'error', text: '客户端版本与服务器不一致，请更新游戏' });
  });

  it('等待中的房间很多、随机房号接连撞上时，仍然发出可以加入的四位房号', () => {
    const { srv } = world(); // 假随机数恒为 0.3：每次随机出的房号都相同
    const hosts = Array.from({ length: 3 }, (_, i) => new Client(srv, `房主${i}`));
    const codes = hosts.map(h => {
      h.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
      return h.expect('created')!.code;
    });
    expect(new Set(codes).size).toBe(3);
    for (const c of codes) expect(c).toMatch(/^\d{4}$/);
    const guest = new Client(srv, '客');
    guest.send({ t: 'join', code: codes[2] });
    expect(guest.expect('start')?.white.name).toBe('客');
  });
});

describe('入站消息校验', () => {
  /** 绕过类型检查，发一条任意内容的消息 */
  const raw = (c: Client, m: unknown) => {
    c.sess = c.srv.message(c.sess, m, c.conn);
  };
  /** n 个未知字段 */
  const junk = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));

  it('非法消息回复格式错误后丢弃，局面不变，对方收不到任何消息', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b);
    a.drain();
    b.drain();
    for (const m of [
      { t: 'move', x: 7.5, y: 7 },
      { t: 'move', x: '7', y: 7 },
      { t: 'move', x: -0, y: 7 },
      { t: 'resign', extra: 1, ...junk(17) },
    ]) {
      raw(a, m);
      expect(a.inbox).toEqual([{ t: 'error', text: '消息格式错误' }]);
      a.drain();
    }
    expect(b.inbox).toEqual([]);
    a.send({ t: 'move', x: 0, y: 0 }); // 第一手仍由甲来下，说明非法的那几手没有被当成 (0, 0) 落下
    expect(b.expect('moved')).toEqual({ t: 'moved', x: 0, y: 0 });
  });

  it('取值超出范围的匹配与开房间请求被拒，不再被改成默认值', () => {
    const { srv } = world();
    const a = new Client(srv, '甲');
    raw(a, { t: 'queue', mode: 'match', type: 0, size: 14 });
    raw(a, { t: 'create', type: 1, size: 19, hostColor: 0, renju: false, moveTime: 600 });
    expect(a.inbox).toEqual([
      { t: 'error', text: '消息格式错误' },
      { t: 'error', text: '消息格式错误' },
    ]);
    expect(srv.queued('match', 0)).toBe(0);
  });

  it('握手前的非法消息同样被拒；同一连接只记第一条日志', () => {
    const logs: string[] = [];
    const { srv } = world(new MemoryStore(), { log: s => logs.push(s) });
    const inbox: S2C[] = [];
    const s = srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: () => {} })!;
    for (const m of [undefined, null, [], { t: 'hello', v: PROTO_VERSION, name: '甲', uid: 'bad uid' }]) srv.message(s, m);
    expect(inbox).toEqual(Array(4).fill({ t: 'error', text: '消息格式错误' }));
    expect(logs.filter(l => l.includes('非法消息'))).toHaveLength(1);
  });
});

describe('五子棋对局', () => {
  it('轮次、悔棋、求和、认输、再来一局、禁手、五连、离开', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b);
    b.send({ t: 'move', x: 7, y: 7 });
    expect(b.expect('info')?.text).toBe('还没轮到你');
    a.send({ t: 'move', x: 7, y: 7 });
    expect(a.expect('moved') && b.expect('moved')).toBeTruthy();
    play(a, b, [
      [b, 0, 0],
      [a, 5, 7],
      [b, 0, 1],
      [a, 7, 5],
      [b, 0, 2],
      [a, 7, 6],
      [b, 0, 4],
      [a, 6, 7],
    ]);

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

    a.drain();
    b.drain();
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
    a.drain();
    b.drain();
    play(a, b, [
      [b, 5, 7],
      [a, 0, 0],
      [b, 6, 7],
      [a, 0, 2],
      [b, 7, 5],
      [a, 0, 4],
      [b, 7, 6],
      [a, 14, 14],
    ]);
    b.send({ t: 'move', x: 7, y: 7 });
    expect(b.expect('info')?.text).toContain('三三');

    // 连成五子
    play(a, b, [
      [b, 8, 8],
      [a, 10, 0],
      [b, 9, 9],
      [a, 10, 2],
      [b, 10, 10],
      [a, 10, 4],
      [b, 11, 11],
      [a, 12, 0],
    ]);
    b.send({ t: 'move', x: 12, y: 12 });
    expect(a.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'five' });
    a.send({ t: 'leave' });
    expect(b.expect('left')).toBeTruthy();
    b.send({ t: 'rematch' });
    expect(b.expect('info')?.text).toBe('对方已离开，无法再来一局');
    b.send({ t: 'leave' });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 15 }); // 离开后可以接着匹配
    expect(b.expect('queued')).toBeTruthy();
  });

  it('对局中离开按认输处理', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
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
    const a = new Client(srv, '甲'),
      c = new Client(srv, '丙');
    startGame(a, c, { moveTime: 30 });
    a.send({ t: 'move', x: 7, y: 7 });
    c.send({ t: 'move', x: 8, y: 8 });
    advance(5);
    c.drop();
    expect(a.expect('peer')).toEqual({ t: 'peer', online: false, wait: 60 });
    for (let i = 0; i < 4; i++) {
      a.send({ t: 'ping' });
      advance(10);
    } // 掉线期间暂停计时，不会超时
    expect(a.has('over')).toBe(false);
    const c2 = new Client(srv, '丙', c.token);
    expect(c2.id).toBe(c.id);
    expect(c2.expect('start')?.color).toBe(2);
    expect(c2.expect('sync')?.acts).toEqual([
      { k: 'M', x: 7, y: 7 },
      { k: 'M', x: 8, y: 8 },
    ]);
    expect(c2.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 25 });
    expect(a.expect('peer')).toEqual({ t: 'peer', online: true });
    a.send({ t: 'leave' });
    expect(c2.expect('over')?.reason).toBe('left');
  });

  it('掉线太久判负', () => {
    const { srv, advance } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b);
    b.drop();
    advance(30);
    for (let i = 0; i < 4; i++) {
      a.send({ t: 'ping' });
      advance(10);
    }
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
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b, { moveTime: 30 });
    expect(a.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 30 });
    a.send({ t: 'move', x: 7, y: 7 });
    a.send({ t: 'undo' });
    b.drain();
    idle(21, a, b);
    expect(a.expect('answer')).toEqual({ t: 'answer', kind: 'undo', ok: false });
    expect(b.expect('turn')?.color).toBe(2); // 回应后重新计时
    idle(29, a, b);
    expect(a.has('over')).toBe(false);
    idle(2, a, b);
    expect(a.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'timeout' });
  });
});

describe('围棋对局', () => {
  it('停一手、点目、标记死子、双方确认', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b, { type: 1, size: 9 });
    for (let y = 0; y < 9; y++)
      play(a, b, [
        [a, 2, y],
        [b, 6, y],
      ]);
    play(a, b, [[a, 7, 4]]); // 白地里一颗孤零零的黑子
    b.send({ t: 'pass' });
    a.expect('passed');
    b.expect('passed');
    a.send({ t: 'pass' });
    a.expect('passed');
    b.expect('passed');
    expect(a.expect('turn')?.secs).toBe(-1);
    b.send({ t: 'mark', x: 7, y: 4 });
    expect(a.expect('marked') && b.expect('marked')).toBeTruthy();
    a.send({ t: 'agree' });
    expect(b.expect('agreed')?.color).toBe(1);
    b.send({ t: 'agree' });
    expect(a.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'score' }); // 白 45+7.5 胜黑 27
  });

  it('点目时恢复对局', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b, { type: 1, size: 9 });
    a.send({ t: 'pass' });
    b.send({ t: 'pass' });
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
    const open = (name: string, token?: string) =>
      new Promise<{ ws: WebSocket; next: (t: S2C['t']) => Promise<any> }>((res, rej) => {
        const ws = new WebSocket(url),
          inbox: S2C[] = [],
          waiters: [S2C['t'], (m: S2C) => void][] = [];
        ws.on('message', d => {
          const m = JSON.parse(String(d)) as S2C;
          const w = waiters.findIndex(([t]) => t === m.t);
          if (w >= 0) waiters.splice(w, 1)[0][1](m);
          else inbox.push(m);
        });
        const next = (t: S2C['t']) =>
          new Promise<S2C>(r => {
            const i = inbox.findIndex(m => m.t === t);
            if (i >= 0) r(inbox.splice(i, 1)[0]);
            else waiters.push([t, r]);
          });
        ws.on('open', () => {
          ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name, uid: newUid(), token }));
          res({ ws, next });
        });
        ws.on('error', rej);
      });
    try {
      const a = await open('甲'),
        b = await open('乙');
      await a.next('welcome');
      const wb = await b.next('welcome');
      a.ws.send(JSON.stringify({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 }));
      const { code } = await a.next('created');
      b.ws.send(JSON.stringify({ t: 'join', code }));
      expect((await b.next('start')).color).toBe(2);
      a.ws.send(JSON.stringify({ t: 'move', x: 7, y: 7 }));
      expect(await b.next('moved')).toEqual({ t: 'moved', x: 7, y: 7 });
      a.ws.send('不是 JSON'); // 不是 JSON 的内容按非法消息回复，连接照常
      expect(await a.next('error')).toEqual({ t: 'error', text: '消息格式错误' });
      b.ws.terminate();
      expect((await a.next('peer')).online).toBe(false);
      const b2 = await open('乙', wb.token);
      expect((await b2.next('sync')).acts).toEqual([{ k: 'M', x: 7, y: 7 }]);
      expect((await a.next('peer')).online).toBe(true);
      a.ws.close();
      b2.ws.close();
    } finally {
      await host.close();
    }
  });
});

describe('安装包下载', () => {
  it('同一个端口上：下载页只列出每个平台最新的安装包，可以断点续传，其他文件拿不到', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    fs.writeFileSync(path.join(dir, 'Yi-2.0.0-win-x64-setup.exe'), 'old');
    fs.writeFileSync(path.join(dir, 'Yi-2.0.1-win-x64-setup.exe'), '0123456789');
    fs.writeFileSync(path.join(dir, 'Yi-2.0.1-mac-arm64.dmg'), 'mac');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'no');
    const host = await startHost(0, { host: '127.0.0.1', files: dir });
    const base = `http://127.0.0.1:${host.port}`;
    try {
      const page = await (await fetch(base + '/')).text();
      expect(page).toContain('Yi-2.0.1-win-x64-setup.exe');
      expect(page).toContain('Yi-2.0.1-mac-arm64.dmg');
      expect(page).not.toContain('2.0.0');
      expect(page).not.toContain('secret');
      const whole = await fetch(base + '/Yi-2.0.1-win-x64-setup.exe');
      expect(whole.status).toBe(200);
      expect(await whole.text()).toBe('0123456789');
      const part = await fetch(base + '/Yi-2.0.1-win-x64-setup.exe', { headers: { Range: 'bytes=4-' } });
      expect(part.status).toBe(206);
      expect(part.headers.get('content-range')).toBe('bytes 4-9/10');
      expect(await part.text()).toBe('456789');
      for (const bad of ['/secret.txt', '/Yi-2.0.0-win-x64-setup.exe', '/..%2Fetc%2Fpasswd', '/Yi-2.0.1-win-x64-setup.exe/x'])
        expect((await fetch(base + bad)).status).toBe(404);
      expect((await fetch(base + '/', { method: 'POST' })).status).toBe(405);
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}`); // 联机照常
      await new Promise((res, rej) => {
        ws.on('open', res);
        ws.on('error', rej);
      });
      ws.close();
    } finally {
      await host.close();
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('下载页面带安全响应头，只提供名单内的资源；SHA256SUMS 与页面上的校验值一致（API-060、API-063、SEC-070）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    fs.writeFileSync(path.join(dir, 'Yi-2.0.3-win-x64-setup.exe'), 'windows');
    fs.writeFileSync(path.join(dir, 'Yi-2.0.3-linux-x86_64.AppImage'), 'linux');
    const host = await startHost(0, { host: '127.0.0.1', files: dir });
    const base = `http://127.0.0.1:${host.port}`;
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    try {
      const page = await fetch(base + '/');
      expect(page.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'");
      expect(page.headers.get('x-content-type-options')).toBe('nosniff');
      expect(page.headers.get('referrer-policy')).toBe('no-referrer');
      const html = await page.text();
      expect(html).not.toMatch(/<script/i);
      expect(html).toContain('/assets/title-yi.png');
      for (const [name, type] of [
        ['title-yi.png', 'image/png'],
        ['icon.png', 'image/png'],
        ['yi-serif-900.woff2', 'font/woff2'],
      ]) {
        const r = await fetch(`${base}/assets/${name}?v=1`);
        expect(r.status, name).toBe(200);
        expect(r.headers.get('content-type')).toBe(type);
        expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      }
      for (const bad of ['/assets/nope.png', '/assets/', '/assets/..%2Fpackage.json', '/assets/toString'])
        expect((await fetch(base + bad)).status, bad).toBe(404);
      let sums = await fetch(base + '/SHA256SUMS');
      for (let i = 0; i < 50 && sums.status === 503; i++) {
        await new Promise(r => setTimeout(r, 20));
        sums = await fetch(base + '/SHA256SUMS');
      }
      expect(await sums.text()).toBe(`${sha('windows')}  Yi-2.0.3-win-x64-setup.exe\n${sha('linux')}  Yi-2.0.3-linux-x86_64.AppImage\n`);
      const again = await (await fetch(base + '/')).text();
      expect(again).toContain(sha('windows'));
      expect(again).toContain('macOS 13 Ventura 或更高版本');
    } finally {
      await host.close();
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('没设安装包目录时网页请求一律 404', async () => {
    const host = await startHost(0, { host: '127.0.0.1' });
    try {
      expect((await fetch(`http://127.0.0.1:${host.port}/`)).status).toBe(404);
    } finally {
      await host.close();
    }
  });
});

describe('2.0.1 联机修复', () => {
  it('令牌已经失效（服务器重启过或掉线太久）：告诉客户端原来的对局不在了', () => {
    const { srv } = world();
    const a = new Client(srv, '甲', 'f'.repeat(32));
    expect(a.id).toBeGreaterThan(0);
    expect(a.expect('resumeFailed')).toBeTruthy();
    const b = new Client(srv, '乙');
    expect(b.has('resumeFailed')).toBe(false);
  });

  it('旧连接其实已经断了但还没被发现：新连接用令牌接管，旧连接迟到的断开被忽略', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b);
    a.send({ t: 'move', x: 7, y: 7 });
    b.drain();
    a.silence();
    const a2 = new Client(srv, '甲', a.token, a.uid);
    expect(a2.id).toBe(a.id);
    expect(a2.expect('start')?.color).toBe(1);
    expect(a2.expect('sync')?.acts).toEqual([{ k: 'M', x: 7, y: 7 }]);
    expect(b.expect('peer')).toEqual({ t: 'peer', online: true });
    srv.disconnect(a.sess, a.conn); // 旧连接这时才被发现断开
    expect(b.has('peer')).toBe(false);
    b.send({ t: 'move', x: 8, y: 8 });
    expect(a2.expect('moved')).toEqual({ t: 'moved', x: 8, y: 8 });
  });

  it('断线期间对局结束：重连后补发结果与排位结算', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    matchUp(a, b, 'ranked');
    a.drop();
    b.send({ t: 'resign' });
    expect(b.expect('over')?.reason).toBe('resign');
    const a2 = new Client(srv, '甲', a.token, a.uid);
    expect(a2.expect('start')).toBeTruthy();
    expect(a2.expect('over')).toEqual({ t: 'over', winner: expect.any(Number), reason: 'resign' });
    expect(a2.expect('rated')?.delta).toBe(16);
    expect(a2.has('turn')).toBe(false);
  });

  it('掉线的一方不在时不计时，回来后才开始计时', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b, { moveTime: 30 });
    a.send({ t: 'move', x: 7, y: 7 });
    a.drop();
    b.drain();
    b.send({ t: 'move', x: 8, y: 8 }); // 轮到掉线的黑棋
    expect(b.expect('turn', m => m.color === 1)?.secs).toBe(-1);
    idle(50, b); // 比每步限时长，但在掉线宽限之内
    expect(b.has('over')).toBe(false);
    const a2 = new Client(srv, '甲', a.token, a.uid);
    expect(a2.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 30 });
    expect(b.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 30 });
    idle(31, a2, b);
    expect(b.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'timeout' });
  });

  it('加入房间失败太多次后暂时不能再试', () => {
    const { srv, advance } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
    const code = a.expect('created')!.code;
    const wrong = code === '1234' ? '4321' : '1234';
    for (let i = 0; i < 5; i++) {
      b.send({ t: 'join', code: wrong });
      expect(b.expect('joinNo')?.reason).toBe('房号不存在，或房间已经开始');
    }
    b.send({ t: 'join', code });
    expect(b.expect('joinNo')?.reason).toBe('尝试次数太多，请稍后再试');
    a.send({ t: 'ping' });
    b.send({ t: 'ping' });
    advance(30);
    a.send({ t: 'ping' });
    b.send({ t: 'ping' });
    advance(31);
    b.send({ t: 'join', code });
    expect(b.expect('start')).toBeTruthy();
  });

  it('同一台设备的两个窗口不能同时排位', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      a2 = new Client(srv, '甲', undefined, a.uid);
    a.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    a2.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    expect(a2.expect('error')?.text).toBe('这台设备已经在排位中了');
    a2.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(a2.expect('queued')?.mode).toBe('match');
  });

  it('配置了最新版本时，welcome 带上版本号与下载地址', () => {
    const { srv } = world(new MemoryStore(), { latest: '2.0.1', download: 'https://example.com/yi' });
    const a = new Client(srv, '甲');
    expect(a.welcome?.latest).toBe('2.0.1');
    expect(a.welcome?.url).toBe('https://example.com/yi');
    const { srv: plain } = world();
    expect(new Client(plain, '乙').welcome?.latest).toBeUndefined();
  });
});

describe('限流与违规（API-042 至 API-046）', () => {
  const LIMITED = { t: 'error', text: '操作过于频繁，请稍后再试' };
  /** 绕过类型检查，发一条任意内容的消息 */
  const raw = (c: Client, m: unknown) => {
    c.sess = c.srv.message(c.sess, m, c.conn);
  };

  it('消息洪泛：超出令牌桶的消息被丢弃且只提示一次，持续洪泛即以 1008 断开，5 分钟内同一身份连不上', () => {
    const { srv, advance } = world();
    const a = new Client(srv, '甲');
    a.drain();
    for (let i = 0; i < 50; i++) a.send({ t: 'ping' }); // 握手已用掉 1 个令牌，余 39 个
    expect(a.inbox.filter(m => m.t === 'pong')).toHaveLength(39);
    expect(a.inbox.filter(m => m.t === 'error')).toEqual([LIMITED]);
    expect(a.closeCode).toBe(CLOSE_CODE.policy); // 第 10 条被丢弃的消息累计到上限
    const again = new Client(srv, '甲', undefined, a.uid);
    expect(again.welcome).toBeUndefined();
    expect(again.inbox).toEqual([LIMITED]);
    expect(again.closeCode).toBe(CLOSE_CODE.policy);
    expect(new Client(srv, '乙').welcome).toBeTruthy(); // 其他身份不受影响
    advance(5 * 60);
    expect(new Client(srv, '甲', undefined, a.uid).welcome).toBeTruthy();
  });

  it('令牌按每秒 20 个恢复：洪泛停下 1 秒后照常处理', () => {
    const { srv, advance } = world();
    const a = new Client(srv, '甲');
    for (let i = 0; i < 40; i++) a.send({ t: 'ping' });
    expect(a.inbox.at(-1)).toEqual(LIMITED);
    advance(1);
    a.drain();
    for (let i = 0; i < 20; i++) a.send({ t: 'ping' });
    expect(a.inbox).toEqual(Array(20).fill({ t: 'pong' }));
    expect(a.closed).toBe(false);
  });

  it('对局中 60 秒内累计 10 次非法消息即被断开，带令牌也重连不上，到时按掉线判负', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    startGame(a, b);
    for (let i = 0; i < 9; i++) raw(a, { t: 'move', x: -1, y: 0 });
    expect(a.closed).toBe(false);
    raw(a, { t: 'move', x: -1, y: 0 });
    expect(a.closeCode).toBe(CLOSE_CODE.policy);
    expect(b.expect('peer')?.online).toBe(false);
    const back = new Client(srv, '甲', a.token, a.uid);
    expect(back.closeCode).toBe(CLOSE_CODE.policy);
    idle(61, b);
    expect(b.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'disconnect' });
  });

  it('违规分散在 60 秒以外的不累计', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲');
    for (let i = 0; i < 9; i++) raw(a, { t: 'nope' });
    idle(60, a);
    for (let i = 0; i < 9; i++) raw(a, { t: 'nope' });
    expect(a.closed).toBe(false);
  });

  it('握手超时：10 秒内没有发来合法的 hello 即以 4008 关闭，心跳回应不延长时限', () => {
    const { srv, advance } = world();
    let code: number | undefined;
    const s = srv.connect({
      send: () => {},
      close: c => {
        code = c;
      },
    })!;
    srv.message(s, { t: 'ping' });
    advance(HELLO_SECS - 1);
    srv.touch(s);
    expect(code).toBeUndefined();
    advance(2);
    expect(code).toBe(CLOSE_CODE.helloTimeout);
    const a = new Client(srv, '甲');
    advance(HELLO_SECS * 2);
    expect(a.closed).toBe(false);
  });

  it('改名：与当前昵称相同的不计次数，真正改名每 10 秒至多 1 次（API-044）', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '丁');
    a.drain();
    for (let i = 0; i < 5; i++) a.send({ t: 'name', name: '甲' }); // 客户端每次匹配前都会发一次
    a.send({ t: 'name', name: '乙' });
    expect(a.inbox).toEqual([]);
    a.send({ t: 'name', name: '丙' });
    expect(a.inbox).toEqual([LIMITED]);
    a.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(b.expect('found')?.opp.name).toBe('乙');
  });

  it('进入、退出匹配队列合计每 10 秒至多 10 次（API-044）', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲');
    for (let i = 0; i < 5; i++) {
      a.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
      a.send({ t: 'unqueue' });
    }
    a.drain();
    a.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(a.inbox).toEqual([LIMITED]);
    expect(srv.queued('match', 0)).toBe(0);
    idle(10, a);
    a.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(srv.queued('match', 0)).toBe(1);
  });

  it('玩家数达到上限时告知服务器繁忙，不再静默拒绝（API-046）', () => {
    const { srv } = world();
    for (let i = 0; i < 2048; i++) srv.connect({ send: () => {}, close: () => {} });
    const inbox: S2C[] = [];
    expect(srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: () => {} })).toBeNull();
    expect(inbox).toEqual([{ t: 'error', text: '服务器繁忙，请稍后再试' }]);
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
    let t = 1000;
    const host = await startHost(0, { host: '127.0.0.1', now: () => t });
    const url = `ws://127.0.0.1:${host.port}`;
    try {
      for (let i = 0; i < 30; i++) {
        expect(await attempt(url)).toBe('welcome');
        await until(() => host.server.online() === 0); // 等服务端处理完断开，免得撞上同时连接数的上限
      }
      expect(await attempt(url)).toBe(CLOSE_CODE.overload);
      t += 59;
      expect(await attempt(url)).toBe(CLOSE_CODE.overload);
      t += 1;
      expect(await attempt(url)).toBe('welcome');
    } finally {
      await host.close();
    }
  });

  it('真实连接上握手超时以 4008 关闭', async () => {
    let t = 1000;
    const host = await startHost(0, { host: '127.0.0.1', now: () => t });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}`);
      const closed = new Promise<number>(r => ws.on('close', code => r(code)));
      await new Promise((res, rej) => {
        ws.on('open', res);
        ws.on('error', rej);
      });
      t += HELLO_SECS + 1;
      expect(await closed).toBe(CLOSE_CODE.helloTimeout);
    } finally {
      await host.close();
    }
  });

  it('HTTP 服务器设有超时与请求头上限（API-047）', () => {
    const s = http.createServer();
    hardenHttp(s);
    expect({
      headersTimeout: s.headersTimeout,
      requestTimeout: s.requestTimeout,
      keepAliveTimeout: s.keepAliveTimeout,
      maxHeadersCount: s.maxHeadersCount,
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
