/**
 * 入站消息的集中校验（API-010 至 API-015）：服务端收到的每条消息先经 parseC2S，通过后才交给处理函数。
 * 只校验结构与取值范围；是否轮到、房号是否存在、落点是否在本局棋盘内等业务判断仍由服务端按规则处理。
 */
import { MAXN } from '../core/types';
import { PROTO_VERSION, UID_PATTERN, type C2S } from './protocol';

/**
 * 校验失败。invalid 为 `version` 时是协议版本不符（提示玩家更新游戏），为 `format` 时是消息格式错误；
 * why 是失败原因，只写日志，不下发给客户端
 */
export interface Invalid { invalid: 'version' | 'format'; why: string }

/** 校验结果是否为失败 */
export const isInvalid = (m: C2S | Invalid): m is Invalid => 'invalid' in m;

/** 未知字段超过这个数就按非法消息处理（API-011） */
const MAX_UNKNOWN_FIELDS = 16;
/** 昵称原文的长度上限（UTF-16 码元数）：16 个字素即使都是组合表情也够用，清洗与截断由 cleanName 负责 */
const NAME_RAW_MAX = 256;

type Check = (v: unknown) => boolean;
/** 一个字段的校验；optional 表示该字段可以不出现 */
interface Field { check: Check; optional?: true }
/** 每种消息除 t 以外的每个字段都必须有校验：协议新增字段而忘了在这里补上时，类型检查不通过 */
type Schema = { [K in C2S['t']]: { [F in Exclude<keyof Extract<C2S, { t: K }>, 't'>]-?: Field } };

/** 有限整数且在 [lo, hi] 内；NaN、Infinity、小数、负零一律不合法（10-edge-cases.md 第 4 节） */
const intIn = (lo: number, hi: number): Check => v => Number.isInteger(v) && !Object.is(v, -0) && (v as number) >= lo && (v as number) <= hi;
/** 取值属于列出的几项（数值按 Object.is 比较，负零不等于零） */
const oneOf = (...xs: readonly (string | number)[]): Check => v => xs.some(x => Object.is(x, v));
const bool: Check = v => typeof v === 'boolean';
const match = (re: RegExp): Check => v => typeof v === 'string' && re.test(v);
const text = (max: number): Check => v => typeof v === 'string' && v.length <= max;

const need = (check: Check): Field => ({ check });
const COORD = need(intIn(0, MAXN - 1));
const TYPE = need(oneOf(0, 1));
const SIZE = need(oneOf(9, 13, 15, 19));
const OK = need(bool);

/** 各消息的字段与取值范围（API-012、API-013） */
const SCHEMA: Schema = {
  hello: { v: need(intIn(1, 99)), name: need(text(NAME_RAW_MAX)), uid: need(match(UID_PATTERN)), token: { check: match(/^[0-9a-f]{32}$/), optional: true } },
  ping: {},
  name: { name: need(text(NAME_RAW_MAX)) },
  queue: { mode: need(oneOf('match', 'ranked')), type: TYPE, size: SIZE },
  unqueue: {},
  confirm: { ok: OK },
  create: { type: TYPE, size: SIZE, hostColor: need(oneOf(0, 1, 2)), renju: OK, moveTime: need(oneOf(0, 30, 60, 120)) },
  close: {},
  join: { code: need(match(/^[0-9]{4}$/)) },
  move: { x: COORD, y: COORD },
  pass: {},
  undo: {},
  draw: {},
  rematch: {},
  reply: { kind: need(oneOf('undo', 'draw', 'rematch')), ok: OK },
  resign: {},
  mark: { x: COORD, y: COORD },
  agree: {},
  resume: {},
  leave: {},
};

const format = (why: string): Invalid => ({ invalid: 'format', why });
/** 写进日志的取值：截短，免得恶意的超长值撑大日志 */
const shown = (v: unknown) => String(typeof v === 'string' ? JSON.stringify(v) : v).slice(0, 40);

/**
 * 校验一条入站消息（已由 JSON 解析，解析失败时传入 undefined）。通过时返回只含已知字段的新对象，
 * 未知字段被丢弃；不通过时返回 Invalid，严禁把非法值改成默认值后继续处理（API-015）。
 * `hello` 的 v 与本端协议版本不同时，不再校验其余字段（旧版客户端的字段可能不同），直接返回 version
 */
export function parseC2S(raw: unknown): C2S | Invalid {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return format('顶层不是对象');
  const o = raw as Record<string, unknown>;
  const t = o.t;
  if (typeof t !== 'string' || !Object.hasOwn(SCHEMA, t)) return format(`未知的消息类型 ${shown(t)}`);
  if (t === 'hello' && intIn(1, 99)(o.v) && o.v !== PROTO_VERSION) return { invalid: 'version', why: `协议版本 ${o.v}` };
  const fields: Record<string, Field> = SCHEMA[t as C2S['t']];
  const out: Record<string, unknown> = { t };
  for (const [k, f] of Object.entries(fields)) {
    const v = Object.hasOwn(o, k) ? o[k] : undefined;   // 值为 undefined 的键与没有这个键相同（JSON 里不会出现）
    if (v === undefined && f.optional) continue;
    if (v === undefined || !f.check(v)) return format(`${t}.${k} 不合法：${v === undefined ? '缺少' : shown(v)}`);
    out[k] = v;
  }
  let unknown = 0;
  for (const k of Object.keys(o)) if (k !== 't' && !Object.hasOwn(fields, k)) unknown++;
  if (unknown > MAX_UNKNOWN_FIELDS) return format(`${t} 含 ${unknown} 个未知字段`);
  // 例外 COD-053：这里就是校验函数本身，out 的每个字段都已按 SCHEMA 逐一校验
  return out as C2S;
}
