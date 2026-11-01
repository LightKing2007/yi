/**
 * 服务端消息的处理（整改项 P2-12 自 client.ts 拆出）：连上与重连、配对与房间、开局与重连时的整局回放、落子与申请、
 * 点目、终局与段位结算。消息都已经 parseS2C 校验（API-016），本地的对局照服务端确认的结果以同一套规则重做。
 */
import { now } from '../core/clock';
import { GameType } from '../core/types';
import { T } from '../i18n';
import { sfx } from '../audio';
import { game, screen, Screen, boardView, session } from '../app/state';
import { logError, native } from '../app/native';
import { DOWNLOAD_URL_PATTERN, DRAWN, RESUME_WAIT_SECS, VERSION_PATTERN, type Act, type AskKind, type OverReason, type S2C } from '../shared/protocol';
import { Phase, bump, goScreen, myTurn, note, saveUpdate, st } from './state';
import { send, takePending } from './connection';
import { move, pass } from './actions';
import { errorText } from './errorText';

/** 重放一整局（重连时）：不要逐手的动画与声音 */
function replay(acts: Act[]) {
  const g = game,
    mark = g.eventMark();
  for (const act of acts) {
    if (act.k === 'M') g.play(act.x, act.y);
    else if (act.k === 'P') g.pass();
    else if (act.k === 'U') for (let i = 0; i < act.n; i++) g.undo();
    else if (act.k === 'K') g.toggleDead(act.x, act.y);
    else if (act.k === 'R') g.resume();
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
  'limit-moves': ['本局已达到 1024 手的上限，按和棋结束', '本局已达到 1024 手的上限，按和棋结束'],
  'limit-acts': ['本局的动作记录已达到 4096 条的上限，按和棋结束', '本局的动作记录已达到 4096 条的上限，按和棋结束'],
};

/** 终局：记下胜负与原因，让本地的对局照此结束（点目定局、五连或下满、其余情况放终局动画），并提示结果与原因 */
export function applyOver(winner: number, reason: OverReason) {
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
  const me = winner === DRAWN ? '和棋' : winner === st.myColor ? '你赢了' : '你输了';
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
export function resumeFailed() {
  st.resumeBy = 0;
  if (st.phase !== Phase.Playing) return;
  st.phase = Phase.Lobby;
  st.askIn = st.askOut = null;
  st.leaveAsk = false;
  st.turnEnds = 0;
  st.error = null;
  note(['这一局已经无法继续，可能是服务器重启过或掉线太久']);
}

/** 匹配成功时的第二声轻响：比第一声轻，晚这么多毫秒 */
const FOUND_ECHO_VOLUME = 0.8;
const FOUND_ECHO_MS = 140;

/** 匹配成功：两声落子般的轻响；窗口不在前台时提醒一下 */
function alertFound() {
  sfx.clack(1);
  setTimeout(() => sfx.clack(FOUND_ECHO_VOLUME), FOUND_ECHO_MS);
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
    if (m.reason) note([errorText(m.reason)], ['继续为你寻找']);
    else note(['继续为你寻找']);
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
    note([errorText(m.code)]);
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
  notice: m => note([errorText(m.code)]),
  error: m => {
    // 服务端内部错误带错误编号：写入本机日志，玩家反馈问题时据此与服务端日志对照（API-023）
    if (m.errorId) logError('联机', `服务端内部错误，错误编号 ${m.errorId}`);
    const { latest, url } = m.params ?? {};
    // 新版本号与下载地址与 welcome 中的同样校验（只接受 http(s) 地址）
    if (
      m.code === 'proto.version-mismatch' &&
      typeof latest === 'string' &&
      typeof url === 'string' &&
      VERSION_PATTERN.test(latest) &&
      DOWNLOAD_URL_PATTERN.test(url)
    )
      saveUpdate(latest, url);
    note([errorText(m.code, m.params)]);
    st.busy = false;
    // 对局中（含终局后）的请求被拒：申请没发出去；匹配、等确认、等好友时回到大厅
    if (st.phase === Phase.Playing) {
      st.askOut = null;
      if (m.code === 'server.maintenance' && st.askIn === 'rematch') st.askIn = null; // 维护开始时服务端撤回了再来一局的申请
    } else if (st.phase >= Phase.Queue && st.phase < Phase.Playing) st.phase = Phase.Lobby;
  },
};

/** 按消息类型交给对应的处理函数 */
export function handle(m: S2C) {
  // 表中 m.t 一项的处理函数接收的正是 t 为 m.t 的消息；TypeScript 无法把这种对应关系表达为类型，故在此统一放宽
  const fn = HANDLERS[m.t] as (msg: S2C, time: number) => void;
  fn(m, now());
}
