/** 限流部件（server/ratelimit.ts）：令牌桶、滑动时间窗、按 IP 的新建连接频率、每条连接的限额；时刻全部由测试给出（API-041 至 API-045） */
import { describe, expect, it } from 'vitest';
import {
  ConnLimits,
  IpGate,
  MSG_BURST,
  MSG_RATE_PER_SEC,
  NEW_CONN_BLOCK_SECS,
  NEW_CONN_MAX,
  NEW_CONN_WINDOW_SECS,
  QUEUE_OPS_MAX,
  TokenBucket,
  VIOLATION_MAX,
  VIOLATION_WINDOW_SECS,
  WindowCounter,
} from '../server/ratelimit';

/** 在同一时刻连取 n 次，返回取到的次数 */
const takeMany = (b: TokenBucket, n: number, now: number) => Array.from({ length: n }, () => b.take(now)).filter(Boolean).length;

describe('令牌桶', () => {
  it('满桶时可以连取容量那么多次，再取即被拒', () => {
    const b = new TokenBucket(20, 40, 0);
    expect(takeMany(b, 41, 0)).toBe(40);
  });

  it('桶空后按速率补充，补满即止，不会越攒越多', () => {
    const b = new TokenBucket(20, 40, 0);
    takeMany(b, 40, 0);
    expect(takeMany(b, 30, 1)).toBe(20); // 1 秒补 20 个
    expect(takeMany(b, 100, 100)).toBe(40); // 闲置很久也只有容量那么多
  });

  it('被拒的请求不扣成负数：洪泛停下后照常按速率恢复', () => {
    const b = new TokenBucket(20, 40, 0);
    takeMany(b, 1000, 0);
    expect(takeMany(b, 5, 0.25)).toBe(5);
  });

  it('时钟倒退时不补充令牌', () => {
    const b = new TokenBucket(20, 40, 10);
    takeMany(b, 40, 10);
    expect(b.take(5)).toBe(false);
  });
});

describe('滑动时间窗计数', () => {
  it('只计窗内的次数，满了即 full，滑出窗口后恢复', () => {
    const c = new WindowCounter(10, 3);
    expect([c.hit(0), c.hit(1), c.hit(2)]).toEqual([1, 2, 3]);
    expect(c.full(9.9)).toBe(true);
    expect(c.full(10)).toBe(false);
    expect(c.count(12)).toBe(0);
  });

  it('次数超过上限后不再增加占用', () => {
    const c = new WindowCounter(60, 5);
    for (let i = 0; i < 1000; i++) c.hit(0);
    expect(c.count(0)).toBe(5);
  });
});

describe('按 IP 的新建连接频率（API-041）', () => {
  const gate = () => new IpGate({ max: NEW_CONN_MAX, windowSecs: NEW_CONN_WINDOW_SECS, blockSecs: NEW_CONN_BLOCK_SECS });

  it('每分钟 30 次以内放行，第 31 次被拒，此后 60 秒内该 IP 一律被拒，其他 IP 不受影响', () => {
    const g = gate();
    for (let i = 0; i < NEW_CONN_MAX; i++) expect(g.admit('1.1.1.1', i)).toBe(true);
    expect(g.admit('1.1.1.1', 30)).toBe(false);
    expect(g.admit('2.2.2.2', 30)).toBe(true);
    expect(g.admit('1.1.1.1', 30 + NEW_CONN_BLOCK_SECS - 0.1)).toBe(false);
    expect(g.admit('1.1.1.1', 30 + NEW_CONN_BLOCK_SECS)).toBe(true);
  });

  it('被拒期间的尝试不延长拒绝时间', () => {
    const g = gate();
    for (let i = 0; i <= NEW_CONN_MAX; i++) g.admit('1.1.1.1', 0);
    for (let t = 1; t < NEW_CONN_BLOCK_SECS; t++) g.admit('1.1.1.1', t);
    expect(g.admit('1.1.1.1', NEW_CONN_BLOCK_SECS)).toBe(true);
  });

  it('间隔足够的连接一直放行', () => {
    const g = gate();
    for (let i = 0; i < 200; i++) expect(g.admit('1.1.1.1', i * 2.5)).toBe(true);
  });

  it('清理后不再追踪过期的 IP', () => {
    const g = gate();
    for (let i = 0; i < 100; i++) g.admit(`10.0.0.${i}`, 0);
    for (let i = 0; i <= NEW_CONN_MAX; i++) g.admit('1.1.1.1', 0);
    g.prune(NEW_CONN_WINDOW_SECS - 1);
    expect(g.size).toBe(101);
    g.prune(Math.max(NEW_CONN_WINDOW_SECS, NEW_CONN_BLOCK_SECS));
    expect(g.size).toBe(0);
  });
});

describe('每条连接的限额', () => {
  it('消息按每秒 20 条、容量 40 条限速（API-043）', () => {
    const l = new ConnLimits(0);
    expect(Array.from({ length: MSG_BURST + 1 }, () => l.message(0)).filter(Boolean)).toHaveLength(MSG_BURST);
    expect(Array.from({ length: MSG_RATE_PER_SEC + 1 }, () => l.message(1)).filter(Boolean)).toHaveLength(MSG_RATE_PER_SEC);
  });

  it('进入、退出匹配队列合计每 10 秒至多 10 次；改名每 10 秒至多 1 次，两者分开计（API-044）', () => {
    const l = new ConnLimits(0);
    expect(Array.from({ length: QUEUE_OPS_MAX + 1 }, () => l.allow('queue', 0)).filter(Boolean)).toHaveLength(QUEUE_OPS_MAX);
    expect(l.allow('name', 0)).toBe(true);
    expect(l.allow('name', 9.9)).toBe(false);
    expect(l.allow('name', 10)).toBe(true);
    expect(l.allow('queue', 10)).toBe(true);
  });

  it('60 秒内第 10 次违规时应断开；分散在 60 秒以外的不累计（API-045）', () => {
    const l = new ConnLimits(0);
    for (let i = 0; i < VIOLATION_MAX - 1; i++) expect(l.violate(i)).toBe(false);
    expect(l.violate(VIOLATION_WINDOW_SECS - 1)).toBe(true);
    const spread = new ConnLimits(0);
    for (let i = 0; i < 100; i++) expect(spread.violate(i * (VIOLATION_WINDOW_SECS / (VIOLATION_MAX - 1)))).toBe(false);
  });

  it('超限提示 1 秒内只回复一次', () => {
    const l = new ConnLimits(0);
    expect([l.notice(0), l.notice(0.5), l.notice(1), l.notice(1.2)]).toEqual([true, false, true, false]);
  });
});
