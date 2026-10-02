/** 时钟（秒）。平时是真实时间；测试里可以换成手动推进的时钟 */
let override: (() => number) | null = null;

export const now = (): number => (override ? override() : performance.now() / 1000);

export function setClock(fn: (() => number) | null) {
  override = fn;
}
