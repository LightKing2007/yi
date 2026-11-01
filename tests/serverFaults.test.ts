/** 联机服务端：未预期的异常的隔离（API-023、EDGE-002）与对局上限（API-046） */
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/rooms';
import type { GameEnd, GameStart, Settle } from '../server/roomTypes';
import type { LogEntry, LogLevel } from '../server/log';
import { ACTS_MAX, CLOSE_CODE, CONFIRM_SECS, GRACE_SECS, MOVES_MAX, type C2S, type S2C } from '../src/shared/protocol';
import { Client, world, startGame, matchUp } from './serverWorld';

/** 对局记录的写入可以出错的存放处（模拟数据库写满或拒绝写入） */
class BrokenStore extends MemoryStore {
  broken = false;
  override startGame(start: GameStart) {
    if (this.broken) throw new Error('写对局记录失败：开局');
    return super.startGame(start);
  }
  override finishGame(id: number, end: GameEnd, settle?: Settle) {
    if (this.broken) throw new Error('写对局记录失败：终局');
    return super.finishGame(id, end, settle);
  }
}
/** 错误编号的格式：UUID v4 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 存档可以出错、记下日志的服务端；fault() 取出唯一一行 internal.error 日志，行数不是 1 时测试失败 */
function faulty() {
  const store = new BrokenStore();
  const logs: { level: LogLevel; event: string; entry: LogEntry }[] = [];
  const env = world(store, { log: (level, event, entry = {}) => logs.push({ level, event, entry }) });
  const fault = () => {
    const rows = logs.filter(row => row.event === 'internal.error');
    expect(rows).toHaveLength(1);
    return { level: rows[0]?.level, entry: rows[0]?.entry ?? {} };
  };
  return { ...env, store, fault };
}
/** 让这条连接在发送某类消息时抛出（模拟传输层出错）；types 为空时任何消息都抛出 */
function breakSend(client: Client, ...types: S2C['t'][]) {
  const send = client.conn.send;
  client.conn.send = m => {
    if (!types.length || types.includes(m.t)) throw new Error(`发送失败：${m.t}`);
    send(m);
  };
}
/** 这位玩家以服务端内部错误被断开，收到的错误编号与日志中的相同 */
function expectKicked(client: Client, errorId: unknown) {
  expect(client.expect('error')).toEqual({ t: 'error', code: 'server.internal', level: 'E5', errorId });
  expect(client.closeCode).toBe(CLOSE_CODE.internal);
}

describe('未预期的异常：处理消息与断线（API-023、EDGE-002）', () => {
  it('处理消息时抛出：只以 1011 断开发消息的连接，日志记下调用栈与错误编号并下发给它，其余房间照常对局', () => {
    const { srv, fault } = faulty();
    const [jia, yi, bing, ding] = ['甲', '乙', '丙', '丁'].map(name => new Client(srv, name)) as [Client, Client, Client, Client];
    matchUp(jia, yi, 'ranked');
    const { sa } = startGame(bing, ding);
    breakSend(jia, 'over');
    expect(() => jia.send({ t: 'resign' })).not.toThrow();
    const { level, entry } = fault();
    expect(level).toBe('error');
    expect(entry).toMatchObject({ msg: '处理消息时出现未预期的异常', playerId: jia.id, errorId: expect.stringMatching(UUID_V4) });
    expect((entry.err as Error).message).toBe('发送失败：over');
    expectKicked(jia, entry.errorId);
    expect(yi.closed).toBe(false);
    const [blk, wht] = sa.color === 1 ? [bing, ding] : [ding, bing];
    blk.send({ t: 'move', x: 7, y: 7 });
    expect(wht.expect('moved')).toEqual({ t: 'moved', x: 7, y: 7 });
  });

  it('处理断线时抛出：移除断线的玩家并放弃其房间，对手以 1011 断开', () => {
    const { srv, fault } = faulty();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    matchUp(jia, yi);
    breakSend(yi, 'peer');
    expect(() => jia.drop()).not.toThrow();
    const { entry } = fault();
    expect(entry).toMatchObject({ msg: '处理断线时出现未预期的异常', playerId: jia.id });
    expect((entry.err as Error).message).toBe('发送失败：peer');
    expectKicked(yi, entry.errorId);
    expect(srv.health()).toMatchObject({ players: 0, games: 0 });
    expect(srv.tokenCount()).toBe(0);
  });
});

describe('未预期的异常：定时检查（API-023、EDGE-002）', () => {
  it('检查房间时限时抛出：放弃该房间，座位上的两人以 1011 断开、重连时得知对局已不在；同一次检查中其他房间照常判超时', () => {
    const { srv, fault, advance } = faulty();
    const [jia, yi, bing, ding] = ['甲', '乙', '丙', '丁'].map(name => new Client(srv, name)) as [Client, Client, Client, Client];
    matchUp(jia, yi, 'ranked'); // 五子棋排位每步限时 30 秒，先开局的房间先检查
    startGame(bing, ding, { moveTime: 30 });
    breakSend(jia, 'over'); // 判超时后下发终局结果时出错
    advance(31);
    const { entry } = fault();
    expect(entry).toMatchObject({ msg: '检查房间时限时出现未预期的异常', roomId: 1 });
    expectKicked(jia, entry.errorId);
    expectKicked(yi, entry.errorId);
    expect(bing.expect('over')).toMatchObject({ reason: 'timeout' });
    advance(1);
    fault(); // 出错的房间已移除，不再重复出错
    expect(new Client(srv, '甲', jia.token, jia.uid).has('resumeFailed')).toBe(true);
  });

  it('检查玩家时限时抛出：移除该玩家并放弃其房间，对手以 1011 断开，此后不再重复出错', () => {
    const { srv, fault, idle } = faulty();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    matchUp(jia, yi, 'ranked');
    yi.drop(); // 掉线保留期满时判负，向对手下发终局结果时出错
    breakSend(jia, 'over');
    idle(GRACE_SECS + 1, jia);
    const { entry } = fault();
    expect(entry).toMatchObject({ msg: '检查玩家时限时出现未预期的异常', playerId: yi.id });
    expectKicked(jia, entry.errorId);
    expect(srv.tokenCount()).toBe(0); // 出错的玩家当即移除，连同令牌
    idle(GRACE_SECS);
    fault();
    expect(srv.health()).toMatchObject({ players: 0, games: 0 });
  });

  it('检查配对确认时抛出：放弃该配对，双方以 1011 断开；连告知错误也发不出去的连接照常断开', () => {
    const { srv, fault, advance } = faulty();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    yi.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    jia.send({ t: 'confirm', ok: true });
    breakSend(jia);
    advance(CONFIRM_SECS + 1);
    const { entry } = fault();
    expect(entry).toMatchObject({ msg: '检查配对确认时出现未预期的异常', playerIds: [jia.id, yi.id] });
    expect(jia.closeCode).toBe(CLOSE_CODE.internal);
    expectKicked(yi, entry.errorId);
    expect(srv.queued('match', 0)).toBe(0);
  });
});

// ---------------- 对局上限（API-046，P2-16） ----------------

/** 说明中的数字须与协议中的上限一致 */

/** 带日志的服务端，并开好一局围棋（好友房间为 size 路，排位为 19 路）：返回执黑、执白的两人；send 每发 20 条消息时钟前进 1 秒，不触发限流（每秒 20 条，可积攒 40 条） */
function goGame(mode: 'friend' | 'ranked', size = 19) {
  const logs: { level: LogLevel; event: string; entry: LogEntry }[] = [];
  const env = world(new MemoryStore(), { log: (level, event, entry = {}) => logs.push({ level, event, entry }) });
  const jia = new Client(env.srv, '甲'),
    yi = new Client(env.srv, '乙');
  const sa = mode === 'ranked' ? matchUp(jia, yi, 'ranked', 1).sa : startGame(jia, yi, { type: 1, size, moveTime: 0 }).sa;
  const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
  let sent = 0;
  const send = (who: Client, m: C2S) => {
    if (++sent % 20 === 0) env.advance(1);
    who.send(m);
  };
  /** 双方轮流停一手，进入点目后由黑方恢复对局，直到下满 plies 手（从开局算起，plies 为偶数） */
  const passTo = (plies: number) => {
    for (let n = 0; n < plies; n += 2) {
      if (n) send(blk, { t: 'resume' });
      send(blk, { t: 'pass' });
      send(wht, { t: 'pass' });
    }
  };
  return { ...env, logs, blk, wht, send, passTo };
}

describe('对局上限：手数（API-046，P2-16）', () => {
  it('停一手也计入手数：第 1024 手后按和棋结束，终局原因为 limit-moves，此后的请求不再处理', () => {
    const { blk, wht, send, passTo, logs } = goGame('friend');
    passTo(MOVES_MAX - 2);
    send(blk, { t: 'resume' });
    send(blk, { t: 'pass' });
    expect(blk.has('over')).toBe(false);
    send(wht, { t: 'pass' });
    for (const client of [blk, wht]) {
      const at = client.inbox.findIndex(m => m.t === 'over');
      expect(client.inbox.slice(at)).toEqual([{ t: 'over', winner: 3, reason: 'limit-moves' }]);
      client.drain();
    }
    expect(logs.filter(row => row.event === 'game.limit')).toEqual([
      { level: 'warn', event: 'game.limit', entry: expect.objectContaining({ moves: MOVES_MAX, acts: MOVES_MAX + MOVES_MAX / 2 - 1 }) },
    ]);
    send(blk, { t: 'resume' });
    send(blk, { t: 'pass' });
    expect(blk.has('passed') || blk.has('resumed')).toBe(false);
  });

  it('达到上限后再来一局：新的一局结束时，重连补发的是新一局的终局原因', () => {
    const { blk, wht, send, passTo, srv } = goGame('friend');
    passTo(MOVES_MAX);
    expect(blk.expect('over')?.reason).toBe('limit-moves');
    send(blk, { t: 'rematch' });
    send(wht, { t: 'reply', kind: 'rematch', ok: true });
    expect(blk.expect('start')).toBeTruthy();
    blk.drop();
    send(wht, { t: 'resign' });
    const back = new Client(srv, blk.name, blk.token, blk.uid);
    expect(back.expect('over')?.reason).toBe('resign');
  });

  it('排位对局达到上限时按和棋结束，但不结算段位', () => {
    const { blk, wht, send, passTo, logs } = goGame('ranked');
    passTo(MOVES_MAX - 2);
    send(blk, { t: 'resume' });
    send(blk, { t: 'pass' });
    send(wht, { t: 'pass' });
    for (const client of [blk, wht]) {
      expect(client.expect('over')).toEqual({ t: 'over', winner: 3, reason: 'limit-moves' });
      expect(client.has('rated')).toBe(false);
    }
    expect(logs.filter(row => row.event === 'rating.changed')).toEqual([]);
  });
});

describe('对局上限：动作记录（API-046，P2-16）', () => {
  it('动作记录记满 4096 条时按和棋结束，终局原因为 limit-acts；掉线的一方重连后补收同样的终局结果', () => {
    const { blk, wht, send, srv } = goGame('friend', 9);
    send(blk, { t: 'move', x: 0, y: 0 });
    send(wht, { t: 'move', x: 8, y: 8 });
    send(blk, { t: 'pass' });
    send(wht, { t: 'pass' }); // 进入点目，此时 4 条动作记录
    // 批量标记期间两人的连接只记下消息类型，不再逐条经客户端校验，免得测试过慢；记满前后的消息照常校验
    const [blkSend, whtSend] = [blk.conn.send, wht.conn.send];
    const seen: S2C['t'][] = [];
    blk.conn.send = wht.conn.send = m => seen.push(m.t);
    for (let n = 4; n < ACTS_MAX - 1; n++) {
      send(blk, { t: 'mark', x: 0, y: 0 });
      if (n % 100 === 0) send(wht, { t: 'ping' }); // 白方照常发心跳，免得被当作空闲断线
    }
    [blk.conn.send, wht.conn.send] = [blkSend, whtSend];
    expect(seen).not.toContain('over');
    expect(seen.filter(type => type === 'marked')).toHaveLength(2 * (ACTS_MAX - 5));
    wht.drop();
    send(blk, { t: 'mark', x: 0, y: 0 });
    expect(blk.expect('over')).toEqual({ t: 'over', winner: 3, reason: 'limit-acts' });
    const back = new Client(srv, '乙', wht.token, wht.uid);
    expect(back.expect('sync')?.acts).toHaveLength(ACTS_MAX);
    expect(back.expect('over')).toEqual({ t: 'over', winner: 3, reason: 'limit-acts' });
  });
});
