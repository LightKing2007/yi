/** 性能基准的采样边界：预热不计入样本，HTTP 只统计完整读取的成功响应；测试注入时钟与网络（TST-020）。 */

/** 采样规模与单调时钟；count 为正整数，warmup 为非负整数，now 返回毫秒。 */
export interface Sampling {
  count: number;
  warmup: number;
  now: () => number;
}

/** HTTP 请求边界：只需要状态码和读取完整响应体，测试无须访问外网。 */
export type BenchRequest = (url: string) => Promise<Pick<Response, 'status' | 'arrayBuffer'>>;

/** 拒绝没有有效样本或无法终止的规模，避免生成看似成功的空报告。 */
function validate({ count, warmup }: Sampling) {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(warmup) || warmup < 0) {
    throw new Error(`基准采样规模不合法：count=${count}，warmup=${warmup}`);
  }
}

/** 对同步操作预热后独立采样，返回 count 个毫秒耗时；不改变业务时钟。 */
export function sampleSync(work: () => void, opt: Sampling): number[] {
  validate(opt);
  for (let i = 0; i < opt.warmup; i++) work();
  const times: number[] = [];
  for (let i = 0; i < opt.count; i++) {
    const start = opt.now();
    work();
    times.push(opt.now() - start);
  }
  return times;
}

const HTTP_OK = 200;

/** 完整读取一次 HTTP 响应；非 200 状态拒绝计入基准，预热同样检查。 */
async function readResponse(url: string, request: BenchRequest) {
  const response = await request(url);
  await response.arrayBuffer();
  if (response.status !== HTTP_OK) throw new Error(`基准请求 ${url} 返回 HTTP ${response.status}，期望 ${HTTP_OK}`);
}

/** HTTP 预热后采样；每项包含连接、响应及完整读取正文的时间。 */
export async function sampleHttp(url: string, opt: Sampling, request: BenchRequest = fetch): Promise<number[]> {
  validate(opt);
  for (let i = 0; i < opt.warmup; i++) await readResponse(url, request);
  const times: number[] = [];
  for (let i = 0; i < opt.count; i++) {
    const start = opt.now();
    await readResponse(url, request);
    times.push(opt.now() - start);
  }
  return times;
}
