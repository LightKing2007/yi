/**
 * 联机会话：匹配 / 排位队列、配对确认、好友房间，以及对局中的各种请求。
 * 连接服务器是自动的，界面上不出现“服务器”：进入多人游戏时在后台连上，回到开始菜单时断开。
 * 对局本身仍是本地的 game：服务端每确认一手（moved、undone……），这里就调用同一套规则照做，
 * 所以落子、提子、悔棋、点目的动画与单机完全一样。协议见 shared/protocol.ts。
 */
import { now } from '../core/clock';
import { GameType, other } from '../core/types';
import { T } from '../i18n';
import { sfx } from '../audio';
import { game, screen, Screen, boardView, session } from '../app/state';
import { logError, native } from '../app/native';
import { GRACE_SECS, PING_SECS, RESUME_WAIT_SECS, SILENT_SECS, type Act, type AskKind, type OverReason, type S2C } from '../shared/protocol';
import { Phase, bump, changed, goScreen, inGame, myTurn, note, saveUpdate, st } from './state';
import { connect, disconnect, hasSocket, isOpen, lost, netClose, resetRetry, send, setMessageHandler, takePending } from './connection';
import { askLeave, closeRoom, confirm, mark, move, pass, undo, unqueue } from './actions';

// 会话的状态已移到 state.ts（整改项 P2-12）；对外的部分仍从这里导出，引用方不必改动
export { Phase, bindNavigation, inGame, myTurn, netTick, newerVersion, note, ratingOf, st, tr, type Msg } from './state';

// 连接已移到 connection.ts（整改项 P2-12）：收到的消息经这里登记的 handle 处理，两个模块因此不互相引用
setMessageHandler(handle);
export { connect, disconnect, setRetryRandom } from './connection';

// 玩家的操作已移到 actions.ts（整改项 P2-12）
export {
  agree,
  askLeave,
  closeRoom,
  confirm,
  createRoom,
  draw,
  joinRoom,
  leave,
  mark,
  move,
  pass,
  playAgain,
  queue,
  rematch,
  reply,
  resign,
  resume,
  undo,
  unqueue,
} from './actions';

// ---------------- 对局中的消息 ----------------

/** 重放一整局（重连时）：不要逐手的动画与声音 */
function replay(acts: Act[]) {
  const g = game,
    mark = g.eventMark();
  for (const a of acts) {
    if (a.k === 'M') g.play(a.x, a.y);
    else if (a.k === 'P') g.pass();
    else if (a.k === 'U') for (let i = 0; i < a.n; i++) g.undo();
    else if (a.k === 'K') g.toggleDead(a.x, a.y);
    else if (a.k === 'R') g.resume();
  }
  boardView.settle();
  g.eventRewind(mark);
}

function onStart(m: Extract<S2C, { t: 'start' }>) {
  st.kind = m.kind;
  st.myColor = m.color;
  st.type = m.type;
  st.size = m.size;
  st.renju = m.renju;
  st.moveTime = m.moveTime;
  st.players = [null, m.black, m.white];
  st.phase = Phase.Playing;
  st.busy = false;
  st.opp = null;
  st.code = '';
  st.over = false;
  st.winner = 0;
  st.overReason = '';
  st.rated = null;
  st.askIn = st.askOut = null;
  st.agreed = [false, false, false];
  st.peerOnline = true;
  st.oppLeft = false;
  st.toMove = 1;
  st.turnEnds = 0;
  st.leaveAsk = false;
  st.shownOnline = true;
  game.newGame(m.type ? GameType.Go : GameType.Gomoku, m.size, { renju: m.type === 0 && m.renju });
  session.configure('online', { online: { mine: m.color, move, pass, canMove: myTurn } }); // 自己这一方的落子先发给服务端
  if (screen.value !== Screen.Game) goScreen(Screen.Game);
  bump();
}

const WHY: Record<string, [string, string]> & { five: [string, string] } = {
  resign: ['对方认输', '你认输了'],
  timeout: ['对方超时', '你超时了'],
  disconnect: ['对方掉线未归', '你掉线太久，对局已判负'],
  left: ['对方离开了对局', '你离开了对局'],
  draw: ['双方同意和棋', '双方同意和棋'],
  full: ['棋盘已满', '棋盘已满'],
  score: ['点目结束', '点目结束'],
  five: ['五子连珠', '五子连珠'],
};

function applyOver(winner: number, reason: OverReason) {
  st.over = true;
  st.winner = winner;
  st.askIn = st.askOut = null;
  st.turnEnds = 0;
  st.overReason = reason;
  st.leaveAsk = false;
  const g = game;
  if (reason === 'score') {
    if (g.scoring) {
      g.computeScore();
      g.confirmScore();
    }
  } else if (reason === 'five' || reason === 'full') {
    if (!g.over) {
      g.over = true;
      g.winner = winner;
    }
  } else g.forfeitEnd(winner); // 认输、超时、掉线、离开、和棋：也放终局动画
  const me = winner === 3 ? '和棋' : winner === st.myColor ? '你赢了' : '你输了';
  const why = WHY[reason] ?? WHY.five;
  note([me], [winner === st.myColor ? why[0] : why[1]]);
  bump();
}

const ANSWER: Record<AskKind, [string, string]> = {
  undo: ['对方同意了你的悔棋申请', '对方拒绝了你的悔棋申请'],
  draw: ['对方同意了你的和棋申请', '对方拒绝了你的和棋申请'],
  rematch: ['对方同意了你的再来一局申请', '对方拒绝了你的再来一局申请'],
};

/** 重连上了，但原来的对局已经不在了（服务器重启过，或者掉线太久被判负）：退出对局，回到多人游戏页 */
function resumeFailed() {
  st.resumeBy = 0;
  if (st.phase !== Phase.Playing) return;
  st.phase = Phase.Lobby;
  st.askIn = st.askOut = null;
  st.leaveAsk = false;
  st.turnEnds = 0;
  st.error = null;
  note(['这一局已经无法继续，可能是服务器重启过或掉线太久']);
}

/** 匹配成功：两声落子般的轻响；窗口不在前台时提醒一下 */
function alertFound() {
  sfx.clack(1);
  setTimeout(() => sfx.clack(0.8), 140);
  if (document.hidden) {
    const old = document.title;
    document.title = T('找到对手了');
    const back = () => {
      document.title = old;
      document.removeEventListener('visibilitychange', back);
    };
    document.addEventListener('visibilitychange', back);
  }
  native()?.attention();
}

/** 服务端的一类消息 */
type ServerMsg<K extends S2C['t']> = Extract<S2C, { t: K }>;
/** 一类消息的处理函数；time 为收到时的本地时钟 */
type Handler<K extends S2C['t']> = (m: ServerMsg<K>, time: number) => void;

/** 连上（或重连上）服务器：记下令牌与段位，发出连上之前存着的消息 */
function onWelcome(m: ServerMsg<'welcome'>, time: number) {
  st.token = m.token;
  st.ratings = m.ratings;
  saveUpdate(m.latest, m.url);
  if (st.reconnecting) {
    // 随后应收到 start 与 sync；老版本服务端找不回对局时什么也不说，所以限时等
    st.reconnecting = false;
    st.resumeBy = time + RESUME_WAIT_SECS;
    note(['已重新连上']);
  } else if (st.phase === Phase.Connecting) st.phase = Phase.Lobby;
  const out = takePending();
  for (const msg of out) send(msg);
}

/** 找到对手，等双方确认 */
function onFound(m: ServerMsg<'found'>, time: number) {
  st.phase = Phase.Found;
  st.opp = m.opp;
  st.foundAt = time;
  st.foundSecs = m.secs;
  st.accepted = false;
  st.oppAccepted = false;
  alertFound();
}

/** 这次配对作罢：已自动继续匹配时回到队列，否则回到大厅 */
function onUnmatched(m: ServerMsg<'unmatched'>) {
  st.opp = null;
  if (m.requeued) {
    st.phase = Phase.Queue;
    note([m.reason], ['继续为你寻找']);
    return;
  }
  if (st.phase === Phase.Found && !st.accepted) note(['没有及时确认，已退出匹配']);
  st.phase = Phase.Lobby;
}

/** 对局状态变了（落子、停着、点目……）：点目时双方的确认作废，界面重绘 */
function scoringChanged() {
  st.agreed = [false, false, false];
  bump();
}

/** 各类服务端消息的处理（消息已经 parseS2C 校验，API-016）。每类一项：协议新增消息而这里漏写时，类型检查不通过 */
const HANDLERS: { [K in S2C['t']]: Handler<K> } = {
  welcome: onWelcome,
  resumeFailed,
  pong: () => {},
  queued: m => {
    st.phase = Phase.Queue;
    st.qMode = m.mode;
    st.qType = m.type;
    st.qSize = m.size;
  },
  found: onFound,
  accepted: () => {
    st.oppAccepted = true;
  },
  unmatched: onUnmatched,
  created: m => {
    st.code = m.code;
    st.phase = Phase.Hosting;
    st.busy = false;
  },
  joinNo: m => {
    st.busy = false;
    note([m.reason]);
  },
  start: m => {
    st.resumeBy = 0;
    onStart(m);
  },
  sync: m => {
    replay(m.acts);
    bump();
  },
  moved: m => {
    game.play(m.x, m.y);
    boardView.msg = null;
    bump();
  },
  passed: () => {
    game.pass();
    scoringChanged();
  },
  turn: (m, time) => {
    st.toMove = m.color;
    st.turnEnds = m.secs >= 0 ? time + m.secs : 0;
  },
  // 等回应时服务端暂停计时，回应后会重新发 turn
  ask: (m, time) => {
    st.askIn = m.kind;
    st.askInAt = time;
    st.turnEnds = 0;
  },
  answer: m => {
    st.askOut = null;
    note([ANSWER[m.kind][m.ok ? 0 : 1]]);
  },
  undone: m => {
    for (let i = 0; i < m.n; i++) game.undo();
    st.askIn = null;
    bump();
  },
  marked: m => {
    game.toggleDead(m.x, m.y);
    scoringChanged();
  },
  agreed: m => {
    st.agreed[m.color] = true;
  },
  resumed: () => {
    game.resume();
    scoringChanged();
  },
  over: m => applyOver(m.winner, m.reason),
  rated: m => {
    st.rated = { delta: m.delta, rating: m.rating };
    if (m.type) st.ratings.go = m.rating;
    else st.ratings.gomoku = m.rating;
  },
  peer: (m, time) => {
    st.peerOnline = m.online;
    st.peerBackBy = m.wait ? time + m.wait : 0;
    note([m.online ? '对方回来了' : '对方掉线了，正在等待重连']);
  },
  left: () => {
    st.oppLeft = true;
    st.askIn = st.askOut = null;
    note(['对方已离开房间']);
  },
  // info 只在请求被拒时出现：申请没发出去
  info: m => {
    note([m.text]);
    st.askOut = null;
  },
  error: m => {
    // 服务端内部错误带错误编号：写入本机日志，玩家反馈问题时据此与服务端日志对照（API-023）
    if (m.errorId) logError('联机', `服务端内部错误，错误编号 ${m.errorId}`);
    note([m.text]);
    st.busy = false;
    if (st.phase >= Phase.Queue && st.phase < Phase.Playing) st.phase = Phase.Lobby;
  },
};

/** 按消息类型交给对应的处理函数 */
function handle(m: S2C) {
  // 表中 m.t 一项的处理函数接收的正是 t 为 m.t 的消息；TypeScript 无法把这种对应关系表达为类型，故在此统一放宽
  const fn = HANDLERS[m.t] as (msg: S2C, time: number) => void;
  fn(m, now());
}

// ---------------- 每帧 ----------------

let wasInGame = false,
  lastHalf = 0;

/** 每帧调用：重连、心跳、静默断开检测、各种限时，以及多人游戏界面的定时重绘 */
export function update(time: number) {
  retryTick(time);
  heartbeatTick(time);
  if (st.resumeBy && time > st.resumeBy) resumeFailed();
  foundTick(time);
  leftGameTick(time);
  redrawTick(time);
}

/** 对局中断线：到点就重连；超过对局保留期就放弃这一局 */
function retryTick(time: number) {
  if (!st.reconnecting || hasSocket()) return;
  if (time - st.lostAt <= GRACE_SECS) {
    if (time >= st.retryAt) connect();
    return;
  }
  st.reconnecting = false;
  st.phase = Phase.Off;
  st.error = ['网络连接失败，请检查网络后重试'];
  resetRetry();
  if (!st.over) applyOver(other(st.myColor), 'disconnect');
}

/** 按时发心跳；很久没收到服务端的任何消息（连心跳回应都没有）时，连接多半已经静默断开，主动关掉，对局中会自动重连 */
function heartbeatTick(time: number) {
  if (!isOpen()) return;
  if (time >= st.pingAt) {
    send({ t: 'ping' });
    st.pingAt = time + PING_SECS;
  }
  if (st.lastRecv && time - st.lastRecv > SILENT_SECS) {
    netClose();
    lost();
  }
}

/** 配对确认的时限过后多等几秒仍停在“找到对手”，就回到大厅（服务端也会判，这里只是保证界面不会停住） */
const FOUND_SLACK_SECS = 3;
function foundTick(time: number) {
  if (st.phase === Phase.Found && time - st.foundAt > st.foundSecs + FOUND_SLACK_SECS) {
    st.phase = Phase.Lobby;
    st.opp = null;
    changed();
  }
}

/** 最近一条提示在这么多秒内仍算新的：离开对局时不用断线提示覆盖它 */
const NOTICE_FRESH_SECS = 4;
/** 联机对局中连接彻底断了：回到多人游戏页 */
function leftGameTick(time: number) {
  if (wasInGame && !inGame() && screen.value === Screen.Game) {
    if (!st.notice.length || time - st.noticeAt > NOTICE_FRESH_SECS) note(st.error ?? ['连接已断开']);
    goScreen(Screen.Online);
  }
  wasInGame = inGame();
}

/** 倒计时、提示淡出：多人游戏的界面每半秒重绘一次 */
function redrawTick(time: number) {
  const half = Math.floor(time * 2);
  if (half !== lastHalf && (screen.value === Screen.Online || inGame())) {
    lastHalf = half;
    changed();
  }
}

/** 页面在后台时 requestAnimationFrame 会停下：心跳、重连另用这个间隔（毫秒）的定时器驱动 */
const TICK_MS = 250;
setInterval(() => update(now()), TICK_MS);

/** 控制器用的接口 */
export const online = {
  state: st,
  inGame,
  myTurn,
  move,
  mark,
  undo,
  pass,
  askLeave,
  /** Esc 时先处理联机里的一层（取消匹配、拒绝配对、关房间）；处理了返回 true */
  handleEscape(s: Screen) {
    if (s === Screen.Online && st.phase === Phase.Queue) {
      unqueue();
      return true;
    }
    if (s === Screen.Online && st.phase === Phase.Found) {
      confirm(false);
      return true;
    }
    if (s === Screen.Online && st.phase === Phase.Hosting) {
      closeRoom();
      return true;
    }
    if (s === Screen.Game && st.leaveAsk) {
      st.leaveAsk = false;
      changed();
      return true;
    }
    return false;
  },
  /** 进多人游戏页时在后台连上服务器；回到开始菜单时断开 */
  onScreen(_from: Screen, to: Screen) {
    if (to === Screen.Online) connect();
    if (to === Screen.Menu && !inGame()) disconnect();
    if (to === Screen.Game && !inGame()) st.shownOnline = false;
  },
  update,
};
