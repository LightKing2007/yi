/**
 * 联机客户端（src/online/client.ts）在大厅中的状态机：匹配与排位的配对确认、取消匹配、好友房间的开、关与加入，
 * 以及 Esc 与界面切换时的处理。客户端经假 WebSocket 接到进程内的 RoomServer 上（替身见 fakeNet.ts）
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONFIRM_SECS } from '../src/shared/protocol';
import { Peer, advance, fake, loadClient, pump, resetNet, sockets, storage, type Client, type State } from './fakeNet';

let net: Client, state: State;
beforeAll(async () => ({ net, state } = await loadClient()));
beforeEach(resetNet);

/** 客户端与另一位棋手先后进入同一个匹配队列，配对成功（客户端还没确认） */
function matchUp(mode: 'match' | 'ranked' = 'match') {
  net.queue(mode, 0, 15);
  pump();
  expect(net.st.phase).toBe(net.Phase.Queue);
  const peer = new Peer();
  peer.send({ t: 'queue', mode, type: 0, size: 15 });
  expect(net.st.phase).toBe(net.Phase.Found);
  return peer;
}

describe('匹配：配对与确认', () => {
  it('配对成功后显示对手与确认时限；对方先确认时显示对方已接受；双方都确认即开局', () => {
    net.st.foundSecs = 0; // 先改掉默认值：确认时限应来自服务端
    const peer = matchUp();
    expect([net.st.qMode, net.st.qType, net.st.qSize]).toEqual(['match', 0, 15]);
    expect(net.st.opp).toEqual({ name: '乙' });
    expect(net.st.foundSecs).toBe(CONFIRM_SECS);
    peer.send({ t: 'confirm', ok: true });
    expect(net.st.oppAccepted).toBe(true);
    net.confirm(true);
    pump();
    expect(net.st.phase).toBe(net.Phase.Playing);
    expect(net.st.kind).toBe('match');
  });

  it('进入队列时以服务端按规则调整后的棋盘为准：匹配的五子棋固定 15 路，排位的围棋固定 19 路', () => {
    net.queue('match', 0, 19);
    pump();
    expect([net.st.qType, net.st.qSize]).toEqual([0, 15]);
    net.unqueue();
    net.queue('ranked', 1, 9);
    pump();
    expect([net.st.qMode, net.st.qType, net.st.qSize]).toEqual(['ranked', 1, 19]);
  });

  it('自己拒绝配对：回到大厅；对方被放回队列', () => {
    const peer = matchUp();
    net.confirm(false);
    pump();
    expect(net.st.phase).toBe(net.Phase.Lobby);
    expect(net.st.opp).toBeNull();
    expect(peer.last('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: '对方未接受' });
  });

  it('对方拒绝配对：自动继续匹配，并提示原因', () => {
    const peer = matchUp();
    fake.dropTypes = ['queued']; // 只凭“配对作罢”一条消息也要回到队列
    peer.send({ t: 'confirm', ok: false });
    expect(net.st.phase).toBe(net.Phase.Queue);
    expect(net.st.opp).toBeNull();
    expect(net.st.notice).toEqual([['对方未接受'], ['继续为你寻找']]);
  });

  it('自己没有及时确认：退出匹配，回到大厅并提示', () => {
    const peer = matchUp();
    peer.send({ t: 'confirm', ok: true });
    advance(CONFIRM_SECS + 1, peer);
    expect(net.st.phase).toBe(net.Phase.Lobby);
    expect(net.st.notice).toEqual([['没有及时确认，已退出匹配']]);
  });
});

describe('取消匹配与排位', () => {
  it('取消匹配：回到大厅，之后进入队列的人不会与自己配对', () => {
    net.queue('match', 0, 15);
    pump();
    net.unqueue();
    pump();
    expect(net.st.phase).toBe(net.Phase.Lobby);
    const peer = new Peer();
    peer.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(peer.last('queued')).toBeDefined();
    expect(peer.last('found')).toBeUndefined();
  });

  it('还没连上就取消匹配：连上以后也不会进入队列', () => {
    net.queue('match', 0, 15);
    net.unqueue();
    expect(net.st.phase).toBe(net.Phase.Lobby); // 正在连接
    pump();
    const peer = new Peer();
    peer.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(peer.last('found')).toBeUndefined();
  });

  it('排位：配对时显示对手的段位分', () => {
    matchUp('ranked');
    expect(net.st.opp).toEqual({ name: '乙', points: 1200 });
  });

  it('同一台设备已经在排位中：提示原因并回到大厅', () => {
    net.connect();
    pump();
    const twin = new Peer(fake.server, undefined, storage.get('yi.uid'));
    twin.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    net.queue('ranked', 0, 15);
    pump();
    expect(net.st.phase).toBe(net.Phase.Lobby);
    expect(net.st.notice).toEqual([['这台设备已经在排位中了']]);
  });
});

describe('好友房间', () => {
  it('开房间得到四位房号；关闭房间回到大厅，房号随即失效', () => {
    net.createRoom(0, 15, 0, true, 30);
    expect(net.st.busy).toBe(true);
    pump();
    const code = net.st.code;
    expect([net.st.phase, net.st.busy]).toEqual([net.Phase.Hosting, false]);
    expect(code).toMatch(/^\d{4}$/);
    net.closeRoom();
    pump();
    expect([net.st.phase, net.st.code]).toEqual([net.Phase.Lobby, '']);
    const peer = new Peer();
    peer.send({ t: 'join', code });
    expect(peer.last('joinNo')?.reason).toBe('房号不存在，或房间已经开始');
  });

  it('房号不存在：提示原因，可以再试', () => {
    net.joinRoom('0000');
    expect(net.st.busy).toBe(true);
    pump();
    expect(net.st.busy).toBe(false);
    expect(net.st.notice).toEqual([['房号不存在，或房间已经开始']]);
  });

  it('用房号加入好友的房间：开局，房主执黑时自己执白', () => {
    const host = new Peer();
    host.send({ t: 'create', type: 1, size: 9, hostColor: 0, renju: false, moveTime: 0 }); // hostColor 0：房主执黑
    net.joinRoom(host.last('created')?.code ?? '');
    pump();
    expect(net.st.phase).toBe(net.Phase.Playing);
    expect([net.st.kind, net.st.myColor, net.st.type, net.st.size, net.st.moveTime]).toEqual(['friend', 2, 1, 9, 0]);
    const start = host.last('start');
    expect(start?.black).toEqual({ name: '乙' });
    expect(net.st.players).toEqual([null, start?.black, start?.white]);
  });
});

describe('Esc 与界面切换', () => {
  it('Esc 依次处理：匹配中取消匹配，配对后拒绝，开房间后关闭房间；没有可处理的返回 false', () => {
    const { Screen } = state;
    net.queue('match', 0, 15);
    pump();
    expect(net.online.handleEscape(Screen.Online)).toBe(true);
    expect(net.st.phase).toBe(net.Phase.Lobby);
    matchUp();
    expect(net.online.handleEscape(Screen.Online)).toBe(true);
    expect(net.st.phase).toBe(net.Phase.Lobby);
    net.createRoom(0, 15, 0, true, 30);
    pump();
    expect(net.online.handleEscape(Screen.Online)).toBe(true);
    expect(net.st.phase).toBe(net.Phase.Lobby);
    expect(net.online.handleEscape(Screen.Online)).toBe(false);
    expect(net.online.handleEscape(Screen.Game)).toBe(false);
  });

  it('进入多人游戏页时在后台连上；回到开始菜单时断开；不在联机对局中进入对局界面时，界面按单机显示', () => {
    const { Screen } = state;
    net.online.onScreen(Screen.Menu, Screen.Online);
    pump();
    expect([sockets.length, net.st.phase]).toEqual([1, net.Phase.Lobby]);
    net.online.onScreen(Screen.Online, Screen.Menu);
    expect(net.st.phase).toBe(net.Phase.Off);
    net.st.shownOnline = true;
    net.online.onScreen(Screen.Menu, Screen.Game);
    expect(net.st.shownOnline).toBe(false);
  });
});
