/** 服务端的监控指标（server/metrics.ts，OPS-071、OPS-072，07-operations.md 第 9 节）：错误码的对应、Prometheus 文本格式、快照 */
import { describe, expect, it } from 'vitest';
import { Metrics, errorCode, lagSeconds, type Gauges } from '../server/metrics';
import { PROTO_VERSION } from '../src/shared/protocol';
import { rejectText } from '../src/shared/reject';

const GAUGES: Gauges = {
  connections: 3,
  playersOnline: 2,
  rooms: [
    { kind: 'friend', state: 'play', count: 1 },
    { kind: 'match', state: 'scoring', count: 2 },
  ],
  queue: [{ mode: 'ranked', type: 'go', count: 1 }],
  downloadsActive: 1,
  eventLoopLagSeconds: 0.012,
  residentMemoryBytes: 80_000_000,
  dbFileBytes: 73_728,
  joinFailIps: 4,
};
const build = { version: '9.8.7', commit: 'abc"1\\2' };

describe('错误文本对应的错误码（04-api.md 第 8 节）', () => {
  it('表中的文本按表对应；落子被拒的提示为 game.illegal-move；表外的为 other', () => {
    expect(
      ['服务器繁忙，请稍后再试', '服务器房间已满，请稍后再试', '服务器出现问题，请稍后再试', '请先等对方回应', '排位赛不能再来一局'].map(errorCode),
    ).toEqual(['server.full', 'server.full', 'server.internal', 'game.awaiting-reply', 'game.rematch-ranked']);
    expect([rejectText('ko'), rejectText('renju-33')].map(errorCode)).toEqual(['game.illegal-move', 'game.illegal-move']);
    expect([errorCode('别的提示'), errorCode('toString'), errorCode('constructor')]).toEqual(['other', 'other', 'other']);
  });
});

describe('Prometheus 文本格式', () => {
  it('每个指标族只写一次 HELP 与 TYPE；标签值转义；未发生的计数器为 0', () => {
    const metrics = new Metrics(build);
    metrics.inc('yi_messages_total', { type: 'move' });
    metrics.inc('yi_messages_total', { type: 'move' }, 2);
    metrics.inc('yi_messages_total', { type: 'ping' });
    const text = metrics.render(GAUGES);
    const lines = text.trimEnd().split('\n');
    expect(lines.filter(line => line.startsWith('# TYPE yi_messages_total'))).toEqual(['# TYPE yi_messages_total counter']);
    expect(lines).toContain(`yi_build_info{version="9.8.7",commit="abc\\"1\\\\2",proto="${PROTO_VERSION}"} 1`);
    expect(lines).toContain('yi_messages_total{type="move"} 3');
    expect(lines).toContain('yi_messages_total{type="ping"} 1');
    expect(lines).toContain('yi_rate_limited_total 0');
    expect(lines).toContain('yi_rooms_active{kind="match",state="scoring"} 2');
    expect(lines).toContain('yi_queue_waiting{mode="ranked",type="go"} 1');
    expect(lines).toContain('yi_event_loop_lag_seconds 0.012');
    expect(lines).toContain('process_resident_memory_bytes 80000000');
    expect(lines).toContain('yi_db_file_bytes 73728');
    expect(lines).toContain('yi_join_fail_ips 4');
    expect(lines).toContain('# TYPE yi_db_file_bytes gauge');
    // 每个样本都在其指标族的 HELP、TYPE 之后
    const families = lines.filter(line => line.startsWith('# TYPE ')).map(line => line.split(' ')[2] ?? '');
    expect(new Set(families).size).toBe(families.length);
    for (const line of lines.filter(item => !item.startsWith('#'))) expect(families.some(family => line.startsWith(family))).toBe(true);
  });

  it('直方图的桶为累计值，另有 +Inf、总和与次数', () => {
    const metrics = new Metrics(build);
    for (const seconds of [0.0005, 0.001, 0.003, 0.02, 0.5]) metrics.observe('yi_message_handle_seconds', seconds);
    const lines = metrics.render(GAUGES).split('\n');
    expect(lines.filter(line => line.startsWith('yi_message_handle_seconds'))).toEqual([
      'yi_message_handle_seconds_bucket{le="0.001"} 2',
      'yi_message_handle_seconds_bucket{le="0.005"} 3',
      'yi_message_handle_seconds_bucket{le="0.01"} 3',
      'yi_message_handle_seconds_bucket{le="0.05"} 4',
      'yi_message_handle_seconds_bucket{le="0.1"} 4',
      'yi_message_handle_seconds_bucket{le="+Inf"} 5',
      'yi_message_handle_seconds_sum 0.5245',
      'yi_message_handle_seconds_count 5',
    ]);
    expect(lines.filter(line => line.startsWith('# TYPE yi_message_handle_seconds'))).toEqual(['# TYPE yi_message_handle_seconds histogram']);
  });

  it('快照与文本格式中的样本一致', () => {
    const metrics = new Metrics(build);
    metrics.inc('yi_errors_total', { code: 'server.full' });
    const snapshot = metrics.snapshot(GAUGES);
    const samples = metrics
      .render(GAUGES)
      .trimEnd()
      .split('\n')
      .filter(line => !line.startsWith('#'))
      .map(line => [line.slice(0, line.lastIndexOf(' ')), Number(line.slice(line.lastIndexOf(' ') + 1))]);
    expect(snapshot).toEqual(Object.fromEntries(samples));
    expect(snapshot['yi_errors_total{code="server.full"}']).toBe(1);
  });
});

describe('数据库事务耗时的直方图', () => {
  it('与消息处理耗时各自累计，互不计入', () => {
    const metrics = new Metrics(build);
    metrics.observe('yi_db_transaction_seconds', 0.002);
    metrics.observe('yi_db_transaction_seconds', 0.2);
    const lines = metrics.render(GAUGES).split('\n');
    expect(lines.filter(line => line.startsWith('yi_db_transaction_seconds'))).toEqual([
      'yi_db_transaction_seconds_bucket{le="0.001"} 0',
      'yi_db_transaction_seconds_bucket{le="0.005"} 1',
      'yi_db_transaction_seconds_bucket{le="0.01"} 1',
      'yi_db_transaction_seconds_bucket{le="0.05"} 1',
      'yi_db_transaction_seconds_bucket{le="0.1"} 1',
      'yi_db_transaction_seconds_bucket{le="+Inf"} 2',
      'yi_db_transaction_seconds_sum 0.202',
      'yi_db_transaction_seconds_count 2',
    ]);
    expect(lines).toContain('yi_message_handle_seconds_count 0');
    expect(lines.filter(line => line.startsWith('# TYPE yi_db_transaction_seconds'))).toEqual(['# TYPE yi_db_transaction_seconds histogram']);
  });
});

describe('事件循环延迟', () => {
  it('p99 减去 20 毫秒的采样周期，换算为秒；没有样本时为 0，不为负', () => {
    const histogram = (count: number, p99Ns: number) => ({ count, percentile: (p: number) => (p === 99 ? p99Ns : NaN) });
    expect(lagSeconds(histogram(10, 25e6))).toBeCloseTo(0.005, 9); // 采样间隔 25 毫秒：延迟 5 毫秒
    expect(lagSeconds(histogram(10, 15e6))).toBe(0);
    expect(lagSeconds(histogram(0, 25e6))).toBe(0);
  });
});
