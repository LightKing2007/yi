/** 对局记录（server/record.ts、server/db/ratingStore.ts，roadmap.md 第 5.4 节）：开局与终局写入、每手用时、事务内结算、结算前重新读取段位、上限与放弃、写入失败 */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MEMORY, openDatabase } from '../server/db';
import { DbRatingStore } from '../server/db/ratingStore';
import { Repo } from '../server/db/repo';
import type { LogEntry, LogLevel } from '../server/log';
import { Metrics } from '../server/metrics';
import { replay, type GameRecord } from '../src/core/record';
import { MOVES_MAX, type C2S, type S2C } from '../src/shared/protocol';
import { Client, matchUp, play, startGame, startWithDeadStone, world } from './serverWorld';
import { MemoryStore } from '../server/rooms';
import type { GameEnd, GameStart, Settle } from '../server/roomTypes';

const opened: DatabaseSync[] = [];

/** 以内存数据库为存放处、记下日志的服务端 */
function dbWorld() {
  const db = openDatabase(MEMORY, { now: () => 1, appVersion: 'test' });
  opened.push(db);
  const repo = new Repo(db);
  const logs: { level: LogLevel; event: string; entry: LogEntry }[] = [];
  const env = world(new DbRatingStore(repo, { now: () => 5000 }), { log: (level, event, entry = {}) => logs.push({ level, event, entry }) });
  const games = () =>
    db
      .prepare(
        'SELECT id, kind, game_type, board_size, black_user_id, white_user_id, move_count, winner, end_reason, is_rated, ended_at FROM games ORDER BY id',
      )
      .all()
      .map(row => ({ ...row }));
  const record = (id: number) => JSON.parse(String(db.prepare('SELECT record FROM games WHERE id = ?').get(id)?.record)) as GameRecord & { v: number };
  const changes = () =>
    db
      .prepare('SELECT game_id, user_id, game_type, points_before, points_after, cause FROM rating_changes ORDER BY id')
      .all()
      .map(row => ({ ...row }));
  return { ...env, db, repo, logs, games, record, changes };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe('对局记录', () => {
  it('排位一局：开局写入双方与规则，终局在同一事务中写入棋谱、结果、双方段位与两条变化明细；棋谱可回放到终局局面', () => {
    const { srv, games, record, changes, repo } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    const { sa } = matchUp(jia, yi, 'ranked');
    const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
    const blackUser = repo.userOf(uidHashOf(blk)) ?? 0;
    expect(games()).toEqual([
      expect.objectContaining({ id: 1, kind: 'ranked', game_type: 'gomoku', board_size: 15, black_user_id: blackUser, ended_at: null }),
    ]);
    play(blk, wht, [
      [blk, 7, 7],
      [wht, 8, 8],
    ]);
    blk.send({ t: 'resign' });
    expect(games()).toEqual([expect.objectContaining({ move_count: 2, winner: 'white', end_reason: 'resign', is_rated: 1, ended_at: 5000 })]);
    const saved = record(1);
    expect(saved.v).toBe(1);
    expect(saved.moves.map(move => move.m)).toEqual([
      { k: 'play', x: 7, y: 7 },
      { k: 'play', x: 8, y: 8 },
    ]);
    expect(saved.result).toEqual({ winner: 2, reason: 'resign' });
    expect(replay(saved).pos.b.filter(Boolean)).toHaveLength(2);
    expect(changes()).toEqual([
      { game_id: 1, user_id: blackUser, game_type: 'gomoku', points_before: 1200, points_after: 1184, cause: 'game' },
      { game_id: 1, user_id: expect.any(Number), game_type: 'gomoku', points_before: 1200, points_after: 1216, cause: 'game' },
    ]);
    expect(wht.expect('rated')).toEqual({ t: 'rated', type: 0, rating: { points: 1216, win: 1, loss: 0, draw: 0 }, delta: 16 });
  });
});

describe('每手用时', () => {
  it('每手用时按服务端时钟记到毫秒，从轮到该方起计；申请被拒不打断这一手的计时', () => {
    const { srv, record, advance } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    const { sa } = startGame(jia, yi, { moveTime: 0 });
    const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
    advance(2);
    play(blk, wht, [[blk, 7, 7]]);
    advance(3);
    wht.send({ t: 'draw' }); // 白方求和被拒：白方这一手仍从黑方落子起计时
    blk.send({ t: 'reply', kind: 'draw', ok: false });
    advance(4);
    play(blk, wht, [[wht, 8, 8]]);
    advance(0.25);
    play(blk, wht, [[blk, 6, 6]]);
    blk.send({ t: 'resign' });
    expect(record(1).moves.map(move => move.ms)).toEqual([2000, 7000, 250]);
  });

  it('悔棋后重新计时：棋谱只保存终局时的着法序列', () => {
    const { srv, record, advance } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    const { sa } = startGame(jia, yi, { moveTime: 0 });
    const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
    play(blk, wht, [
      [blk, 7, 7],
      [wht, 8, 8],
    ]);
    advance(9);
    blk.send({ t: 'undo' }); // 黑方悔棋（连同白方刚应的一手），同意后黑方重新计时
    wht.send({ t: 'reply', kind: 'undo', ok: true });
    advance(1.5);
    play(blk, wht, [[blk, 6, 6]]);
    blk.send({ t: 'resign' });
    expect(record(1).moves).toEqual([{ m: { k: 'play', x: 6, y: 6 }, ms: 1500 }]);
  });
});

describe('对局记录的种类与终局', () => {
  it('好友房间不结算段位；再来一局写入新的一局', () => {
    const { srv, games, changes } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    jia.send({ t: 'resign' });
    jia.send({ t: 'rematch' });
    yi.send({ t: 'reply', kind: 'rematch', ok: true });
    expect(games()).toEqual([
      expect.objectContaining({ id: 1, kind: 'friend', end_reason: 'resign', is_rated: 0 }),
      expect.objectContaining({ id: 2, kind: 'friend', ended_at: null }),
    ]);
    expect(changes()).toEqual([]);
  });

  it('点目结束的围棋记下死子', () => {
    const { srv, record } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startWithDeadStone(jia, yi);
    for (const who of [yi, jia]) who.send({ t: 'pass' });
    yi.send({ t: 'mark', x: 7, y: 4 });
    jia.send({ t: 'agree' });
    yi.send({ t: 'agree' });
    expect(record(1)).toEqual(expect.objectContaining({ dead: [{ x: 7, y: 4 }], result: { winner: 2, reason: 'score' } }));
  });
});

describe('结算与特殊的终局', () => {
  it('结算前重新读取双方段位，不用握手时缓存的（原问题 A8）', () => {
    const { srv, repo } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    const { sa } = matchUp(jia, yi, 'ranked');
    const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
    // 开局之后，双方的设备都在别处结算过：数据库中黑方 1300、白方 1500 分，在线玩家缓存的仍是 1200
    repo.saveRating(repo.userOf(uidHashOf(blk)) ?? 0, 'gomoku', { points: 1300, win: 0, loss: 0, draw: 0 }, 1);
    repo.saveRating(repo.userOf(uidHashOf(wht)) ?? 0, 'gomoku', { points: 1500, win: 0, loss: 0, draw: 0 }, 1);
    blk.send({ t: 'resign' });
    expect(blk.expect('rated')).toEqual({ t: 'rated', type: 0, rating: { points: 1292, win: 0, loss: 1, draw: 0 }, delta: -8 });
    expect(wht.expect('rated')).toEqual({ t: 'rated', type: 0, rating: { points: 1508, win: 1, loss: 0, draw: 0 }, delta: 8 });
  });

  it('结算后在线玩家的段位随之更新：再次排位时，开局信息中的段位分为结算后的', () => {
    const { srv } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    const first = matchUp(jia, yi, 'ranked').sa;
    (first.color === 1 ? jia : yi).send({ t: 'resign' });
    for (const client of [jia, yi]) client.send({ t: 'leave' });
    const again = matchUp(jia, yi, 'ranked').sa;
    expect([again.black.points, again.white.points].sort()).toEqual([1184, 1216]);
  });

  it('达到手数上限的排位局记为 limit、和棋，不结算段位；1024 手的棋谱在 256 KB 以内', () => {
    const { srv, games, changes, record, advance } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    const { sa } = matchUp(jia, yi, 'ranked', 1);
    const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
    let sent = 0;
    const send = (who: Client, m: C2S) => {
      if (++sent % 20 === 0) advance(1); // 不触发每条连接的消息限速
      who.send(m);
    };
    for (let n = 0; n < MOVES_MAX; n += 2) {
      if (n) send(blk, { t: 'resume' });
      send(blk, { t: 'pass' });
      send(wht, { t: 'pass' });
    }
    expect(games()).toEqual([expect.objectContaining({ move_count: MOVES_MAX, winner: 'draw', end_reason: 'limit', is_rated: 0 })]);
    expect(changes()).toEqual([]);
    expect(record(1).result).toEqual({ winner: 3, reason: 'draw' }); // 棋谱没有“达到上限”一类，按和棋记
    expect(JSON.stringify(record(1)).length).toBeLessThan(256 * 1024);
    expect(record(1).moves.every(move => move.m.k === 'pass' && typeof move.ms === 'number')).toBe(true); // 停一手也记下用时
  });

  it('服务端放弃的对局（终局途中出错）记为 aborted、和棋', () => {
    const { srv, games, advance } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    matchUp(jia, yi, 'ranked');
    const send = jia.conn.send;
    jia.conn.send = (m: S2C) => {
      if (m.t === 'over') throw new Error('发送失败：over');
      send(m);
    };
    advance(31); // 判超时，下发终局结果时出错，房间被放弃
    expect(games()).toEqual([expect.objectContaining({ winner: 'draw', end_reason: 'aborted', is_rated: 0 })]);
  });
});

describe('存放处直接调用', () => {
  it('已经终局的对局不再写入，也不再结算', () => {
    const { srv, repo, changes } = dbWorld();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    matchUp(jia, yi, 'ranked');
    jia.send({ t: 'resign' });
    const store = new DbRatingStore(repo, { now: () => 6000 });
    const end = { record: { cfg: { type: 0, size: 15, renju: true, komi: 0 }, moves: [] }, winner: 1, reason: 'resign' as const };
    expect(
      store.finishGame(1, end, () => ({
        black: { before: 0, rating: { points: 9999, win: 0, loss: 0, draw: 0 }, delta: 1 },
        white: { before: 0, rating: { points: 0, win: 0, loss: 0, draw: 0 }, delta: -1 },
      })),
    ).toBeUndefined();
    expect(changes()).toHaveLength(2);
    expect(store.finishGame(99, end)).toBeUndefined(); // 没有这一局
  });
});

/** 对局记录的写入可以出错的存放处 */
class BrokenStore extends MemoryStore {
  brokenStart = false;
  brokenFinish = false;
  override startGame(start: GameStart) {
    if (this.brokenStart) throw new Error('写对局记录失败：开局');
    return super.startGame(start);
  }
  override finishGame(id: number, end: GameEnd, settle?: Settle) {
    if (this.brokenFinish) throw new Error('写对局记录失败：终局');
    return super.finishGame(id, end, settle);
  }
}

describe('对局记录写入失败（10-edge-cases.md 第 4 节）', () => {
  const setup = () => {
    const store = new BrokenStore();
    const logs: { event: string; entry: LogEntry }[] = [];
    const metrics = new Metrics({ version: 'test', commit: '' });
    const env = world(store, { metrics, log: (_level, event, entry = {}) => logs.push({ event, entry }) });
    const jia = new Client(env.srv, '甲'),
      yi = new Client(env.srv, '乙');
    return { ...env, store, logs, metrics, jia, yi };
  };

  it('终局写入失败：写 db.write-failed，向双方下发提示与同一错误编号；不结算段位，不断开连接', () => {
    const { store, logs, metrics, jia, yi } = setup();
    matchUp(jia, yi, 'ranked');
    store.brokenFinish = true;
    jia.send({ t: 'resign' });
    const failed = logs.filter(row => row.event === 'db.write-failed');
    expect(failed).toEqual([{ event: 'db.write-failed', entry: expect.objectContaining({ op: 'finish', errorId: expect.any(String) }) }]);
    const errorId = failed[0]?.entry.errorId;
    for (const client of [jia, yi]) {
      expect(client.expect('over')).toMatchObject({ reason: 'resign' });
      expect(client.expect('error')).toEqual({ t: 'error', code: 'server.internal', level: 'E5', errorId });
      expect(client.has('rated')).toBe(false);
      expect(client.closed).toBe(false);
    }
    expect(
      metrics.snapshot({
        connections: 0,
        playersOnline: 0,
        rooms: [],
        queue: [],
        downloadsActive: 0,
        eventLoopLagSeconds: 0,
        residentMemoryBytes: 0,
        dbFileBytes: 0,
        joinFailIps: 0,
      }).yi_db_write_failures_total,
    ).toBe(1);
  });

  it('开局写入失败：对局照常进行；终局时因没有记录而不结算段位，同样下发提示', () => {
    const { store, logs, jia, yi } = setup();
    store.brokenStart = true;
    const { sa } = matchUp(jia, yi, 'ranked');
    store.brokenStart = false;
    const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
    play(blk, wht, [[blk, 7, 7]]);
    wht.send({ t: 'resign' });
    expect(logs.filter(row => row.event === 'db.write-failed').map(row => row.entry.op)).toEqual(['start', 'finish']);
    expect(blk.expect('over')).toMatchObject({ winner: 1, reason: 'resign' });
    expect(blk.has('rated')).toBe(false);
    expect(blk.expect('error')).toMatchObject({ code: 'server.internal' });
  });
});

/** 客户端在服务端的设备散列 */
function uidHashOf(client: Client) {
  return createHash('sha256')
    .update('yi:' + client.uid)
    .digest('hex')
    .slice(0, 32);
}
