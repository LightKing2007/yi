/** 服务端结构化日志：JSON Lines 的字段、级别筛选、单行截断、同一事件码的汇总、journald 级别前缀（OPS-060 至 OPS-063） */
import { beforeEach, describe, expect, it } from 'vitest';
import { EVENT_MAX_PER_SEC, LINE_MAX_BYTES, Logger, MSG_MAX_CHARS, parseLogLevel, processLogger, type LoggerOptions } from '../server/log';
import { must } from './must';

/** 一秒的毫秒数：汇总按秒计 */
const SEC_MS = 1000;
const START_MS = Date.UTC(2026, 9, 2, 1, 42, 17, 123);

let clock = START_MS;
let lines: string[] = [];

/** 建一个写入 lines、读 clock 的日志 */
const logger = (opt: Partial<LoggerOptions> = {}) => new Logger({ ver: '2.0.4+f6d924b', write: line => lines.push(line), now: () => clock, ...opt });
const parsed = () => lines.map(line => JSON.parse(line) as Record<string, unknown>);

beforeEach(() => {
  clock = START_MS;
  lines = [];
});

describe('行格式', () => {
  it('每行是一个 JSON 对象，含 UTC 毫秒时间、级别、事件码、版本，附加字段与之同层', () => {
    logger().log('info', 'player.online', { msg: '甲 上线', playerId: 7 });
    expect(parsed()).toEqual([{ ts: '2026-10-02T01:42:17.123Z', level: 'info', event: 'player.online', ver: '2.0.4+f6d924b', msg: '甲 上线', playerId: 7 }]);
  });

  it('值为 undefined 的附加字段不输出；调用方不能覆盖基本字段', () => {
    logger().log('warn', 'proto.invalid', { playerId: undefined, reason: '缺少', ts: 'x', level: 'x', event: 'x', ver: 'x', truncated: 'x', suppressed: 9 });
    expect(parsed()).toEqual([{ ts: '2026-10-02T01:42:17.123Z', level: 'warn', event: 'proto.invalid', ver: '2.0.4+f6d924b', reason: '缺少' }]);
  });

  it('error 级别的异常输出为 { name, message, stack }，其他级别不输出 err', () => {
    const log = logger().log;
    const err = new RangeError('磁盘已满');
    log('error', 'store.write-failed', { err });
    log('warn', 'store.write-failed', { err });
    log('error', 'internal.error', { err: 'boom' });
    const [first, second, third] = parsed();
    expect(first?.err).toEqual({ name: 'RangeError', message: '磁盘已满', stack: err.stack });
    expect(second).not.toHaveProperty('err');
    expect(third?.err).toEqual({ name: 'NonError', message: 'boom' });
  });

  it('msg 超过 200 字符时截断并以省略号结尾，按字符计', () => {
    logger().log('info', 'server.start', { msg: '弈'.repeat(MSG_MAX_CHARS + 50) });
    const msg = String(parsed()[0]?.msg);
    expect(Array.from(msg)).toHaveLength(MSG_MAX_CHARS);
    expect(msg.endsWith('…')).toBe(true);
  });

  it('附加字段无法序列化时仍输出一行，只含基本字段与原因，不抛出', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    logger().log('info', 'game.over', { loop });
    expect(parsed()).toEqual([expect.objectContaining({ event: 'game.over', msg: expect.stringContaining('日志字段无法序列化') })]);
  });
});

describe('级别', () => {
  it('默认只输出 info 及更严重的级别；YI_LOG_LEVEL=debug 时输出 debug', () => {
    logger().log('debug', 'a.b');
    logger().log('info', 'a.c');
    logger({ level: 'debug' }).log('debug', 'a.d');
    expect(parsed().map(row => row.event)).toEqual(['a.c', 'a.d']);
  });

  it('最低级别为 error 时不输出 warn', () => {
    const log = logger({ level: 'error' }).log;
    log('warn', 'a.b');
    log('error', 'a.c');
    expect(parsed().map(row => row.event)).toEqual(['a.c']);
  });

  it('YI_LOG_LEVEL 未设置时为 info，取四个级别之一时照用，其他值不合法', () => {
    expect([undefined, '', 'debug', 'error'].map(parseLogLevel)).toEqual(['info', 'info', 'debug', 'error']);
    expect(['INFO', 'verbose', 'toString'].map(parseLogLevel)).toEqual([null, null, null]);
  });

  it('在 systemd 之下每行前加 sd-daemon 的级别号，其余部分仍是 JSON', () => {
    const log = logger({ syslogPrefix: true, level: 'debug' }).log;
    for (const level of ['error', 'warn', 'info', 'debug'] as const) log(level, 'a.b');
    expect(lines.map(line => line.slice(0, 3))).toEqual(['<3>', '<4>', '<6>', '<7>']);
    expect(JSON.parse(must(lines[0], '日志行').slice(3))).toEqual(expect.objectContaining({ level: 'error', event: 'a.b' }));
  });
});

describe('单行截断（OPS-063）', () => {
  it('超过 8 KB 时缩短最长的字符串并加 truncated，整行不超过 8 KB 且仍是 JSON', () => {
    logger().log('error', 'internal.error', { msg: '出错', detail: '棋'.repeat(5000), err: new Error('x'.repeat(3000)) });
    expect(Buffer.byteLength(must(lines[0], '日志行'))).toBeLessThanOrEqual(LINE_MAX_BYTES);
    const row = must(parsed()[0], '日志行');
    expect(row.truncated).toBe(true);
    expect(row.msg).toBe('出错');
    expect(String(row.detail).endsWith('…')).toBe(true);
  });

  it('不超过 8 KB 的行原样输出，不加 truncated', () => {
    const detail = 'a'.repeat(LINE_MAX_BYTES - 200);
    logger().log('info', 'a.b', { detail });
    expect(parsed()[0]).toEqual(expect.objectContaining({ detail }));
    expect(parsed()[0]).not.toHaveProperty('truncated');
  });

  it('截断时不拆开代理对', () => {
    // 截断处落在代理对中间与否取决于整行字节数的奇偶，以长度相差 1 的 pad 字段把两种情况都走到
    for (const pad of ['a', 'aa']) logger().log('info', 'a.b', { pad, detail: '😀'.repeat(3000) });
    for (const row of parsed()) expect(String(row.detail)).toMatch(/^(?:😀)+…$/u);
    for (const line of lines) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(LINE_MAX_BYTES);
  });

  it('字符串都缩短后仍然超出时，只保留基本字段与 msg', () => {
    logger().log('info', 'a.b', { msg: '很多数字', nums: Array.from({ length: 4000 }, (_, i) => i) });
    expect(parsed()).toEqual([{ ts: '2026-10-02T01:42:17.123Z', level: 'info', event: 'a.b', ver: '2.0.4+f6d924b', msg: '很多数字', truncated: true }]);
  });
});

describe('同一事件码的汇总（OPS-063）', () => {
  it('1 秒内超过 100 行的部分不输出，该秒结束后以一行汇总记下合并的行数', () => {
    const log = new Logger({ ver: 'v', write: line => lines.push(line), now: () => clock });
    for (let i = 0; i < EVENT_MAX_PER_SEC + 30; i++) log.log('warn', 'rate.limited', { count: i });
    log.log('info', 'player.online');
    expect(lines).toHaveLength(EVENT_MAX_PER_SEC + 1);
    log.flush();
    expect(lines).toHaveLength(EVENT_MAX_PER_SEC + 1); // 这一秒还没结束
    clock += SEC_MS;
    log.flush();
    expect(parsed().at(-1)).toEqual(expect.objectContaining({ level: 'warn', event: 'rate.limited', suppressed: 30 }));
    expect(lines).toHaveLength(EVENT_MAX_PER_SEC + 2);
  });

  it('下一秒该事件码再出现时，先输出上一秒的汇总，再照常输出', () => {
    const log = logger().log;
    for (let i = 0; i < EVENT_MAX_PER_SEC + 1; i++) log('info', 'game.start');
    clock += SEC_MS;
    log('info', 'game.start', { roomId: 1 });
    expect(parsed().slice(-2)).toEqual([expect.objectContaining({ suppressed: 1 }), expect.objectContaining({ roomId: 1 })]);
  });

  it('汇总行取被合并各行中最严重的级别；没有被合并的行时不输出汇总', () => {
    const log = logger();
    for (let i = 0; i < EVENT_MAX_PER_SEC; i++) log.log('warn', 'store.write-failed');
    log.log('warn', 'store.write-failed');
    log.log('error', 'store.write-failed');
    log.log('info', 'game.over');
    log.flush(true);
    expect(parsed().slice(EVENT_MAX_PER_SEC)).toEqual([
      expect.objectContaining({ event: 'game.over' }),
      expect.objectContaining({ level: 'error', suppressed: 2 }),
    ]);
  });

  it('退出前 flush(true) 输出当前这一秒的汇总', () => {
    const log = logger();
    for (let i = 0; i < EVENT_MAX_PER_SEC + 5; i++) log.log('info', 'a.b');
    log.flush(true);
    expect(parsed().at(-1)).toEqual(expect.objectContaining({ event: 'a.b', suppressed: 5 }));
  });
});

describe('服务端进程的日志', () => {
  const base = { ver: 'v', write: (line: string) => lines.push(line), now: () => clock };

  it('级别取自 YI_LOG_LEVEL，在 systemd 之下（有 JOURNAL_STREAM）加级别前缀', () => {
    processLogger({ YI_LOG_LEVEL: 'debug' }, base)?.log('debug', 'a.b');
    processLogger({ JOURNAL_STREAM: '8:1' }, base)?.log('debug', 'a.c');
    processLogger({ JOURNAL_STREAM: '8:1' }, base)?.log('warn', 'a.d');
    expect(lines.map(line => line.slice(0, line.indexOf('{')) + String(JSON.parse(line.slice(line.indexOf('{'))).event))).toEqual(['a.b', '<4>a.d']);
  });

  it('YI_LOG_LEVEL 不合法时记下 server.config-invalid 并返回 null', () => {
    expect(processLogger({ YI_LOG_LEVEL: 'verbose' }, base)).toBeNull();
    expect(parsed()).toEqual([expect.objectContaining({ level: 'error', event: 'server.config-invalid', variable: 'YI_LOG_LEVEL' })]);
  });
});
