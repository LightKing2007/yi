/**
 * 联机客户端的断线重连：对局中断线后按完全抖动的指数退避重连（API-050），并按服务端的关闭码决定是否重连、多久后重连
 * （04-api.md 第 4.2 条）。重连时刻由假时钟与固定的随机数决定（TST-020），替身见 fakeNet.ts
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_CODE, GRACE_SECS } from '../src/shared/protocol';
import { advance, fake, inject, lastSocket, loadClient, logs, pump, resetNet, sockets, startGame, type Peer, type Client, type State } from './fakeNet';
import { must } from './must';

let net: Client, state: State;
beforeAll(async () => ({ net, state } = await loadClient()));
beforeEach(resetNet);

/** Math.random 取不到 1；取一个足够接近的值，使每次重连都等满当次的退避上限 */
const ALMOST_ONE = 1 - 1e-9;
/** 服务端下发的错误编号（UUID v4） */
const ERROR_ID = '0b6f1c52-9d4e-4f3a-8c21-5e7d9a0b1c2d';

/** 时间一秒一秒地推进，直到客户端发起下一次连接，返回经过的秒数；limit 秒内没有发起时返回 -1 */
function secsToNextConnect(peer: Peer, limit = 70) {
  const n = sockets.length,
    t0 = fake.now;
  for (let i = 0; i < limit && sockets.length === n; i++) advance(1, peer);
  return sockets.length === n ? -1 : fake.now - t0;
}

describe('断线重连：完全抖动的指数退避（API-050）', () => {
  it('网络一直不通：重连间隔按 2、4、5、5… 秒退避，对局保留期内至少尝试 12 次', () => {
    const peer = startGame(0); // 不限时：推进时间时不会因超时结束对局
    advance(1, peer); // 先走一帧，客户端记下正在对局
    net.setRetryRandom(() => ALMOST_ONE);
    fake.netDown = true;
    const first = sockets.length,
      t0 = fake.now;
    must(sockets[first - 1], '当前连接').cut();
    pump();
    advance(GRACE_SECS, peer);
    const times = sockets.slice(first).map(sock => sock.at - t0);
    expect(times.slice(0, 4)).toEqual([2, 6, 11, 16]);
    expect(times.length).toBeGreaterThanOrEqual(12);
    expect(net.st.reconnecting).toBe(true);
  });

  it('保留期过后放弃这一局，重连次数归零：下一局刚开局就断线时，仍从 2 秒起退避', () => {
    let peer = startGame(0);
    advance(1, peer);
    net.setRetryRandom(() => ALMOST_ONE);
    fake.netDown = true;
    lastSocket().cut();
    pump();
    advance(GRACE_SECS + 2, peer);
    expect(net.st.phase).toBe(net.Phase.Off);
    fake.netDown = false;
    peer = startGame(0);
    advance(1, peer);
    lastSocket().cut();
    pump();
    expect(secsToNextConnect(peer)).toBe(2);
  });

  it('连接保持 60 秒以上后重连次数归零；不到 60 秒又断开时接着退避', () => {
    const peer = startGame(0); // 不限时：推进时间时不会因超时结束对局
    advance(1, peer); // 先走一帧，客户端记下正在对局
    net.setRetryRandom(() => ALMOST_ONE);
    lastSocket().cut();
    pump();
    expect(secsToNextConnect(peer)).toBe(2); // 第 1 次
    expect(net.st.phase).toBe(net.Phase.Playing);
    advance(30, peer);
    lastSocket().cut();
    pump();
    expect(secsToNextConnect(peer)).toBe(4); // 上一条连接只保持了 30 秒：第 2 次
    advance(61, peer);
    lastSocket().cut();
    pump();
    expect(secsToNextConnect(peer)).toBe(2); // 保持了 61 秒：从头算起
    expect(net.st.reconnecting).toBe(false);
  });
});

describe('断线重连：按关闭码决定是否重连、多久后重连（04-api.md 第 4.2 条）', () => {
  it('服务端以 1008 断开（累计违规）：30 秒后才重连；以 1013 断开（过载）：首次至少等 5 秒', () => {
    const peer = startGame(0); // 不限时：推进时间时不会因超时结束对局
    advance(1, peer); // 先走一帧，客户端记下正在对局
    net.setRetryRandom(() => 0);
    lastSocket().cut(CLOSE_CODE.policy);
    pump();
    expect(secsToNextConnect(peer)).toBe(30);
    advance(61, peer);
    lastSocket().cut(CLOSE_CODE.overload);
    pump();
    expect(secsToNextConnect(peer)).toBe(5);
    expect(net.st.phase).toBe(net.Phase.Playing);
  });

  it('服务端以 4000 断开（协议版本不支持）：不再重连，回到多人游戏页并提示更新游戏', () => {
    const peer = startGame(0); // 不限时：推进时间时不会因超时结束对局
    advance(1, peer); // 先走一帧，客户端记下正在对局
    state.screen.value = state.Screen.Game;
    lastSocket().cut(CLOSE_CODE.version);
    pump();
    expect(secsToNextConnect(peer, 10)).toBe(-1);
    expect(net.st.phase).toBe(net.Phase.Off);
    expect(state.screen.value).toBe(state.Screen.Online);
    expect(net.st.notice).toEqual([['客户端版本与服务器不一致，请更新游戏']]);
  });

  it('服务端以 1011 断开（内部错误）：对局中照常退避重连，先收到的错误编号写入 error 日志（API-023）', () => {
    const peer = startGame(0); // 不限时：推进时间时不会因超时结束对局
    advance(1, peer); // 先走一帧，客户端记下正在对局
    net.setRetryRandom(() => 0);
    inject({ t: 'error', text: '服务器出现问题，请稍后再试', errorId: ERROR_ID });
    lastSocket().cut(CLOSE_CODE.internal);
    pump();
    expect(secsToNextConnect(peer)).toBe(1);
    expect(net.st.phase).toBe(net.Phase.Playing);
    expect(logs).toContainEqual(['error', `联机: 服务端内部错误，错误编号 ${ERROR_ID}`]);
  });

  it('不在对局中时服务端以 1011 断开：回到多人游戏页，提示服务器出现问题', () => {
    net.createRoom(0, 15, 0, true, 30);
    pump();
    lastSocket().cut(CLOSE_CODE.internal);
    pump();
    expect(net.st.phase).toBe(net.Phase.Off);
    expect(net.st.error).toEqual(['服务器出现问题，请稍后再试']);
  });

  it('正常关闭、非法 UTF-8、消息过大时不再重连；后两种说明本端有缺陷，写 error 日志', () => {
    for (const code of [CLOSE_CODE.normal, CLOSE_CODE.badUtf8, CLOSE_CODE.tooBig]) {
      const peer = startGame(0); // 不限时：推进时间时不会因超时结束对局
      advance(1, peer); // 先走一帧，客户端记下正在对局
      lastSocket().cut(code);
      pump();
      expect(secsToNextConnect(peer, 10), String(code)).toBe(-1);
      expect(net.st.phase, String(code)).toBe(net.Phase.Off);
      net.disconnect();
    }
    expect(logs.filter(([level]) => level === 'error').map(([, text]) => text)).toEqual([
      '联机: 连接被服务端以关闭码 1007 关闭，不再重连',
      '联机: 连接被服务端以关闭码 1009 关闭，不再重连',
    ]);
  });
});
