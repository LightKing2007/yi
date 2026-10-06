/**
 * 联机消息的集中校验：服务端收到的每条消息先经 parseC2S（API-010 至 API-015），客户端收到的每条消息先经 parseS2C（API-016），
 * 通过后才交给处理函数。只校验结构与取值范围；是否轮到、房号是否存在、落点是否在本局棋盘内等业务判断仍由规则层与服务端负责。
 */
import { MAXN } from '../core/types';
import { bool, intIn, isRecord, match, member, oneOf, text, type Check } from './check';
import {
  ACTS_MAX,
  DOWNLOAD_URL_PATTERN,
  DRAWN,
  PROTO_VERSION,
  UID_PATTERN,
  VERSION_PATTERN,
  type Act,
  type AskKind,
  type C2S,
  type GameKind,
  type OverReason,
  type QueueMode,
  type S2C,
} from './protocol';

/**
 * 校验失败。invalid 为 `version` 时是协议版本不符（提示玩家更新游戏），为 `format` 时是消息格式错误；
 * why 是失败原因，只写日志，不发给对方
 */
export interface Invalid {
  invalid: 'version' | 'format';
  why: string;
}

/** 校验结果是否为失败 */
export const isInvalid = <M extends object>(msg: M | Invalid): msg is Invalid => 'invalid' in msg;

/** 未知字段超过这个数就按非法消息处理（API-011） */
const MAX_UNKNOWN_FIELDS = 16;
/** 昵称原文的长度上限（UTF-16 码元数）：16 个字素即使都是组合表情也够用，清洗与截断由 cleanName 负责 */
const NAME_RAW_MAX = 256;
/** 写进日志的取值最多保留的字符数，免得恶意的超长值撑大日志 */
const SHOWN_MAX = 40;
/** 协议版本号的取值范围（API-012） */
const PROTO_MAX = 99;
/** 棋盘路数（API-012） */
const SIZES = [9, 13, 15, 19];
/** 每步限时的秒数，0 为不限时（API-012） */
const MOVE_TIMES = [0, 30, 60, 120];
/** 好友房间房主执子：0 随机，1 黑，2 白（API-012） */
const HOST_COLORS = [0, 1, 2];
/** 房号与重连令牌的格式（API-013） */
const ROOM_CODE = /^[0-9]{4}$/;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** 服务端下发的提示文字（info、error、joinNo 与 unmatched 的原因）的长度上限（UTF-16 码元数）：现有提示都不超过 30 个字 */
const TEXT_MAX = 200;
/**
 * 服务端下发的秒数（配对确认时限、本手剩余时间、掉线后等待）的绝对值上限：协议中的时限都不超过 2 分钟，
 * 留足余量，又不至于让界面算出离谱的截止时刻
 */
const SECS_MAX = 3600;
/** 一次悔棋最多退几手：轮到申请方时连对方已应的一手一起退（server/rooms.ts 的 resolveAsk） */
const UNDO_PLIES_MAX = 2;

/** 校验失败时 Take 的返回值 */
const BAD = Symbol('不合法');
/** 校验并取出一个值：标量原样返回，对象与数组重建为只含已知字段的新值；不合法时返回 BAD */
type Take = (val: unknown) => unknown;
/** 一个字段的校验；optional 表示该字段可以不出现 */
interface Field {
  take: Take;
  optional?: true;
}
type Fields = Record<string, Field>;
/**
 * 以 tag 字段区分成员的联合类型的字段表：每个成员除 tag 以外的每个字段都必须有校验，
 * 协议新增字段而忘了在这里补上时，类型检查不通过
 */
type Schema<U extends Record<D, string>, D extends string> = {
  [K in U[D]]: { [F in Exclude<keyof Extract<U, Record<D, K>>, D>]-?: Field };
};

/** 非负的安全整数（段位分、胜负局数） */
const count = intIn(0, Number.MAX_SAFE_INTEGER);

const need = (check: Check): Field => ({ take: val => (check(val) ? val : BAD) });
const opt = (check: Check): Field => ({ ...need(check), optional: true });

/** 写进日志的取值：截短，对象与数组只写类别 */
function shown(val: unknown) {
  if (Array.isArray(val)) return `数组（${val.length} 项）`;
  if (isRecord(val)) return '对象';
  return String(typeof val === 'string' ? JSON.stringify(val) : val).slice(0, SHOWN_MAX);
}

/**
 * 按字段表取出 obj 的已知字段，返回新对象；不合法时返回失败原因。where 是写进原因里的位置，
 * tag 是联合类型的区分字段（由调用方处理，不算未知字段）。值为 undefined 的键与没有这个键相同（JSON 里不会出现）
 */
function takeFields(obj: Record<string, unknown>, fields: Fields, where: string, tag = ''): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const val = Object.hasOwn(obj, key) ? obj[key] : undefined;
    if (val === undefined && field.optional) continue;
    const got = val === undefined ? BAD : field.take(val);
    if (got === BAD) return `${where}.${key} 不合法：${val === undefined ? '缺少' : shown(val)}`;
    out[key] = got;
  }
  let unknown = 0;
  for (const key of Object.keys(obj)) if (key !== tag && !Object.hasOwn(fields, key)) unknown++;
  return unknown > MAX_UNKNOWN_FIELDS ? `${where} 含 ${unknown} 个未知字段` : out;
}

/** 以 tag 字段区分成员的联合类型：tag 的取值必须是字段表中的一项，再按该成员的字段表取出。what 是写进原因里的类别名 */
function takeUnion(raw: unknown, tag: string, schema: Record<string, Fields>, what: string): Record<string, unknown> | string {
  if (!isRecord(raw)) return `${what}不是对象`;
  const kind = raw[tag];
  const fields = typeof kind === 'string' && Object.hasOwn(schema, kind) ? schema[kind] : undefined;
  if (typeof kind !== 'string' || !fields) return `未知的${what}类型 ${shown(kind)}`;
  const got = takeFields(raw, fields, kind, tag);
  return typeof got === 'string' ? got : { [tag]: kind, ...got };
}

/** 对象字段：按字段表重建，只保留已知字段 */
const record = (fields: Fields): Field => ({
  take: val => {
    const got = isRecord(val) ? takeFields(val, fields, '') : '';
    return typeof got === 'string' ? BAD : got;
  },
});

/** 数组字段：最多 max 项，每一项按 item 取出 */
const list = (max: number, item: Take): Field => ({
  take: val => {
    if (!Array.isArray(val) || val.length > max) return BAD;
    const out = val.map(el => item(el));
    return out.includes(BAD) ? BAD : out;
  },
});

/** 校验一条消息：通过时返回只含已知字段的新对象，不通过时返回 Invalid，严禁把非法值改成默认值后继续处理（API-015、API-016） */
function parseBy<U extends Record<'t', string>>(raw: unknown, schema: Schema<U, 't'>): U | Invalid {
  const got = takeUnion(raw, 't', schema, '消息');
  if (typeof got === 'string') return { invalid: 'format', why: got };
  // 例外 COD-053：这里就是校验函数本身，got 的每个字段都已按字段表逐一校验，嵌套的对象与数组也已重建
  return got as U;
}

// ---------------- 客户端 → 服务端 ----------------

const COORD = need(intIn(0, MAXN - 1));
const TYPE = need(oneOf([0, 1]));
const SIZE = need(oneOf(SIZES));
const OK = need(bool);
const ASK_KINDS: Record<AskKind, true> = { undo: true, draw: true, rematch: true };
const QUEUE_MODES: Record<QueueMode, true> = { match: true, ranked: true };

/** 各消息的字段与取值范围（API-012、API-013） */
const C2S_SCHEMA: Schema<C2S, 't'> = {
  hello: { v: need(intIn(1, PROTO_MAX)), name: need(text(NAME_RAW_MAX)), uid: need(match(UID_PATTERN)), token: opt(match(TOKEN_PATTERN)) },
  ping: {},
  name: { name: need(text(NAME_RAW_MAX)) },
  queue: { mode: need(member(QUEUE_MODES)), type: TYPE, size: SIZE },
  unqueue: {},
  confirm: { ok: OK },
  create: { type: TYPE, size: SIZE, hostColor: need(oneOf(HOST_COLORS)), renju: OK, moveTime: need(oneOf(MOVE_TIMES)) },
  close: {},
  join: { code: need(match(ROOM_CODE)) },
  move: { x: COORD, y: COORD },
  pass: {},
  undo: {},
  draw: {},
  rematch: {},
  reply: { kind: need(member(ASK_KINDS)), ok: OK },
  resign: {},
  mark: { x: COORD, y: COORD },
  agree: {},
  resume: {},
  leave: {},
};

/**
 * 校验一条入站消息（已由 JSON 解析，解析失败时传入 undefined）。
 * `hello` 的 v 与本端协议版本不同时，不再校验其余字段（旧版客户端的字段可能不同），直接返回 version
 */
export function parseC2S(raw: unknown): C2S | Invalid {
  if (isRecord(raw) && raw.t === 'hello' && intIn(1, PROTO_MAX)(raw.v) && raw.v !== PROTO_VERSION) {
    return { invalid: 'version', why: `协议版本 ${String(raw.v)}` };
  }
  return parseBy<C2S>(raw, C2S_SCHEMA);
}

// ---------------- 服务端 → 客户端 ----------------

/** 执子方：1 黑，2 白 */
const COLOR = need(oneOf([1, 2]));
const SECS = need(intIn(0, SECS_MAX));
const UNDO_PLIES = need(intIn(0, UNDO_PLIES_MAX));
const TEXT = need(text(TEXT_MAX));
const GAME_KINDS: Record<GameKind, true> = { match: true, ranked: true, friend: true };
const OVER_REASONS: Record<OverReason, true> = { five: true, full: true, score: true, resign: true, timeout: true, disconnect: true, draw: true, left: true };
const RATING = record({ points: need(count), win: need(count), loss: need(count), draw: need(count) });
const OPPONENT = record({ name: need(text(NAME_RAW_MAX)), points: opt(count) });

const ACT_SCHEMA: Schema<Act, 'k'> = { M: { x: COORD, y: COORD }, P: {}, U: { n: UNDO_PLIES }, K: { x: COORD, y: COORD }, R: {} };
/** 一条对局动作（sync 回放用） */
const ACT: Take = val => {
  const got = takeUnion(val, 'k', ACT_SCHEMA, '动作');
  return typeof got === 'string' ? BAD : got;
};

/** 各消息的字段与取值范围；次数、路数、坐标、数组长度都有上限，伪造的消息不能让客户端长时间循环或越界（A-05） */
const S2C_SCHEMA: Schema<S2C, 't'> = {
  welcome: {
    id: need(intIn(1, Number.MAX_SAFE_INTEGER)),
    token: need(match(TOKEN_PATTERN)),
    ratings: record({ gomoku: RATING, go: RATING }),
    latest: opt(match(VERSION_PATTERN)),
    url: opt(match(DOWNLOAD_URL_PATTERN)),
  },
  resumeFailed: {},
  pong: {},
  queued: { mode: need(member(QUEUE_MODES)), type: TYPE, size: SIZE },
  found: { opp: OPPONENT, secs: SECS },
  accepted: {},
  unmatched: { requeued: OK, reason: TEXT },
  created: { code: need(match(ROOM_CODE)) },
  joinNo: { reason: TEXT },
  start: {
    kind: need(member(GAME_KINDS)),
    color: COLOR,
    type: TYPE,
    size: SIZE,
    renju: OK,
    moveTime: need(oneOf(MOVE_TIMES)),
    black: OPPONENT,
    white: OPPONENT,
  },
  moved: { x: COORD, y: COORD },
  passed: {},
  // 负数表示不限时；服务端在超时判定之前算剩余时间时可能得到小于 -1 的值，按不限时显示
  turn: { color: COLOR, secs: need(intIn(-SECS_MAX, SECS_MAX)) },
  ask: { kind: need(member(ASK_KINDS)) },
  answer: { kind: need(member(ASK_KINDS)), ok: OK },
  undone: { n: UNDO_PLIES },
  marked: { x: COORD, y: COORD },
  agreed: { color: COLOR },
  resumed: {},
  over: { winner: need(oneOf([1, 2, DRAWN])), reason: need(member(OVER_REASONS)) },
  rated: { type: TYPE, rating: RATING, delta: need(intIn(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) },
  peer: { online: OK, wait: opt(intIn(0, SECS_MAX)) },
  left: {},
  sync: { acts: list(ACTS_MAX, ACT) },
  info: { text: TEXT },
  error: { text: TEXT },
};

/** 校验一条服务端消息（已由 JSON 解析，解析失败时传入 undefined）。不通过时调用方丢弃该消息并写 warn 日志（API-016） */
export function parseS2C(raw: unknown): S2C | Invalid {
  return parseBy<S2C>(raw, S2C_SCHEMA);
}
