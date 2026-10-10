/**
 * 联机客户端（src/online/client.ts）的状态机：用假的 WebSocket 把它直接接到进程内的 RoomServer 上（假时钟，替身见 fakeNet.ts），
 * 模拟网络静默断开（服务端还没发现）、服务器重启、网络完全不通、断线期间对局结束等情况，
 * 以及冒充服务端发来的非法消息（API-016）。断线重连的退避与关闭码见 reconnect.test.ts
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomServer } from '../server/rooms';
import { CONFIRM_SECS } from '../src/shared/protocol';
import { Peer, advance, fake, inject, lastSocket, loadClient, newServer, pump, resetNet, startGame, storage, warns, type Client, type State } from './fakeNet';

let net: Client, state: State;
beforeAll(async () => ({ net, state } = await loadClient()));
beforeEach(resetNet);

describe('联机客户端', () => {
  it('网络静默断开（服务端还没发现）：客户端察觉后自动重连，回到原来的对局', () => {
    const peer = startGame();
    net.move(7, 7);
    pump();
    expect(state.game.cur.moves).toBe(1);
    lastSocket().dead = true; // 网络悄悄断了
    advance(24, peer);
    expect(net.st.reconnecting).toBe(false); // 还没到判定时间
    advance(6, peer); // 25 秒没有任何消息：主动断开并重连
    expect(net.st.reconnecting).toBe(false);
    expect(net.st.phase).toBe(net.Phase.Playing);
    expect(peer.inbox.some(m => m.t === 'peer' && m.online)).toBe(true);
    expect(state.game.cur.moves).toBe(1);
    peer.send({ t: 'move', x: 8, y: 8 });
    expect(state.game.cur.moves).toBe(2);
    expect(net.myTurn()).toBe(true);
  });

  it('服务器重启：重连后得知对局已不在，退出对局并提示', () => {
    startGame();
    state.screen.value = state.Screen.Game;
    const old = lastSocket();
    fake.server = newServer(); // 重启：旧连接全部断开
    old.fail();
    pump();
    expect(net.st.reconnecting).toBe(true);
    advance(3);
    expect(net.st.phase).toBe(net.Phase.Lobby);
    expect(net.st.notice[0]?.[0]).toBe('这一局已经无法继续，可能是服务器重启过或掉线太久');
    expect(state.screen.value).toBe(state.Screen.Online);
  });

  it('老版本服务端不会说对局已不在：重连后等不到对局也会退出', () => {
    startGame();
    fake.dropTypes = ['resumeFailed'];
    const old = lastSocket();
    fake.server = newServer();
    old.fail();
    advance(3);
    expect(net.st.phase).toBe(net.Phase.Playing); // 刚连上，还在等
    advance(4);
    expect(net.st.phase).toBe(net.Phase.Lobby);
  });

  it('断线期间对方认输：重连后看到结果', () => {
    const peer = startGame();
    lastSocket().cut(); // 网络断开，两端都察觉到
    pump();
    expect(net.st.reconnecting).toBe(true);
    peer.send({ t: 'resign' });
    advance(3, peer);
    expect(net.st.over).toBe(true);
    expect(net.st.winner).toBe(1);
    expect(net.st.overReason).toBe('resign');
  });

  it('网络一直不通：宽限期过后判负，提示是自己掉线', () => {
    startGame();
    fake.netDown = true;
    lastSocket().cut();
    pump();
    advance(62);
    expect(net.st.over).toBe(true);
    expect(net.st.winner).toBe(2);
    expect(net.st.notice.map(m => m[0])).toContain('你掉线太久，对局已判负');
  });

  it('收到伪造的悔棋十亿次、路数越界的开局、非 JSON 与二进制帧时一律丢弃，局面不变，只记一条 warn 日志（A-05、API-016）', () => {
    const peer = startGame();
    net.move(7, 7);
    pump();
    expect(state.game.cur.moves).toBe(1);
    inject({ t: 'undone', n: 1e9 });
    inject({ t: 'start', kind: 'friend', color: 2, type: 0, size: 99, renju: true, moveTime: 30, black: { name: '甲' }, white: { name: '乙' } });
    inject({ t: 'moved', x: 19, y: 0 });
    inject('不是 JSON');
    inject(new ArrayBuffer(4));
    expect(state.game.cur.moves).toBe(1);
    expect([net.st.size, net.st.myColor, net.st.phase]).toEqual([15, 1, net.Phase.Playing]);
    expect(warns()).toEqual(['联机: 丢弃服务端的非法消息：undone.n 不合法：1000000000']);
    peer.send({ t: 'move', x: 8, y: 8 }); // 服务端的合法消息照常处理
    pump();
    expect(state.game.cur.moves).toBe(2);
  });

  it('每条连接只记第一条非法消息的日志，新的连接重新记', () => {
    net.connect();
    pump();
    inject({ t: 'shout' });
    inject({ t: 'shout' });
    expect(warns()).toHaveLength(1);
    net.disconnect();
    net.connect();
    pump();
    const notice = net.st.notice;
    inject({ t: 'info', text: '字'.repeat(10000) });
    expect(warns()).toEqual([
      '联机: 丢弃服务端的非法消息：未知的消息类型 "shout"',
      '联机: 丢弃服务端的非法消息：info.text 不合法："' + '字'.repeat(39), // 日志中的取值截到 40 个字符
    ]);
    expect(net.st.notice).toBe(notice); // 超长的提示没有显示
  });

  it('找到对手后没有确认，服务端的作罢消息又丢了：确认时限过后 3 秒，界面也回到大厅', () => {
    net.queue('match', 0, 15);
    pump();
    const peer = new Peer();
    peer.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(net.st.phase).toBe(net.Phase.Found);
    fake.dropTypes = ['unmatched'];
    advance(CONFIRM_SECS + 3, peer);
    expect(net.st.phase).toBe(net.Phase.Found);
    advance(1, peer);
    expect(net.st.phase).toBe(net.Phase.Lobby);
    expect(net.st.opp).toBeNull();
  });

  it('多人游戏页每半秒重绘一次（倒计时、提示淡出），同一个半秒内不重复；其他界面不重绘', () => {
    state.screen.value = state.Screen.Menu;
    net.update(fake.now); // 先走一帧，清掉上一个测试留下的状态
    const before = net.netTick.value;
    net.update(fake.now + 0.5);
    expect(net.netTick.value).toBe(before);
    state.screen.value = state.Screen.Online;
    net.update(fake.now + 1);
    net.update(fake.now + 1.2);
    expect(net.netTick.value).toBe(before + 1);
    net.update(fake.now + 1.5);
    expect(net.netTick.value).toBe(before + 2);
  });

  it('服务端告知新版本：比本机新才提示，并记在本地', () => {
    fake.server = new RoomServer({ now: () => fake.now, latest: '99.0.0', download: 'https://example.com/yi' });
    net.connect();
    pump();
    expect(net.st.update).toEqual({ version: '99.0.0', url: 'https://example.com/yi' });
    expect(JSON.parse(storage.get('yi.update') ?? 'null')?.version).toBe('99.0.0');
    net.disconnect();
    fake.server = new RoomServer({ now: () => fake.now, latest: '0.0.1' });
    net.connect();
    pump();
    expect(net.st.update).toBeNull();
    expect(net.newerVersion('2.0.10', '2.0.9')).toBe(true);
    expect(net.newerVersion('2.0.1', '2.0.1')).toBe(false);
  });
});
