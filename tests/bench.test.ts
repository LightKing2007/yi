/** 性能基准（scripts/bench-entry.ts）的统计：按最近秩法取百分位，保留两位小数 */
import { describe, expect, it } from 'vitest';
import { stats } from '../scripts/bench-entry';

describe('性能基准的统计', () => {
  it('按最近秩法取百分位，与输入顺序无关', () => {
    const times = Array.from({ length: 100 }, (_, i) => 100 - i); // 100、99……1
    expect(stats(times)).toEqual({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
  });

  it('保留两位小数；没有数据时各项为 0', () => {
    expect(stats([1.23456])).toEqual({ count: 1, p50: 1.23, p95: 1.23, p99: 1.23, max: 1.23 });
    expect(stats([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});
