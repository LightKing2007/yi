/** 联机服务端：入站消息校验、五子棋与围棋对局中的各种请求、断线与超时（以假时钟直接驱动 RoomServer） */
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/rooms';
import type { LogEntry } from '../server/log';
import { PROTO_VERSION, type S2C } from '../src/shared/protocol';
import { must } from './must';
import { expectClientAccepts, Client, world, play, startGame, startWithDeadStone } from './serverWorld';

describe('入站消息校验', () => {
  /** 绕过类型检查，发一条任意内容的消息 */
  const raw = (client: Client, m: unknown) => {
    client.sess = client.srv.message(client.sess, m, client.conn);
  };
  /** n 个未知字段 */
  const junk = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));

  it('非法消息回复格式错误后丢弃，局面不变，对方收不到任何消息', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    jia.drain();
    yi.drain();
    for (const m of [
      { t: 'move', x: 7.5, y: 7 },
      { t: 'move', x: '7', y: 7 },
      { t: 'move', x: -0, y: 7 },
      { t: 'resign', extra: 1, ...junk(17) },
    ]) {
      raw(jia, m);
      expect(jia.inbox).toEqual([{ t: 'error', text: '消息格式错误' }]);
      jia.drain();
    }
    expect(yi.inbox).toEqual([]);
    jia.send({ t: 'move', x: 0, y: 0 }); // 第一手仍由甲来下，说明非法的那几手没有被当成 (0, 0) 落下
    expect(yi.expect('moved')).toEqual({ t: 'moved', x: 0, y: 0 });
  });

  it('取值超出范围的匹配与开房间请求被拒，不再被改成默认值', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲');
    raw(jia, { t: 'queue', mode: 'match', type: 0, size: 14 });
    raw(jia, { t: 'create', type: 1, size: 19, hostColor: 0, renju: false, moveTime: 600 });
    expect(jia.inbox).toEqual([
      { t: 'error', text: '消息格式错误' },
      { t: 'error', text: '消息格式错误' },
    ]);
    expect(srv.queued('match', 0)).toBe(0);
  });

  it('握手前的非法消息同样被拒；同一连接只记第一条日志', () => {
    const logs: { event: string; entry?: LogEntry }[] = [];
    const { srv } = world(new MemoryStore(), { log: (_level, event, entry) => logs.push({ event, entry }) });
    const inbox: S2C[] = [];
    const sess = must(srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: () => {} }) ?? undefined, '服务端接受的连接');
    for (const m of [undefined, null, [], { t: 'hello', v: PROTO_VERSION, name: '甲', uid: 'bad uid' }]) srv.message(sess, m);
    expect(inbox).toEqual(Array(4).fill({ t: 'error', text: '消息格式错误' }));
    expect(logs.filter(row => row.event === 'proto.invalid')).toEqual([{ event: 'proto.invalid', entry: expect.objectContaining({ reason: '消息不是对象' }) }]);
  });
});

/** 悔棋：被拒；同意后双方都退回两手；申请未回应时不能再申请；次数用完 */
function undoSteps(jia: Client, yi: Client) {
  yi.send({ t: 'undo' });
  expect(jia.expect('ask', m => m.kind === 'undo')).toBeTruthy();
  jia.send({ t: 'reply', kind: 'undo', ok: false });
  expect(yi.expect('answer', m => m.kind === 'undo' && !m.ok)).toBeTruthy();
  yi.send({ t: 'undo' });
  jia.expect('ask');
  jia.send({ t: 'reply', kind: 'undo', ok: true });
  expect(jia.expect('undone')?.n).toBe(2);
  expect(yi.expect('undone')?.n).toBe(2);
  yi.send({ t: 'undo' });
  jia.expect('ask');
  yi.send({ t: 'undo' });
  expect(yi.expect('info')?.text).toBe('现在不能申请悔棋');
  jia.send({ t: 'reply', kind: 'undo', ok: false });
  yi.expect('answer');
  yi.send({ t: 'undo' });
  expect(yi.expect('info')?.text).toBe('本局悔棋次数已用完');
}

/** 求和被拒、认输，再来一局时交换先后手 */
function drawResignRematch(jia: Client, yi: Client) {
  jia.drain();
  yi.drain();
  jia.send({ t: 'draw' });
  yi.expect('ask', m => m.kind === 'draw');
  yi.send({ t: 'reply', kind: 'draw', ok: false });
  expect(jia.expect('answer', m => m.kind === 'draw')).toBeTruthy();
  yi.send({ t: 'resign' });
  const over = must(jia.expect('over'), '终局消息');
  expect(over).toEqual({ t: 'over', winner: 1, reason: 'resign' });
  expect(yi.expect('over')).toBeTruthy();

  // 再来一局：交换先后手
  jia.send({ t: 'rematch' });
  yi.expect('ask', m => m.kind === 'rematch');
  yi.send({ t: 'reply', kind: 'rematch', ok: true });
  expect(jia.expect('start')?.color).toBe(2);
  expect(yi.expect('start')?.color).toBe(1);
}

/** 禁手：执黑的乙下三三被拒；随后连成五子，甲离开后乙不能再来一局 */
function renjuFiveLeave(jia: Client, yi: Client) {
  // 禁手：执黑的乙下三三被拒
  jia.drain();
  yi.drain();
  play(jia, yi, [
    [yi, 5, 7],
    [jia, 0, 0],
    [yi, 6, 7],
    [jia, 0, 2],
    [yi, 7, 5],
    [jia, 0, 4],
    [yi, 7, 6],
    [jia, 14, 14],
  ]);
  yi.send({ t: 'move', x: 7, y: 7 });
  expect(yi.expect('info')?.text).toContain('三三');

  // 连成五子
  play(jia, yi, [
    [yi, 8, 8],
    [jia, 10, 0],
    [yi, 9, 9],
    [jia, 10, 2],
    [yi, 10, 10],
    [jia, 10, 4],
    [yi, 11, 11],
    [jia, 12, 0],
  ]);
  yi.send({ t: 'move', x: 12, y: 12 });
  expect(jia.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'five' });
  jia.send({ t: 'leave' });
  expect(yi.expect('left')).toBeTruthy();
  yi.send({ t: 'rematch' });
  expect(yi.expect('info')?.text).toBe('对方已离开，无法再来一局');
  yi.send({ t: 'leave' });
  yi.send({ t: 'queue', mode: 'match', type: 0, size: 15 }); // 离开后可以接着匹配
  expect(yi.expect('queued')).toBeTruthy();
}

describe('五子棋对局', () => {
  it('轮次、悔棋、求和、认输、再来一局、禁手、五连、离开', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    yi.send({ t: 'move', x: 7, y: 7 });
    expect(yi.expect('info')?.text).toBe('还没轮到你');
    jia.send({ t: 'move', x: 7, y: 7 });
    expect(jia.expect('moved') && yi.expect('moved')).toBeTruthy();
    play(jia, yi, [
      [yi, 0, 0],
      [jia, 5, 7],
      [yi, 0, 1],
      [jia, 7, 5],
      [yi, 0, 2],
      [jia, 7, 6],
      [yi, 0, 4],
      [jia, 6, 7],
    ]);
    undoSteps(jia, yi);
    drawResignRematch(jia, yi);
    renjuFiveLeave(jia, yi);
  });

  it('对局中离开按认输处理', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    jia.send({ t: 'move', x: 7, y: 7 });
    jia.send({ t: 'leave' });
    expect(yi.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'left' });
    expect(yi.expect('left')).toBeTruthy();
  });
});

describe('断线', () => {
  it('用令牌重连：回到原对局并回放棋谱', () => {
    const { srv, advance } = world();
    const jia = new Client(srv, '甲'),
      bing = new Client(srv, '丙');
    startGame(jia, bing, { moveTime: 30 });
    jia.send({ t: 'move', x: 7, y: 7 });
    bing.send({ t: 'move', x: 8, y: 8 });
    advance(5);
    bing.drop();
    expect(jia.expect('peer')).toEqual({ t: 'peer', online: false, wait: 60 });
    for (let i = 0; i < 4; i++) {
      jia.send({ t: 'ping' });
      advance(10);
    } // 掉线期间暂停计时，不会超时
    expect(jia.has('over')).toBe(false);
    const bing2 = new Client(srv, '丙', bing.token);
    expect(bing2.id).toBe(bing.id);
    expect(bing2.expect('start')?.color).toBe(2);
    expect(bing2.expect('sync')?.acts).toEqual([
      { k: 'M', x: 7, y: 7 },
      { k: 'M', x: 8, y: 8 },
    ]);
    expect(bing2.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 25 });
    expect(jia.expect('peer')).toEqual({ t: 'peer', online: true });
    jia.send({ t: 'leave' });
    expect(bing2.expect('over')?.reason).toBe('left');
  });

  it('掉线太久判负', () => {
    const { srv, advance } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    yi.drop();
    advance(30);
    for (let i = 0; i < 4; i++) {
      jia.send({ t: 'ping' });
      advance(10);
    }
    expect(jia.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'disconnect' });
  });
});

describe('超时', () => {
  it('长时间没有消息的连接被断开', () => {
    const { srv, advance } = world();
    const jia = new Client(srv, '甲');
    advance(36);
    expect(jia.closed).toBe(true);
    expect(srv.online()).toBe(0);
  });

  it('每步限时用完判负；申请无人回应按拒绝处理', () => {
    const { srv, idle } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi, { moveTime: 30 });
    expect(jia.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 30 });
    jia.send({ t: 'move', x: 7, y: 7 });
    jia.send({ t: 'undo' });
    yi.drain();
    idle(21, jia, yi);
    expect(jia.expect('answer')).toEqual({ t: 'answer', kind: 'undo', ok: false });
    expect(yi.expect('turn')?.color).toBe(2); // 回应后重新计时
    idle(29, jia, yi);
    expect(jia.has('over')).toBe(false);
    idle(2, jia, yi);
    expect(jia.expect('over')).toEqual({ t: 'over', winner: 1, reason: 'timeout' });
  });
});

describe('围棋对局', () => {
  it('停一手、点目、标记死子、双方确认', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startWithDeadStone(jia, yi);
    yi.send({ t: 'pass' });
    jia.expect('passed');
    yi.expect('passed');
    jia.send({ t: 'pass' });
    jia.expect('passed');
    yi.expect('passed');
    expect(jia.expect('turn')?.secs).toBe(-1);
    yi.send({ t: 'mark', x: 7, y: 4 });
    expect(jia.expect('marked') && yi.expect('marked')).toBeTruthy();
    jia.send({ t: 'agree' });
    expect(yi.expect('agreed')?.color).toBe(1);
    yi.send({ t: 'agree' });
    expect(jia.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'score' }); // 白 45+7.5 胜黑 27
  });

  it('点目时恢复对局', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi, { type: 1, size: 9 });
    jia.send({ t: 'pass' });
    yi.send({ t: 'pass' });
    yi.send({ t: 'resume' });
    expect(jia.expect('resumed')).toBeTruthy();
    jia.send({ t: 'move', x: 4, y: 4 });
    expect(yi.expect('moved')).toEqual({ t: 'moved', x: 4, y: 4 });
  });
});
