/**
 * 与服务器的连接（整改项 P2-12 自 client.ts 拆出）：本机匿名身份与昵称、建立连接与握手、发消息与连上之前的待发队列、
 * 收到消息的校验（API-016）、断线后按关闭码带抖动地退避重连（API-050）与给玩家看的断线原因、主动断开。
 */
import { now } from '../core/clock';
import { loginRejected, loginToken, onLoginChange } from '../app/account';
import { logError, logWarn } from '../app/native';
import { isInvalid, parseS2C } from '../shared/parse';
import { CLOSE_CODE, CONNECT_SECS, PING_SECS, PROTO_VERSION, RETRY_RESET_SECS, stampOf, type C2S, type C2SDraft, type S2C } from '../shared/protocol';
import { ONLINE_SERVER } from './config';
import { isFaultClose, retryWaitSecs } from './retry';
import { Phase, changed, note, st, type Msg } from './state';

let ws: WebSocket | null = null;
let pending: C2SDraft[] = []; // 连上之后要发的消息（还没编请求序号）

/** 校验通过的服务端消息交给谁处理：由 client.ts 登记，连接模块因此不必引用消息的处理（两者不互相引用） */
let handler: (m: S2C) => void = () => {};
/** 登记服务端消息的处理函数 */
export function setMessageHandler(fn: (m: S2C) => void) {
  handler = fn;
}
/** 取出并清空连上之前存着的消息 */
export function takePending(): C2SDraft[] {
  const out = pending;
  pending = [];
  return out;
}
/** 只留下待发消息中满足 keep 的 */
export function keepPending(keep: (m: C2SDraft) => boolean) {
  pending = pending.filter(keep);
}
/** 是否有连接（已连上或正在连） */
export const hasSocket = () => ws !== null;
/** 是否已连上、可以发消息 */
export const isOpen = () => ws !== null && ws.readyState === WebSocket.OPEN;

/** 联机服务器的地址：开发时可以 ?server= 改为本机服务端；账号接口的地址也由它推出 */
export function serverUrl() {
  const override = new URLSearchParams(location.search).get('server'); // 本机测试：?server=ws://127.0.0.1:8443
  return override || ONLINE_SERVER;
}

/** 毫秒与秒的换算 */
const MS_PER_SEC = 1000;

/**
 * 发一条消息；还没连上就先存着，连上后发出。改变对局状态的消息真正发出时才编上请求序号与所知的状态版本
 * （protocol-v4.md 第 7.2 条）：序号随连接从 1 开始，连上之前存着的消息不能先编
 */
export function send(m: C2SDraft) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(stampOf(m, () => ({ seq: ++st.seq, sv: st.sv }))));
  else {
    pending.push(m);
    connect();
  }
}

/** 关闭当前连接（没有时什么也不做）；之后的关闭事件不再触发断线处理 */
export function netClose() {
  const sock = ws;
  ws = null;
  if (sock) {
    try {
      sock.close();
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 被同一账号在别处接管（4002）或登录失效（4001）后为真：此后不自动重连，进入多人游戏页等自动的连接也不发起，
 * 直到玩家亲自操作（匹配、开房间、加入等经 send 连接）或换了登录；否则两处客户端会来回互相接管
 */
let halted = false;
/** 当前连接握手所用的登录令牌：登录变了（退出、换账号）时断开这条连接，不能以先前账号的身份继续发消息 */
let socketAuth: string | undefined;

/** 自动的连接（进入多人游戏页时）：被接管或登录失效之后不发起，提示原因 */
export function connectAuto() {
  if (halted) return;
  connect();
}

/** 在后台连上服务器（已连上或正在连时什么也不做）；这是玩家亲自操作的连接，解除被接管后的停止 */
export function connect() {
  halted = false;
  if (ws) return;
  st.error = null;
  if (!loginToken()) {
    // 联机须登录（protocol-v4.md 第 3 章）：没有登录时不连，多人游戏页显示登录门槛
    st.phase = Phase.Off;
    st.error = ['请先登录'];
    changed();
    return;
  }
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
    st.lastRecv = openedAt = now();
    const auth = loginToken();
    if (!auth) {
      netClose(); // 连接期间退出了登录
      return;
    }
    socketAuth = auth;
    st.seq = 0; // 新连接上的请求序号从 1 重新开始
    sock.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, auth, resume: st.reconnecting && st.token ? st.token : undefined } satisfies C2S));
    st.pingAt = now() + PING_SECS;
  };
  sock.onmessage = ev => {
    if (ws === sock) receive(ev.data);
  };
  sock.onclose = ev => {
    if (ws !== sock) return;
    clearTimeout(timer);
    ws = null;
    lost(ev.code);
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
  handler(m);
  changed();
}

/** 本次连接建立的时刻（没有建立时为 0），以及对局中连续重连的次数（API-050） */
let openedAt = 0,
  attempts = 0;
/** 重连间隔用的随机数；测试时换成固定的值，使重连时刻确定（TST-020） */
let random: () => number = Math.random;
export function setRetryRandom(fn: () => number) {
  random = fn;
}

/** 不再重连（离开联机、放弃这一局）：下一次断线从第 1 次重连算起 */
export function resetRetry() {
  openedAt = attempts = 0;
}

/** 记一次重连，返回这是第几次；刚断开的连接保持了 RETRY_RESET_SECS 以上时从头算起 */
function nextAttempt() {
  if (openedAt && now() - openedAt >= RETRY_RESET_SECS) attempts = 0;
  openedAt = 0;
  return ++attempts;
}

/** 不再重连时给玩家看的原因 */
function lostText(code?: number): Msg {
  if (code === CLOSE_CODE.version) return ['客户端版本与服务器不一致，请更新游戏'];
  if (code === CLOSE_CODE.authFailed) return ['登录已失效，请重新登录'];
  if (code === CLOSE_CODE.replaced) return ['账号已在别处登录'];
  if (code === CLOSE_CODE.policy) return ['操作过于频繁，请稍后再试'];
  if (code === CLOSE_CODE.internal) return ['服务器出现问题，请稍后再试'];
  return ['网络连接失败，请检查网络后重试'];
}

/**
 * 连接断了。code 为关闭码，连接建不起来或超时时没有。对局中按关闭码决定是否重连、多久后重连（retry.ts）；
 * 其余情况，以及不应重连的关闭码，回到大厅并提示
 */
export function lost(code?: number) {
  if (isFaultClose(code)) logError('联机', `连接被服务端以关闭码 ${code} 关闭，不再重连`);
  if (code === CLOSE_CODE.authFailed) loginRejected();
  if (code === CLOSE_CODE.authFailed || code === CLOSE_CODE.replaced) halted = true;
  const wait = st.phase === Phase.Playing && !st.over && st.token ? retryWaitSecs(code, nextAttempt(), random) : null;
  if (wait !== null) {
    if (!st.reconnecting) {
      st.reconnecting = true;
      st.lostAt = now();
      note(['连接中断，正在重连…']);
    }
    st.retryAt = now() + wait;
    changed();
    return;
  }
  const wasBusy = st.phase >= Phase.Queue || st.busy || pending.length > 0;
  st.phase = Phase.Off;
  st.reconnecting = false;
  st.busy = false;
  st.opp = null;
  pending = [];
  resetRetry();
  st.error = lostText(code);
  if (wasBusy) note(st.error);
  changed();
}

/** 登录变了（退出、换账号、令牌失效）：以先前登录握手的连接立即断开；新的登录解除被接管后的停止 */
function loginChanged() {
  if (loginToken() === socketAuth) return;
  socketAuth = undefined;
  halted = false;
  if (ws) disconnect();
}
onLoginChange(loginChanged);

export function disconnect() {
  netClose();
  pending = [];
  resetRetry();
  st.phase = Phase.Off;
  st.reconnecting = false;
  st.resumeBy = 0;
  st.token = '';
  st.busy = false;
  st.opp = null;
  changed();
}
