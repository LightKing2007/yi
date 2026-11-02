/** 联机服务端：状态版本、请求序号与完整同步（protocol-v4.md 第 7 章，API-052），以假时钟直接驱动 RoomServer */
import { describe, expect, it } from 'vitest';
import { Client, play, startGame, world } from './serverWorld';

/** 开好友房间的一局：甲执黑、乙执白，双方的收件箱已清空 */
function game() {
  const { srv } = world();
  const jia = new Client(srv, '甲'),
    yi = new Client(srv, '乙');
  const opened = startGame(jia, yi);
  jia.drain();
  yi.drain();
  return { srv, jia, yi, ...opened };
}

describe('状态版本（第 7.1 条）', () => {
  it('开局为 0 并带局编号；每次对局变更加 1、双方收到同一版本；计时不带版本', () => {
    const { jia, yi, sa, sb } = game();
    expect([sa.match, sa.sv, sb.match, sb.sv]).toEqual([1, 0, 1, 0]);
    jia.send({ t: 'move', x: 7, y: 7 });
    yi.send({ t: 'move', x: 8, y: 8 });
    expect([jia.expect('moved', m => m.x === 8)?.sv, yi.expect('moved', m => m.x === 8)?.sv]).toEqual([2, 2]);
    expect([...jia.inbox, ...yi.inbox].filter(m => m.t === 'turn' && 'sv' in m)).toEqual([]);
  });

  it('申请与回应发给对局双方，带申请方的执子颜色（第 7.1.1 条）', () => {
    const { jia, yi } = game();
    play(jia, yi, [[jia, 7, 7]]);
    jia.send({ t: 'undo' });
    const ask = { t: 'ask', kind: 'undo', from: 1, sv: 2 };
    expect([jia.expect('ask'), yi.expect('ask')]).toEqual([ask, ask]);
    yi.send({ t: 'reply', kind: 'undo', ok: false });
    const answer = { t: 'answer', kind: 'undo', from: 1, ok: false, sv: 3 };
    expect([jia.expect('answer'), yi.expect('answer')]).toEqual([answer, answer]);
  });

  it('再来一局换新的局编号，版本从 0 重新开始，新局的第一手为 1', () => {
    const { jia, yi } = game();
    jia.send({ t: 'resign' });
    expect(yi.expect('over')?.sv).toBe(1);
    jia.send({ t: 'rematch' });
    yi.send({ t: 'reply', kind: 'rematch', ok: true });
    expect(yi.expect('answer')?.sv).toBe(3);
    const start = yi.expect('start');
    expect([start?.match, start?.sv]).toEqual([2, 0]);
    yi.send({ t: 'move', x: 7, y: 7 }); // 交换先后手：乙执黑
    expect(jia.expect('moved')?.sv).toBe(1);
  });
});

describe('请求序号：重复与跳号（第 7.2、7.3 条）', () => {
  it('重复的序号不执行，回复完整同步；对方收不到任何消息', () => {
    const { jia, yi } = game();
    play(jia, yi, [[jia, 7, 7]]);
    yi.sendRaw({ t: 'move', x: 8, y: 8, seq: 1, sv: 1 });
    jia.drain();
    yi.drain();
    yi.sendRaw({ t: 'move', x: 9, y: 9, seq: 1, sv: 2 }); // 网络重发的同一个序号
    expect(yi.expect('sync')).toEqual({
      t: 'sync',
      acts: [
        { k: 'M', x: 7, y: 7 },
        { k: 'M', x: 8, y: 8 },
      ],
      match: 1,
      sv: 2,
      seq: 1,
    });
    expect(jia.inbox).toEqual([]);
  });

  it('跳号不执行，回复完整同步；从同步中的序号加 1 继续即被接受', () => {
    const { jia, yi } = game();
    jia.sendRaw({ t: 'move', x: 7, y: 7, seq: 3, sv: 0 });
    expect(jia.expect('sync')).toEqual({ t: 'sync', acts: [], match: 1, sv: 0, seq: 3 });
    expect(yi.inbox).toEqual([]);
    jia.send({ t: 'move', x: 7, y: 7 }); // 测试客户端照同步记下序号 3，这一条编为 4
    expect(yi.expect('moved')).toEqual({ t: 'moved', x: 7, y: 7, sv: 1 });
  });
});

describe('过期的状态版本（第 7.3 条）', () => {
  it('状态版本过期时不执行，回复 game.stale 与完整同步（落子与申请都以当前局面为准）', () => {
    const { jia, yi } = game();
    play(jia, yi, [
      [jia, 7, 7],
      [yi, 8, 8],
    ]);
    jia.drain();
    yi.drain();
    jia.sendRaw({ t: 'undo', seq: 2, sv: 1 }); // 甲还没看到乙的第二手
    expect(jia.inbox.map(m => m.t)).toEqual(['error', 'start', 'sync', 'turn']);
    expect(jia.expect('error')).toEqual({ t: 'error', code: 'game.stale', level: 'E1' });
    expect(jia.expect('sync')).toMatchObject({ sv: 2, seq: 2 });
    jia.sendRaw({ t: 'move', x: 0, y: 0, seq: 3, sv: 1 });
    expect(jia.expect('sync')?.acts).toHaveLength(2); // 没有落下
    expect(yi.inbox).toEqual([]);
    jia.sendRaw({ t: 'move', x: 0, y: 0, seq: 4, sv: 2 });
    expect(yi.expect('moved')?.sv).toBe(3);
  });

  it('认输与离开不以局面为前提：版本过期也照常执行', () => {
    const { jia, yi } = game();
    play(jia, yi, [
      [jia, 7, 7],
      [yi, 8, 8],
    ]);
    jia.sendRaw({ t: 'resign', seq: 2, sv: 0 });
    expect(yi.expect('over')).toMatchObject({ winner: 2, reason: 'resign' });
    yi.send({ t: 'rematch' });
    jia.sendRaw({ t: 'leave', seq: 3, sv: 0 }); // 没看到再来一局的申请
    expect(yi.has('left')).toBe(true);
    expect(jia.has('error')).toBe(false);
  });
});

describe('请求序号：接管与对局之外', () => {
  it('接管后序号从 1 重新开始：同步中的序号为 0，新连接的第一条请求被接受', () => {
    const { srv, jia, yi } = game();
    play(jia, yi, [
      [jia, 7, 7],
      [yi, 8, 8],
    ]);
    const again = new Client(srv, '甲', jia.token, jia.uid);
    expect(again.expect('sync')).toMatchObject({ sv: 2, seq: 0 });
    again.send({ t: 'move', x: 9, y: 9 });
    expect(yi.expect('moved')).toEqual({ t: 'moved', x: 9, y: 9, sv: 3 });
  });

  it('不在对局中时没有可同步的：跳号只记下序号，不回复', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.sendRaw({ t: 'leave', seq: 5, sv: 0 });
    expect(jia.inbox).toEqual([]);
    jia.seq = 5;
    startGame(jia, yi);
    jia.send({ t: 'move', x: 7, y: 7 }); // 序号 6
    expect(yi.expect('moved')?.sv).toBe(1);
  });
});

describe('完整同步（第 7.4 条）', () => {
  it('resync：回放整局，sync 带局编号、版本与已处理的序号，待回应的申请也补发给申请方', () => {
    const { jia, yi } = game();
    play(jia, yi, [
      [jia, 7, 7],
      [yi, 8, 8],
    ]);
    jia.send({ t: 'undo' });
    jia.drain();
    jia.send({ t: 'resync' });
    expect(jia.inbox.map(m => m.t)).toEqual(['start', 'sync', 'ask', 'turn']);
    expect(jia.expect('sync')).toEqual({
      t: 'sync',
      acts: [
        { k: 'M', x: 7, y: 7 },
        { k: 'M', x: 8, y: 8 },
      ],
      match: 1,
      sv: 3,
      seq: 2,
    });
    expect(jia.expect('ask')).toEqual({ t: 'ask', kind: 'undo', from: 1, sv: 3 });
  });

  it('终局后同步：补发终局结果与待回应的再来一局申请，不发计时', () => {
    const { jia, yi } = game();
    jia.send({ t: 'resign' });
    jia.send({ t: 'rematch' });
    yi.drain();
    yi.send({ t: 'resync' });
    expect(yi.inbox.map(m => m.t)).toEqual(['start', 'sync', 'over', 'ask']);
    expect(yi.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'resign', sv: 2 });
    expect(yi.expect('ask')).toEqual({ t: 'ask', kind: 'rematch', from: 1, sv: 2 });
  });

  it('不在对局中的 resync 什么也不回', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲');
    jia.send({ t: 'resync' });
    expect(jia.inbox).toEqual([]);
  });
});
