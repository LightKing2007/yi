/**
 * 服务端结构化日志：按 07-operations.md 第 5.1 条输出 JSON Lines（OPS-060 至 OPS-063），事件码见该文件第 8 节。
 * 不读真实时钟、不直接写标准输出，均由调用方传入，测试中以假实现替换。
 */

/** 日志级别，对应 RFC 5424 的 3、4、6、7 级 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** 一行日志的内容：`msg` 为中文说明，`err` 为异常（只在 error 级别输出），其余为事件的附加字段 */
export interface LogEntry {
  msg?: string;
  err?: unknown;
  [field: string]: unknown;
}

/** 写一行日志；event 为 `领域.动作` 格式的事件码 */
export type Log = (level: LogLevel, event: string, entry?: LogEntry) => void;

/** 级别的先后：数字越小越严重 */
const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
/** sd-daemon 约定的级别号（OPS-060） */
const SYSLOG: Record<LogLevel, number> = { error: 3, warn: 4, info: 6, debug: 7 };
/** 单行日志的字节上限（OPS-063），不含级别前缀与换行 */
export const LINE_MAX_BYTES = 8192;
/** `msg` 的字符上限（07-operations.md 第 5.1 条） */
export const MSG_MAX_CHARS = 200;
/** 同一事件码每秒的行数上限，超出部分合并为汇总行（OPS-063） */
export const EVENT_MAX_PER_SEC = 100;
/** 截断时依次缩短最长的字符串，最多缩短的次数；仍然超出时只保留基本字段 */
const TRIM_ROUNDS = 16;
/** 每秒的毫秒数 */
const MS_PER_SEC = 1000;
/** 被截断处补上的省略号 */
const ELLIPSIS = '…';
/** 由日志模块填写、调用方不得覆盖的字段 */
const RESERVED = new Set(['ts', 'level', 'event', 'ver', 'truncated', 'suppressed']);

/** 日志的依赖 */
export interface LoggerOptions {
  /** 服务端版本号与提交号，如 `2.0.4+f6d924b` */
  ver: string;
  /** 最低输出级别，默认 info（OPS-062） */
  level?: LogLevel;
  /** 写出一行（不含换行） */
  write: (line: string) => void;
  /** 当前时刻（Unix 毫秒） */
  now: () => number;
  /** 每行前加 `<级别号>`，由 journald 记为优先级（OPS-060）；在 systemd 之下运行时为 true */
  syslogPrefix?: boolean;
}

/** 某个事件码在当前这一秒内的计数 */
interface EventWindow {
  sec: number;
  lines: number;
  dropped: number;
  level: LogLevel;
}

const isLevel = (value: string): value is LogLevel => Object.hasOwn(RANK, value);

/** 解析 `YI_LOG_LEVEL`：未设置或为空时为 info，不是四个级别之一时返回 null */
export function parseLogLevel(value: string | undefined): LogLevel | null {
  if (!value) return 'info';
  return isLevel(value) ? value : null;
}

/** 异常转为 `{ name, message, stack }`；抛出的不是 Error 时只有 message */
function errorFields(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'NonError', message: String(err) };
}

/** 按字符截断，超出时末尾补省略号 */
function clip(text: string, max: number) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + ELLIPSIS;
}

const isPlainObject = (val: unknown): val is Record<string, unknown> => val !== null && typeof val === 'object' && !Array.isArray(val);

/** 对象中最长的非空字符串所在的位置：只查顶层与下一层的普通对象（如 `err`）；msg 已限 200 字符，不参与截断 */
function longestString(obj: Record<string, unknown>) {
  const holders = [obj, ...Object.values(obj).filter(isPlainObject)];
  let best: { holder: Record<string, unknown>; key: string; len: number } | null = null;
  for (const holder of holders)
    for (const [key, val] of Object.entries(holder))
      if (typeof val === 'string' && !RESERVED.has(key) && !(holder === obj && key === 'msg') && val.length > (best?.len ?? 0))
        best = { holder, key, len: val.length };
  return best;
}

/**
 * 序列化为不超过 LINE_MAX_BYTES 的一行：超出时依次缩短最长的字符串并加 `truncated: true`；
 * 字符串都缩短后仍然超出时，只保留基本字段与 msg。每去掉一个 UTF-16 码元，JSON 至少少一个字节，故按超出的字节数截去码元
 */
function fit(obj: Record<string, unknown>): string {
  let line = JSON.stringify(obj);
  if (Buffer.byteLength(line) <= LINE_MAX_BYTES) return line;
  obj.truncated = true;
  for (let i = 0; i < TRIM_ROUNDS; i++) {
    line = JSON.stringify(obj);
    const over = Buffer.byteLength(line) - LINE_MAX_BYTES;
    if (over <= 0) return line;
    const slot = longestString(obj);
    if (!slot) break;
    let keep = Math.max(0, slot.len - over - Buffer.byteLength(ELLIPSIS));
    const text = slot.holder[slot.key] as string;
    if (keep > 0 && /[\uD800-\uDBFF]/.test(text[keep - 1])) keep--; // 不把代理对拆开
    slot.holder[slot.key] = text.slice(0, keep) + ELLIPSIS;
  }
  const { ts, level, event, ver, msg } = obj;
  return JSON.stringify({ ts, level, event, ver, msg, truncated: true });
}

/** 结构化日志：`log` 写一行，`flush` 输出已结束的秒内被合并的汇总行 */
export class Logger {
  private readonly min: number;
  private readonly windows = new Map<string, EventWindow>();

  constructor(private readonly opt: LoggerOptions) {
    this.min = RANK[opt.level ?? 'info'];
  }

  /** 写一行日志；低于最低级别的不输出。日志本身出错时不抛出，免得拖垮调用方 */
  readonly log: Log = (level, event, entry = {}) => {
    if (RANK[level] > this.min) return;
    const sec = Math.floor(this.opt.now() / MS_PER_SEC);
    let win = this.windows.get(event);
    if (win && win.sec !== sec) {
      this.summarize(event, win);
      win = undefined;
    }
    if (!win) {
      win = { sec, lines: 0, dropped: 0, level };
      this.windows.set(event, win);
    }
    if (win.lines >= EVENT_MAX_PER_SEC) {
      win.dropped++;
      if (RANK[level] < RANK[win.level]) win.level = level;
      return;
    }
    win.lines++;
    this.emit(level, event, entry);
  };

  /** 输出已结束的秒内的汇总行；final 为 true 时（退出前）当前这一秒的也一并输出 */
  flush(final = false) {
    const sec = Math.floor(this.opt.now() / MS_PER_SEC);
    for (const [event, win] of this.windows)
      if (final || win.sec !== sec) {
        this.summarize(event, win);
        this.windows.delete(event);
      }
  }

  private summarize(event: string, win: EventWindow) {
    if (!win.dropped) return;
    const msg = `同一事件码 1 秒内超过 ${EVENT_MAX_PER_SEC} 行，另有 ${win.dropped} 行已合并`;
    this.emit(win.level, event, { msg }, win.dropped);
  }

  /** 输出一行；suppressed 为汇总行合并的行数 */
  private emit(level: LogLevel, event: string, entry: LogEntry, suppressed = 0) {
    const obj: Record<string, unknown> = { ts: new Date(this.opt.now()).toISOString(), level, event, ver: this.opt.ver };
    if (typeof entry.msg === 'string') obj.msg = clip(entry.msg, MSG_MAX_CHARS);
    // 值为 undefined 的字段由 JSON.stringify 略去
    for (const [key, val] of Object.entries(entry)) if (key !== 'msg' && key !== 'err' && !RESERVED.has(key)) obj[key] = val;
    if (suppressed) obj.suppressed = suppressed;
    if (level === 'error' && entry.err !== undefined) obj.err = errorFields(entry.err);
    let line: string;
    try {
      line = fit(obj);
    } catch (err) {
      // 附加字段无法序列化（循环引用、BigInt）：只保留基本字段，并说明原因
      line = JSON.stringify({ ts: obj.ts, level, event, ver: obj.ver, msg: clip(`日志字段无法序列化：${errorFields(err).message}`, MSG_MAX_CHARS) });
    }
    this.opt.write(this.opt.syslogPrefix ? `<${SYSLOG[level]}>${line}` : line);
  }
}

/**
 * 服务端进程的日志：级别取自 `YI_LOG_LEVEL`（OPS-062），在 systemd 之下（有 `JOURNAL_STREAM`）加级别前缀（OPS-060）。
 * `YI_LOG_LEVEL` 不合法时记下 `server.config-invalid` 并返回 null，调用方必须拒绝启动
 */
export function processLogger(env: Record<string, string | undefined>, base: Pick<LoggerOptions, 'ver' | 'write' | 'now'>): Logger | null {
  const level = parseLogLevel(env.YI_LOG_LEVEL);
  const logger = new Logger({ ...base, level: level ?? 'info', syslogPrefix: Boolean(env.JOURNAL_STREAM) });
  if (level) return logger;
  logger.log('error', 'server.config-invalid', { msg: 'YI_LOG_LEVEL 不合法，拒绝启动', variable: 'YI_LOG_LEVEL', expected: 'error、warn、info、debug 之一' });
  return null;
}
