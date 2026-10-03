/** 断线后的重连策略（src/online/retry.ts）：完全抖动的指数退避（API-050），以及按关闭码区分的处理（04-api.md 第 4.2 条） */
import { describe, expect, it } from 'vitest';
import { backoffSecs, isFaultClose, retryWaitSecs } from '../src/online/retry';
import { CLOSE_CODE, GRACE_SECS, OVERLOAD_RETRY_MIN_SECS, POLICY_RETRY_SECS, RETRY_GRACE_MAX_SECS } from '../src/shared/protocol';

/** Math.random 取不到 1，最大约为 1 − 2^−53；这里取一个足够接近的值 */
const ALMOST_ONE = 1 - 1e-9;
const top = () => ALMOST_ONE;
const zero = () => 0;
const half = () => 0.5;
/** 连接异常断开（没有收到关闭帧）时浏览器给出的关闭码 */
const ABNORMAL = 1006;

describe('完全抖动的指数退避', () => {
  it('第 n 次重连前最多等 2^n 秒，到上限为止（API-050）', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(n => backoffSecs(n, 30, top).toFixed(3))).toEqual(['2.000', '4.000', '8.000', '16.000', '30.000', '30.000', '30.000']);
  });

  it('等待时间按随机数在 0 到当次上限之间取值；次数很大时不溢出', () => {
    expect(backoffSecs(3, 30, zero)).toBe(0);
    expect(backoffSecs(3, 30, half)).toBe(4);
    expect(backoffSecs(5000, 30, half)).toBe(15);
  });
});

describe('按关闭码决定是否重连、多久后重连', () => {
  it('网络故障、服务端重启、内部错误、握手或空闲超时：按退避重连，对局保留期内上限为 5 秒', () => {
    for (const code of [undefined, ABNORMAL, CLOSE_CODE.restart, CLOSE_CODE.internal, CLOSE_CODE.helloTimeout, CLOSE_CODE.idle]) {
      expect(
        [1, 2, 3, 10].map(n => retryWaitSecs(code, n, top)?.toFixed(3)),
        String(code),
      ).toEqual(['2.000', '4.000', '5.000', '5.000']);
    }
  });

  it('对局保留期内至少能尝试 12 次（API-050）', () => {
    expect(GRACE_SECS / RETRY_GRACE_MAX_SECS).toBeGreaterThanOrEqual(12);
  });

  it('正常关闭、帧内容不是合法 UTF-8、消息过大、协议版本不支持：不再重连', () => {
    for (const code of [CLOSE_CODE.normal, CLOSE_CODE.badUtf8, CLOSE_CODE.tooBig, CLOSE_CODE.version]) {
      for (const n of [1, 2, 5]) expect(retryWaitSecs(code, n, half), `${code} ${n}`).toBeNull();
    }
  });

  it('只有帧内容不是合法 UTF-8 与消息过大说明本端有缺陷，须写 error 日志', () => {
    const codes = [undefined, ABNORMAL, ...Object.values(CLOSE_CODE)];
    expect(codes.filter(isFaultClose)).toEqual([CLOSE_CODE.badUtf8, CLOSE_CODE.tooBig]);
  });

  it('因累计违规被断开：固定 30 秒后再重连，不随次数变化', () => {
    for (const n of [1, 2, 9]) expect(retryWaitSecs(CLOSE_CODE.policy, n, top)).toBe(POLICY_RETRY_SECS);
  });

  it('服务端过载：首次重连至少等 5 秒，再加上抖动；之后照常退避', () => {
    expect(retryWaitSecs(CLOSE_CODE.overload, 1, zero)).toBe(OVERLOAD_RETRY_MIN_SECS);
    expect(retryWaitSecs(CLOSE_CODE.overload, 1, top)).toBeCloseTo(OVERLOAD_RETRY_MIN_SECS + 2);
    expect(retryWaitSecs(CLOSE_CODE.overload, 2, top)).toBeCloseTo(4);
    expect(retryWaitSecs(CLOSE_CODE.overload, 2, zero)).toBe(0);
  });
});
