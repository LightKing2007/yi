/**
 * 联机客户端（src/online/client.ts）在对局中的处理：悔棋、求和、认输、五子连珠、再来一局、排位结算、离开对局、
 * 围棋的停着与点目、重连后的整局回放，以及对方掉线与回来。客户端经假 WebSocket 接到进程内的 RoomServer 上（替身见 fakeNet.ts）
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GRACE_SECS } from '../src/shared/protocol';
import { Peer, advance, fake, lastSocket, loadClient, pump, resetNet, startGame, type Client, type State } from './fakeNet';

let net: Client, state: State;
/** 客户端切换过的界面 */
const navs: number[] = [];
beforeAll(async () => {
  ({ net, state } = await loadClient());
  net.bindNavigation(to => {
    navs.push(to);
    state.screen.value = to;
  });
});
beforeEach(() => {
  resetNet();
  navs.length = 0;
});

const notices = () => net.st.notice.map(m => m[0]);

/** 局面的快照：手数、棋盘、死子标记、是否在点目 */
const snapshot = () => ({
  moves: state.game.cur.moves,
  board: Array.from(state.game.cur.b),
  dead: Array.from(state.game.dead),
  scoring: state.game.scoring,
});

/** 网络断开后重连：重连后回放出的局面应与断开前一致 */
function expectReplayMatches(peer: Peer) {
  const before = snapshot();
  lastSocket().cut();
  pump();
  advance(3, peer);
  expect(net.st.reconnecting).toBe(false);
  expect(snapshot()).toEqual(before);
}

/** 双方各下一手：客户端（黑）先，peer（白）后 */
function exchange(peer: Peer, mine: [number, number], theirs: [number, number]) {
  net.move(...mine);
  pump();
  peer.send({ t: 'move', x: theirs[0], y: theirs[1] });
}

/** 客户端开 9 路围棋的好友房间（执黑、不限时），peer 加入 */
function startGo() {
  net.createRoom(1, 9, 0, false, 0);
  pump();
  const peer = new Peer();
  peer.send({ t: 'join', code: net.st.code });
  expect([net.st.phase, net.st.type, net.st.myColor]).toEqual([net.Phase.Playing, 1, 1]);
  return peer;
}

describe('悔棋与求和', () => {
  it('申请悔棋：等对方回应时不计时；对方同意后连对方应的一手一起退回，并提示', () => {
    const peer = startGame();
    exchange(peer, [7, 7], [8, 8]);
    expect(net.st.turnEnds).toBeGreaterThan(fake.now);
    net.undo();
    expect([net.st.askOut, net.st.turnEnds]).toEqual(['undo', 0]);
    pump();
    peer.send({ t: 'reply', kind: 'undo', ok: true });
    expect(state.game.cur.moves).toBe(0);
    expect(net.st.askOut).toBeNull();
    expect(notices()).toEqual(['对方同意了你的悔棋申请']);
  });

  it('对方申请悔棋：显示申请，暂停本手计时；拒绝后对方收到回应', () => {
    const peer = startGame();
    exchange(peer, [7, 7], [8, 8]);
    peer.send({ t: 'undo' });
    expect([net.st.askIn, net.st.askInAt, net.st.turnEnds]).toEqual(['undo', fake.now, 0]);
    expect(net.myTurn()).toBe(false);
    net.reply(false);
    pump();
    expect(net.st.askIn).toBeNull();
    expect(peer.last('answer')).toEqual({ t: 'answer', kind: 'undo', ok: false });
    expect(state.game.cur.moves).toBe(2);
  });

  it('求和：对方拒绝时提示；再次申请对方同意即和棋', () => {
    const peer = startGame();
    net.draw();
    pump();
    peer.send({ t: 'reply', kind: 'draw', ok: false });
    expect(notices()).toEqual(['对方拒绝了你的和棋申请']);
    net.draw();
    pump();
    peer.send({ t: 'reply', kind: 'draw', ok: true });
    expect([net.st.over, net.st.winner, net.st.overReason]).toEqual([true, 3, 'draw']);
    expect(notices()).toEqual(['和棋', '双方同意和棋']);
  });

  it('求和次数用完：显示服务端的提示，申请状态复原', () => {
    const peer = startGame();
    for (let i = 0; i < 3; i++) {
      net.draw();
      pump();
      peer.send({ t: 'reply', kind: 'draw', ok: false });
    }
    net.draw();
    pump();
    expect(net.st.askOut).toBeNull();
    expect(notices()).toEqual(['本局求和次数已用完']);
  });
});

describe('终局', () => {
  it('五子连珠：判胜并提示', () => {
    const peer = startGame(0);
    for (let i = 0; i < 4; i++) exchange(peer, [7, 7 + i], [0, i]);
    net.move(7, 11);
    pump();
    expect([net.st.over, net.st.winner, net.st.overReason]).toEqual([true, 1, 'five']);
    expect(notices()).toEqual(['你赢了', '五子连珠']);
  });

  it('认输：判负并提示；对方离开房间后不能再申请再来一局', () => {
    const peer = startGame();
    net.resign();
    pump();
    expect([net.st.over, net.st.winner, net.st.overReason]).toEqual([true, 2, 'resign']);
    expect(notices()).toEqual(['你输了', '你认输了']);
    peer.send({ t: 'leave' });
    expect(net.st.oppLeft).toBe(true);
    expect(notices()).toEqual(['对方已离开房间']);
    net.rematch();
    expect(net.st.askOut).toBeNull();
  });

  it('再来一局：对方同意后交换先后手，重新开局', () => {
    const peer = startGame();
    net.move(7, 7);
    net.resign();
    pump();
    net.rematch();
    expect(net.st.askOut).toBe('rematch');
    pump();
    peer.send({ t: 'reply', kind: 'rematch', ok: true });
    expect([net.st.phase, net.st.over, net.st.myColor, state.game.cur.moves]).toEqual([net.Phase.Playing, false, 2, 0]);
  });

  it('终局后接着匹配：离开房间，回到多人游戏页，以同样的棋类进入匹配队列', () => {
    startGame();
    net.resign();
    pump();
    net.playAgain();
    pump();
    expect([net.st.phase, net.st.qMode, net.st.qType, net.st.qSize]).toEqual([net.Phase.Queue, 'match', 0, 15]);
    expect(navs).toContain(state.Screen.Online);
  });

  it('排位结束：显示段位变化，并更新自己的段位分', () => {
    net.queue('ranked', 0, 15);
    pump();
    const peer = new Peer();
    peer.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    peer.send({ t: 'confirm', ok: true });
    net.confirm(true);
    pump();
    peer.send({ t: 'resign' });
    expect(net.st.rated?.delta).toBeGreaterThan(0);
    expect(net.st.ratings.gomoku).toEqual(net.st.rated?.rating);
    net.rematch(); // 排位赛不能再来一局：客户端不发出申请
    expect(net.st.askOut).toBeNull();
  });
});

describe('离开对局', () => {
  it('对局未结束时点离开：先确认，Esc 取消确认', () => {
    startGame();
    net.online.askLeave();
    expect(net.st.leaveAsk).toBe(true);
    expect(net.online.handleEscape(state.Screen.Game)).toBe(true);
    expect(net.st.leaveAsk).toBe(false);
  });

  it('确认离开：按离开判负，回到大厅', () => {
    const peer = startGame();
    net.online.askLeave();
    net.leave();
    pump();
    expect([net.st.phase, net.st.leaveAsk]).toEqual([net.Phase.Lobby, false]);
    expect(peer.last('over')).toEqual({ t: 'over', winner: 2, reason: 'left' });
  });

  it('对局已结束时点离开：不再确认，直接回到多人游戏页', () => {
    startGame();
    net.resign();
    pump();
    net.online.askLeave();
    expect([net.st.phase, net.st.leaveAsk]).toEqual([net.Phase.Lobby, false]);
    expect(navs).toEqual([state.Screen.Online]);
  });
});

describe('围棋的停着与点目', () => {
  it('双方停着进入点目；标记死子后双方的确认作废；双方都确认后按点目结束', () => {
    const peer = startGo();
    exchange(peer, [2, 2], [6, 6]);
    net.online.pass();
    pump();
    peer.send({ t: 'pass' });
    expect(state.game.scoring).toBe(true);
    peer.send({ t: 'agree' });
    expect(net.st.agreed).toEqual([false, false, true]);
    net.online.mark(6, 6);
    pump();
    expect(net.st.agreed).toEqual([false, false, false]);
    net.agree();
    pump();
    peer.send({ t: 'agree' });
    expect([net.st.over, net.st.winner, net.st.overReason]).toEqual([true, 1, 'score']);
    expect(notices()).toEqual(['你赢了', '点目结束']);
  });

  it('点目有分歧：恢复对局', () => {
    const peer = startGo();
    net.online.pass();
    pump();
    peer.send({ t: 'pass' });
    net.resume();
    pump();
    expect(state.game.scoring).toBe(false);
  });

  it('重连后回放整局：落子、悔棋、停着与标记死子后的局面，以及恢复对局后的局面，都与断线前一致', () => {
    const peer = startGo();
    exchange(peer, [2, 2], [6, 6]);
    exchange(peer, [3, 3], [5, 5]);
    peer.send({ t: 'undo' }); // 退掉对方的 (5, 5)，又轮到对方
    net.reply(true);
    pump();
    peer.send({ t: 'move', x: 5, y: 4 });
    net.online.pass();
    pump();
    peer.send({ t: 'pass' });
    net.online.mark(6, 6);
    pump();
    expect(state.game.dead.some(mark => mark > 0)).toBe(true);
    expectReplayMatches(peer); // 点目中：死子标记也要一致
    net.resume();
    pump();
    expect(state.game.scoring).toBe(false);
    expectReplayMatches(peer);
  });
});

describe('对方掉线与回来', () => {
  it('对方掉线：提示并显示等待时限；对方带令牌回来后提示', () => {
    const peer = startGame();
    const token = peer.last('welcome')?.token;
    peer.drop();
    pump();
    expect([net.st.peerOnline, net.st.peerBackBy]).toEqual([false, fake.now + GRACE_SECS]);
    expect(notices()).toEqual(['对方掉线了，正在等待重连']);
    new Peer(fake.server, token);
    expect([net.st.peerOnline, net.st.peerBackBy]).toEqual([true, 0]);
    expect(notices()).toEqual(['对方回来了']);
  });
});
