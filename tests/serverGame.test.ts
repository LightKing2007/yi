/** 联机服务端：入站消息校验、五子棋与围棋对局中的各种请求、断线与超时（以假时钟直接驱动 RoomServer） */
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/rooms';
import type { LogEntry } from '../server/log';
import { PROTO_VERSION, type S2C } from '../src/shared/protocol';
import { expectClientAccepts, Client, world, play, startGame } from './serverWorld';

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
    const logs: { event: string; entry?: LogEntry }[] = [];
    const { srv } = world(new MemoryStore(), { log: (_level, event, entry) => logs.push({ event, entry }) });
    const inbox: S2C[] = [];
    const s = srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: () => {} })!;
    for (const m of [undefined, null, [], { t: 'hello', v: PROTO_VERSION, name: '甲', uid: 'bad uid' }]) srv.message(s, m);
    expect(inbox).toEqual(Array(4).fill({ t: 'error', text: '消息格式错误' }));
    expect(logs.filter(l => l.event === 'proto.invalid')).toEqual([{ event: 'proto.invalid', entry: expect.objectContaining({ reason: '消息不是对象' }) }]);
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
