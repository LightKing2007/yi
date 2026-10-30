/** 采样边界使用假时钟验证，不以机器快慢作为断言。 */
import { expect, it } from 'vitest';
import { sampleHttp, sampleSync } from '../scripts/bench-sampling';

it('同步采样排除预热并保留每次操作的耗时', () => {
  let clock = 0;
  let calls = 0;
  const times = sampleSync(
    () => {
      clock += ++calls;
    },
    { count: 3, warmup: 2, now: () => clock },
  );
  expect(times).toEqual([3, 4, 5]);
  expect(calls).toBe(5);
});

it('HTTP 采样等待完整正文并排除预热', async () => {
  let clock = 0;
  let calls = 0;
  const urls: string[] = [];
  const times = await sampleHttp('/download/', { count: 2, warmup: 1, now: () => clock }, async url => {
    urls.push(url);
    clock += ++calls;
    return {
      status: 200,
      arrayBuffer: async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        clock += 10;
        return new ArrayBuffer(0);
      },
    };
  });
  expect(times).toEqual([12, 13]);
  expect(urls).toEqual(['/download/', '/download/', '/download/']);
});

it('HTTP 预热和正式采样均拒绝错误响应', async () => {
  for (const warmup of [0, 1]) {
    await expect(
      sampleHttp('/', { count: 1, warmup, now: () => 0 }, async () => ({
        status: 503,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    ).rejects.toThrow('HTTP 503');
  }
});

it('同步和 HTTP 采样拒绝非法规模且不执行工作', async () => {
  let calls = 0;
  for (const values of [
    { count: 0, warmup: 0 },
    { count: 1.5, warmup: 0 },
    { count: 1, warmup: -1 },
  ]) {
    const opt = { ...values, now: () => 0 };
    expect(() =>
      sampleSync(() => {
        calls++;
      }, opt),
    ).toThrow('采样规模不合法');
    await expect(
      sampleHttp('/', opt, async () => {
        calls++;
        return { status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
      }),
    ).rejects.toThrow('采样规模不合法');
  }
  expect(calls).toBe(0);
});
