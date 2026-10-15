/**
 * 与服务器的连接（整改项 P2-12 自 client.ts 拆出）：本机匿名身份与昵称、建立连接与握手、发消息与连上之前的待发队列、
 * 收到消息的校验（API-016）、断线后按关闭码带抖动地退避重连（API-050）与给玩家看的断线原因、主动断开。
 */
import { now } from '../core/clock';
import { T } from '../i18n';
import { setSettings, settings } from '../app/settings';
import { logError, logWarn } from '../app/native';
import { isInvalid, parseS2C } from '../shared/parse';
import { CLOSE_CODE, CONNECT_SECS, PING_SECS, PROTO_VERSION, RETRY_RESET_SECS, UID_PATTERN, cleanName, type C2S, type S2C } from '../shared/protocol';
import { ONLINE_SERVER } from './config';
import { isFaultClose, retryWaitSecs } from './retry';
import { Phase, changed, note, st, type Msg } from './state';

let ws: WebSocket | null = null;
let pending: C2S[] = []; // 连上之后要发的消息

/** 校验通过的服务端消息交给谁处理：由 client.ts 登记，连接模块因此不必引用消息的处理（两者不互相引用） */
let handler: (m: S2C) => void = () => {};
/** 登记服务端消息的处理函数 */
export function setMessageHandler(fn: (m: S2C) => void) {
  handler = fn;
}
/** 取出并清空连上之前存着的消息 */
export function takePending(): C2S[] {
  const out = pending;
  pending = [];
  return out;
}
/** 只留下待发消息中满足 keep 的 */
export function keepPending(keep: (m: C2S) => boolean) {
  pending = pending.filter(keep);
}
/** 是否有连接（已连上或正在连） */
export const hasSocket = () => ws !== null;
/** 是否已连上、可以发消息 */
export const isOpen = () => ws !== null && ws.readyState === WebSocket.OPEN;

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

/** 联机昵称：设置中的昵称，没有时生成“棋手”加三位数并存入设置；按 API-014 清洗 */
export function nick() {
  let n = settings.value.nick.trim();
  if (!n) {
    n = T('棋手') + (100 + Math.floor(Math.random() * 900));
    setSettings({ nick: n });
  }
  return cleanName(n, T('棋手'));
}

/** 发一条消息；还没连上就先存着，连上后发出 */
export function send(m: C2S) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else {
    pending.push(m);
    connect();
  }
}

/** 关闭当前连接（没有时什么也不做）；之后的关闭事件不再触发断线处理 */
export function netClose() {
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
    st.lastRecv = openedAt = now();
    sock.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: nick(), uid: uid(), token: st.reconnecting ? st.token : undefined } satisfies C2S));
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
