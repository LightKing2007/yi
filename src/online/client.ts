/**
 * 联机会话：匹配 / 排位队列、配对确认、好友房间，以及对局中的各种请求。
 * 连接服务器是自动的，界面上不出现“服务器”：进入多人游戏时在后台连上，回到开始菜单时断开。
 * 对局本身仍是本地的 game：服务端每确认一手（moved、undone……），这里就调用同一套规则照做，
 * 所以落子、提子、悔棋、点目的动画与单机完全一样。协议见 shared/protocol.ts。
 */
import { signal } from '@preact/signals';
import { now } from '../core/clock';
import { GameType } from '../core/types';
import { T, TF } from '../i18n';
import { sfx } from '../audio';
import { setSettings, settings } from '../app/settings';
import { game, screen, Screen, VERSION, boardView, session, uiTick } from '../app/state';
import { ONLINE_SERVER } from './config';
import { logWarn, native } from '../app/native';
import { isInvalid, parseS2C } from '../shared/parse';
import {
  CONNECT_SECS,
  GRACE_SECS,
  PING_SECS,
  PROTO_VERSION,
  SILENT_SECS,
  UID_PATTERN,
  cleanName,
  newRating,
  type Act,
  type AskKind,
  type C2S,
  type GameKind,
  type Opponent,
  type OverReason,
  type QueueMode,
  type Rating,
  type Ratings,
  type S2C,
} from '../shared/protocol';

export enum Phase {
  Off,
  Connecting,
  Lobby,
  Queue,
  Found,
  Hosting,
  Playing,
}

/** 一条待翻译的文字：[原文格式串, ...参数] */
export type Msg = [string, ...(string | number)[]];
export const tr = (m: Msg) => TF(m[0], ...m.slice(1));

/** 界面与联机状态有关的部分需要重绘时递增 */
export const netTick = signal(0);
const changed = () => {
  netTick.value++;
};

/** 对局状态变了：界面重绘 */
const bump = () => {
  uiTick.value++;
};

/**
 * 切换界面（离开对局时棋子飞回棋罐、清盘等由控制器负责）。由控制器在加载时注册（bindNavigation），
 * 联机模块因此不必引用控制器，两者不再互相引用。
 */
let goScreen: (s: Screen) => void = s => {
  screen.value = s;
};
export function bindNavigation(go: (s: Screen) => void) {
  goScreen = go;
}

export const st = {
  phase: Phase.Off,
  error: null as Msg | null, // 连接失败的原因（只在出错时显示）
  notice: [] as Msg[], // 最近一条提示，几段用“ · ”连起来
  noticeAt: -99,
  token: '',
  ratings: { gomoku: newRating(), go: newRating() } as Ratings,
  busy: false, // 开房间 / 加入房间的请求已发出，等回应
  // 匹配 / 排位
  qMode: 'match' as QueueMode,
  qType: 0,
  qSize: 19,
  qSince: 0, // 开始匹配的时刻（本地时钟；对方未确认而继续匹配时不重置）
  opp: null as Opponent | null, // 配对到的对手
  foundAt: 0,
  foundSecs: 15,
  accepted: false,
  oppAccepted: false,
  // 好友房间
  code: '',
  // 对局
  kind: 'match' as GameKind,
  myColor: 0,
  type: 0,
  size: 15,
  renju: false,
  moveTime: 0,
  players: [null, null, null] as (Opponent | null)[],
  toMove: 1,
  turnEnds: 0, // 本手限时截止（本地时钟），0 表示不限时
  askIn: null as AskKind | null, // 对方向我提出的申请
  askOut: null as AskKind | null, // 我提出、等对方回应的申请
  askInAt: 0,
  agreed: [false, false, false], // 点目时各方是否已确认
  over: false,
  winner: 0,
  overReason: '' as OverReason | '',
  rated: null as { delta: number; rating: Rating } | null, // 排位结束后的段位变化
  peerOnline: true,
  oppLeft: false,
  peerBackBy: 0,
  reconnecting: false,
  retryAt: 0,
  lostAt: 0,
  pingAt: 0,
  lastRecv: 0, // 最后一次收到服务端消息的时刻（判断连接是否已经静默断开）
  resumeBy: 0, // 重连后应在此刻之前收到对局（收不到说明原来的对局已经不在了）；0 表示不在等
  update: loadUpdate(), // 服务端告知的新版本（比本机新才有）
  leaveAsk: false, // 对局未结束时点“离开”：先确认
  shownOnline: false, // 对局界面显示的是联机对局（离开时面板淡出期间也保持）
};

/** 版本号比较：a 比 b 新 */
export function newerVersion(a: string, b: string) {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0),
    pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** 服务端告知过的新版本（存在本地，比当前版本新才算） */
function loadUpdate(): { version: string; url: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem('yi.update') ?? 'null');
    if (v && typeof v.version === 'string' && newerVersion(v.version, VERSION)) return { version: v.version, url: String(v.url ?? '') };
  } catch {
    /* 读不到就算了 */
  }
  return null;
}

function saveUpdate(latest: string | undefined, url: string | undefined) {
  st.update = latest && newerVersion(latest, VERSION) ? { version: latest, url: url ?? '' } : null;
  try {
    localStorage.setItem('yi.update', JSON.stringify(st.update));
  } catch {
    /* 忽略 */
  }
}

export function note(...parts: Msg[]) {
  st.notice = parts;
  st.noticeAt = now();
  changed();
}

export const inGame = () => st.phase === Phase.Playing;
export const myTurn = () => st.phase === Phase.Playing && !st.over && !game.scoring && st.toMove === st.myColor && !st.askIn && !st.askOut;
export const ratingOf = (type: number) => (type ? st.ratings.go : st.ratings.gomoku);

// ---------------- 连接 ----------------

let ws: WebSocket | null = null;
let pending: C2S[] = []; // 连上之后要发的消息

function serverUrl() {
  const q = new URLSearchParams(location.search).get('server'); // 本机测试：?server=ws://127.0.0.1:8443
  return q || ONLINE_SERVER;
}

/** 毫秒与秒的换算 */
const MS_PER_SEC = 1000;

/** 本机匿名身份的随机字节数（32 位十六进制） */
const UID_BYTES = 16;

/** 本机的匿名身份：第一次联机时生成并存在本地，段位跟着它走；本地的值不合格式时重新生成（服务端会拒绝它） */
function uid() {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(UID_BYTES)), v => v.toString(16).padStart(2, '0')).join('');
  try {
    let v = localStorage.getItem('yi.uid');
    if (!v || !UID_PATTERN.test(v)) {
      v = make();
      localStorage.setItem('yi.uid', v);
    }
    return v;
  } catch {
    return make();
  }
}

function nick() {
  let n = settings.value.nick.trim();
  if (!n) {
    n = T('棋手') + (100 + Math.floor(Math.random() * 900));
    setSettings({ nick: n });
  }
  return cleanName(n, T('棋手'));
}

/** 发一条消息；还没连上就先存着，连上后发出 */
function send(m: C2S) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else {
    pending.push(m);
    connect();
  }
}

function netClose() {
  const s = ws;
  ws = null;
  if (s) {
    try {
      s.close();
    } catch {
      /* 忽略 */
    }
  }
}

/** 在后台连上服务器（已连上或正在连时什么也不做） */
export function connect() {
  if (ws) return;
  st.error = null;
  if (st.phase === Phase.Off) st.phase = Phase.Connecting;
  let sock: WebSocket;
  try {
    sock = new WebSocket(serverUrl());
  } catch {
    lost();
    return;
  }
  ws = sock;
  badLogged = false;
  let opened = false;
  const timer = setTimeout(() => {
    if (ws === sock && !opened) {
      netClose();
      lost();
    }
  }, CONNECT_SECS * MS_PER_SEC);
  sock.onopen = () => {
    if (ws !== sock) return;
    opened = true;
    clearTimeout(timer);
    st.lastRecv = now();
    sock.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: nick(), uid: uid(), token: st.reconnecting ? st.token : undefined } satisfies C2S));
    st.pingAt = now() + PING_SECS;
  };
  sock.onmessage = ev => {
    if (ws === sock) receive(ev.data);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    clearTimeout(timer);
    ws = null;
    lost();
  };
  changed();
}

/** 每条连接只记第一条非法消息的日志，免得伪造的消息洪泛撑大日志 */
let badLogged = false;

/** 收到服务端的一帧：先经 parseS2C 校验（API-016），不合法的丢弃并写 warn 日志，严禁据此修改对局状态 */
function receive(data: unknown) {
  let raw: unknown;
  try {
    raw = typeof data === 'string' ? JSON.parse(data) : undefined;
  } catch {
    raw = undefined; // 不是 JSON：交给 parseS2C 按非法消息处理
  }
  const m = parseS2C(raw);
  if (isInvalid(m)) {
    if (!badLogged) logWarn('联机', `丢弃服务端的非法消息：${m.why}`);
    badLogged = true;
    return;
  }
  st.lastRecv = now();
  handle(m);
  changed();
}

/** 连接断了：对局中自动重连；匹配、等待中的回到大厅并提示 */
function lost() {
  if (st.phase === Phase.Playing && !st.over && st.token) {
    if (!st.reconnecting) {
      st.reconnecting = true;
      st.lostAt = now();
      note(['连接中断，正在重连…']);
    }
    st.retryAt = now() + 2;
    changed();
    return;
  }
  const wasBusy = st.phase >= Phase.Queue || st.busy || pending.length > 0;
  st.phase = Phase.Off;
  st.reconnecting = false;
  st.busy = false;
  st.opp = null;
  pending = [];
  st.error = ['网络连接失败，请检查网络后重试'];
  if (wasBusy) note(st.error);
  changed();
}

export function disconnect() {
  netClose();
  pending = [];
  st.phase = Phase.Off;
  st.reconnecting = false;
  st.resumeBy = 0;
  st.token = '';
  st.busy = false;
  st.opp = null;
  changed();
}

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

const WHY: Record<string, [string, string]> = {
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

function handle(m: S2C) {
  const t = now(),
    g = game;
  switch (m.t) {
    case 'welcome': {
      st.token = m.token;
      st.ratings = m.ratings;
      saveUpdate(m.latest, m.url);
      if (st.reconnecting) {
        // 随后应收到 start 与 sync；老版本服务端找不回对局时什么也不说，所以限时等
        st.reconnecting = false;
        st.resumeBy = t + 3;
        note(['已重新连上']);
      } else if (st.phase === Phase.Connecting) st.phase = Phase.Lobby;
      const out = pending;
      pending = [];
      for (const q of out) send(q);
      break;
    }
    case 'queued':
      st.phase = Phase.Queue;
      st.qMode = m.mode;
      st.qType = m.type;
      st.qSize = m.size;
      break;
    case 'found':
      st.phase = Phase.Found;
      st.opp = m.opp;
      st.foundAt = t;
      st.foundSecs = m.secs;
      st.accepted = false;
      st.oppAccepted = false;
      alertFound();
      break;
    case 'accepted':
      st.oppAccepted = true;
      break;
    case 'unmatched':
      st.opp = null;
      if (m.requeued) {
        st.phase = Phase.Queue;
        note([m.reason], ['继续为你寻找']);
      } else {
        if (st.phase === Phase.Found && !st.accepted) note(['没有及时确认，已退出匹配']);
        st.phase = Phase.Lobby;
      }
      break;
    case 'created':
      st.code = m.code;
      st.phase = Phase.Hosting;
      st.busy = false;
      break;
    case 'joinNo':
      st.busy = false;
      note([m.reason]);
      break;
    case 'start':
      st.resumeBy = 0;
      onStart(m);
      break;
    case 'resumeFailed':
      resumeFailed();
      break;
    case 'sync':
      replay(m.acts);
      bump();
      break;
    case 'moved':
      g.play(m.x, m.y);
      boardView.msg = null;
      bump();
      break;
    case 'passed':
      g.pass();
      st.agreed = [false, false, false];
      bump();
      break;
    case 'turn':
      st.toMove = m.color;
      st.turnEnds = m.secs >= 0 ? t + m.secs : 0;
      break;
    case 'ask':
      st.askIn = m.kind;
      st.askInAt = t;
      st.turnEnds = 0;
      break; // 等回应时服务端暂停计时，回应后会重新发 turn
    case 'answer':
      st.askOut = null;
      note([ANSWER[m.kind]?.[m.ok ? 0 : 1] ?? '']);
      break;
    case 'undone':
      for (let i = 0; i < m.n; i++) g.undo();
      st.askIn = null;
      bump();
      break;
    case 'marked':
      g.toggleDead(m.x, m.y);
      st.agreed = [false, false, false];
      bump();
      break;
    case 'agreed':
      if (m.color === 1 || m.color === 2) st.agreed[m.color] = true;
      break;
    case 'resumed':
      g.resume();
      st.agreed = [false, false, false];
      bump();
      break;
    case 'over':
      applyOver(m.winner, m.reason);
      break;
    case 'rated':
      st.rated = { delta: m.delta, rating: m.rating };
      if (m.type) st.ratings.go = m.rating;
      else st.ratings.gomoku = m.rating;
      break;
    case 'peer':
      st.peerOnline = m.online;
      st.peerBackBy = m.wait ? t + m.wait : 0;
      note([m.online ? '对方回来了' : '对方掉线了，正在等待重连']);
      break;
    case 'left':
      st.oppLeft = true;
      st.askIn = st.askOut = null;
      note(['对方已离开房间']);
      break;
    case 'info':
      note([m.text]);
      st.askOut = null;
      break; // info 只在请求被拒时出现：申请没发出去
    case 'error':
      note([m.text]);
      st.busy = false;
      if (st.phase >= Phase.Queue && st.phase < Phase.Playing) st.phase = Phase.Lobby;
      break;
  }
}

// ---------------- 每帧 ----------------

let wasInGame = false,
  lastHalf = 0;

export function update(t: number) {
  if (st.reconnecting && !ws) {
    if (t - st.lostAt > GRACE_SECS) {
      // 等太久了，放弃这一局
      st.reconnecting = false;
      st.phase = Phase.Off;
      st.error = ['网络连接失败，请检查网络后重试'];
      if (!st.over) applyOver(3 - st.myColor, 'disconnect');
    } else if (t >= st.retryAt) {
      st.retryAt = t + 2;
      connect();
    }
  }
  if (ws && ws.readyState === WebSocket.OPEN && t >= st.pingAt) {
    send({ t: 'ping' });
    st.pingAt = t + PING_SECS;
  }
  // 很久没收到服务端的任何消息（连心跳回应都没有）：连接多半已经静默断开，主动关掉，对局中会自动重连
  if (ws && ws.readyState === WebSocket.OPEN && st.lastRecv && t - st.lastRecv > SILENT_SECS) {
    netClose();
    lost();
  }
  if (st.resumeBy && t > st.resumeBy) resumeFailed();
  // 确认超时（服务端也会判，这里只是保证界面不会停在“找到对手”）
  if (st.phase === Phase.Found && t - st.foundAt > st.foundSecs + 3) {
    st.phase = Phase.Lobby;
    st.opp = null;
    changed();
  }
  // 联机对局中连接彻底断了：回到多人游戏页
  if (wasInGame && !inGame() && screen.value === Screen.Game) {
    if (!st.notice.length || t - st.noticeAt > 4) note(st.error ?? ['连接已断开']);
    goScreen(Screen.Online);
  }
  wasInGame = inGame();
  // 倒计时、提示淡出：多人游戏的界面每半秒重绘一次
  const half = Math.floor(t * 2);
  if (half !== lastHalf && (screen.value === Screen.Online || inGame())) {
    lastHalf = half;
    changed();
  }
}

// 页面在后台时 requestAnimationFrame 会停下：心跳、重连另用定时器驱动
setInterval(() => update(now()), 250);

// ---------------- 匹配、排位、好友房间 ----------------

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
  pending = pending.filter(m => m.t !== 'queue' && m.t !== 'name');
  if (ws && ws.readyState === WebSocket.OPEN) send({ t: 'unqueue' });
  st.phase = ws ? Phase.Lobby : Phase.Off;
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

export function createRoom(type: number, size: number, hostColor: number, renju: boolean, moveTime: number) {
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
  if (ws && ws.readyState === WebSocket.OPEN) send({ t: 'leave' });
  st.phase = ws ? Phase.Lobby : Phase.Off;
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
