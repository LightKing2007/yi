/**
 * 联机会话的状态（整改项 P2-12 自 client.ts 拆出）：所处阶段、界面显示所需的全部字段（st）、界面重绘的信号、
 * 切换界面、服务端告知的新版本，以及提示与常用的状态查询。只有状态与简单的读写，不收发消息。
 */
import { now } from '../core/clock';
import { TF } from '../i18n';
import { game, netTick, screen, Screen, VERSION, uiTick } from '../app/state';
import { loadStored, saveStored, type StoreSpec } from '../app/storage';
import { match, type Guard } from '../shared/check';
import {
  DOWNLOAD_URL_PATTERN,
  VERSION_PATTERN,
  newRating,
  type AskKind,
  type GameKind,
  type Opponent,
  type OverReason,
  type QueueMode,
  type Rating,
  type Ratings,
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

/** 界面与联机状态有关的部分需要重绘时递增（信号定义在 app/state，界面仍从这里取用） */
export { netTick };
/** 联机状态变了：多人游戏的界面重绘 */
export const changed = () => {
  netTick.value++;
};

/** 对局状态变了：界面重绘 */
export const bump = () => {
  uiTick.value++;
};

/**
 * 切换界面（离开对局时棋子飞回棋罐、清盘等由控制器负责）。由控制器在加载时注册（bindNavigation），
 * 联机模块因此不必引用控制器，两者不再互相引用。
 */
let navigate: (s: Screen) => void = s => {
  screen.value = s;
};
export function bindNavigation(go: (s: Screen) => void) {
  navigate = go;
}
/** 切换界面：交给控制器注册的导航函数；导出函数而不导出可变的绑定本身（COD-058） */
export function goScreen(target: Screen) {
  navigate(target);
}

/** 服务端告知的新版本：版本号与下载地址，没有时为空串 */
interface UpdateNote {
  version: string;
  url: string;
}
/** 空串，或通过 guard 校验的字符串 */
const emptyOr =
  (guard: Guard<string>): Guard<string> =>
  (val): val is string =>
    val === '' || guard(val);
/** 新版本在本地存储中的格式（DAT-080）：第 1 版起带版本号 v；之前写入的算作第 0 版，没有新版本时存的是 null */
const UPDATE_STORE: StoreSpec<UpdateNote> = {
  key: 'yi.update',
  version: 1,
  defaults: { version: '', url: '' },
  fields: { version: emptyOr(match(VERSION_PATTERN)), url: emptyOr(match(DOWNLOAD_URL_PATTERN)) },
};
const updateStored = loadStored(UPDATE_STORE);

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
function loadUpdate(): UpdateNote | null {
  const saved = updateStored.value;
  return saved.version && newerVersion(saved.version, VERSION) ? saved : null;
}

/** 记下服务端告知的新版本；由更新版本的程序写入的记录不写回（VER-012） */
export function saveUpdate(latest: string | undefined, url: string | undefined) {
  st.update = latest && newerVersion(latest, VERSION) ? { version: latest, url: url ?? '' } : null;
  if (updateStored.writable) saveStored(UPDATE_STORE, st.update ?? UPDATE_STORE.defaults);
}

export function note(...parts: Msg[]) {
  st.notice = parts;
  st.noticeAt = now();
  changed();
}

export const inGame = () => st.phase === Phase.Playing;
export const myTurn = () => st.phase === Phase.Playing && !st.over && !game.scoring && st.toMove === st.myColor && !st.askIn && !st.askOut;
export const ratingOf = (type: number) => (type ? st.ratings.go : st.ratings.gomoku);
