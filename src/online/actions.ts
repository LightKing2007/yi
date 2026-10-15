/**
 * 玩家的操作（整改项 P2-12 自 client.ts 拆出）：开始与取消匹配、排位，配对确认，开房间、关房间、凭房号加入，
 * 以及对局中的落子、停一手、申请与回应、认输、点目、再来一局、离开。只把请求发给服务端，结果以服务端的回应为准。
 */
import { now } from '../core/clock';
import { GameType } from '../core/types';
import { game, Screen } from '../app/state';
import type { C2S, QueueMode } from '../shared/protocol';
import { Phase, changed, goScreen, inGame, myTurn, st } from './state';
import { hasSocket, isOpen, keepPending, nick, send } from './connection';

/** 开始匹配 / 排位（没连上时先显示“正在寻找”，连上后自动进入队列） */
export function queue(mode: QueueMode, type: number, size: number) {
  st.qMode = mode;
  st.qType = type;
  st.qSize = size;
  st.qSince = now();
  send({ t: 'name', name: nick() });
  send({ t: 'queue', mode, type, size });
  st.phase = Phase.Queue;
  changed();
}

export function unqueue() {
  keepPending(m => m.t !== 'queue' && m.t !== 'name');
  if (isOpen()) send({ t: 'unqueue' });
  st.phase = hasSocket() ? Phase.Lobby : Phase.Off;
  changed();
}

/** 找到对手后：接受 / 拒绝 */
export function confirm(ok: boolean) {
  if (st.phase !== Phase.Found) return;
  send({ t: 'confirm', ok });
  if (ok) st.accepted = true;
  else {
    st.phase = Phase.Lobby;
    st.opp = null;
  }
  changed();
}

/** 开好友房间：棋类、路数、房主执子（0 黑 1 白 2 随机）、禁手、每步限时（秒，0 表示不限时），与协议的 create 消息同形 */
export function createRoom({ type, size, hostColor, renju, moveTime }: Omit<Extract<C2S, { t: 'create' }>, 't'>) {
  st.busy = true;
  send({ t: 'name', name: nick() });
  send({ t: 'create', type, size, hostColor, renju, moveTime });
  changed();
}

export function closeRoom() {
  send({ t: 'close' });
  st.phase = Phase.Lobby;
  st.code = '';
  changed();
}

export function joinRoom(code: string) {
  st.busy = true;
  send({ t: 'name', name: nick() });
  send({ t: 'join', code });
  changed();
}

// ---------------- 对局中 ----------------

export function move(x: number, y: number) {
  if (myTurn()) send({ t: 'move', x, y });
}
export function pass() {
  if (myTurn() && game.type === GameType.Go) send({ t: 'pass' });
}
export function undo() {
  if (inGame() && !st.over && !st.askOut && !st.askIn && game.hist.length) {
    send({ t: 'undo' });
    st.askOut = 'undo';
    st.turnEnds = 0;
    changed();
  }
}
export function draw() {
  if (inGame() && !st.over && !st.askOut && !st.askIn) {
    send({ t: 'draw' });
    st.askOut = 'draw';
    st.turnEnds = 0;
    changed();
  }
}
export function resign() {
  if (inGame() && !st.over) send({ t: 'resign' });
}
export function mark(x: number, y: number) {
  if (game.scoring) send({ t: 'mark', x, y });
}
export function agree() {
  if (game.scoring) send({ t: 'agree' });
}
export function resume() {
  if (game.scoring) send({ t: 'resume' });
}
export function rematch() {
  if (st.over && !st.oppLeft && !st.askOut && st.kind !== 'ranked') {
    send({ t: 'rematch' });
    st.askOut = 'rematch';
    changed();
  }
}

/** 回应对方的申请（悔棋 / 求和 / 再来一局） */
export function reply(ok: boolean) {
  const k = st.askIn;
  st.askIn = null;
  if (k) send({ t: 'reply', kind: k, ok });
  changed();
}

/** 离开房间；对局中离开即认输 */
export function leave() {
  if (isOpen()) send({ t: 'leave' });
  st.phase = hasSocket() ? Phase.Lobby : Phase.Off;
  st.reconnecting = false;
  st.askIn = st.askOut = null;
  st.leaveAsk = false;
  changed();
}

/** 终局后接着匹配 / 排位同样的棋 */
export function playAgain() {
  const mode: QueueMode = st.kind === 'ranked' ? 'ranked' : 'match',
    type = st.type,
    size = st.size;
  leave();
  goScreen(Screen.Online);
  queue(mode, type, size);
}

export function askLeave() {
  if (st.over || st.phase !== Phase.Playing) {
    leave();
    goScreen(Screen.Online);
  } else {
    st.leaveAsk = true;
    changed();
  }
}
