/**
 * 断线后的重连策略：按关闭码决定是否重连、多久后重连（04-api.md 第 4.2 条），重连间隔为带完全抖动的指数退避（API-050）。
 * 纯函数，随机数由调用方传入，测试时可以固定。
 */
import { CLOSE_CODE, OVERLOAD_RETRY_MIN_SECS, POLICY_RETRY_SECS, RETRY_BASE_SECS, RETRY_GRACE_MAX_SECS } from '../shared/protocol';

/** 不再重连的关闭码：正常关闭、帧内容不是合法 UTF-8、消息过大、协议版本不支持 */
const NO_RETRY: readonly number[] = [CLOSE_CODE.normal, CLOSE_CODE.badUtf8, CLOSE_CODE.tooBig, CLOSE_CODE.version];

/** 该关闭码说明本端发出的数据有问题（不是合法 UTF-8，或消息过大），须写 error 日志供维护者排查 */
export const isFaultClose = (code?: number) => code === CLOSE_CODE.badUtf8 || code === CLOSE_CODE.tooBig;

/** 第 attempt 次（从 1 起）重连前的等待秒数：random(0, min(capSecs, RETRY_BASE_SECS × 2^attempt))，即完全抖动的指数退避 */
export function backoffSecs(attempt: number, capSecs: number, random: () => number) {
  return random() * Math.min(capSecs, RETRY_BASE_SECS * 2 ** attempt);
}

/**
 * 对局中断线后，第 attempt 次（从 1 起）重连前等多少秒；该关闭码不应重连时返回 null。
 * code 为空表示连接建不起来或连接超时，按网络故障处理。只有对局保留期内会自动重连，所以退避上限取 RETRY_GRACE_MAX_SECS
 */
export function retryWaitSecs(code: number | undefined, attempt: number, random: () => number): number | null {
  if (code !== undefined && NO_RETRY.includes(code)) return null;
  if (code === CLOSE_CODE.policy) return POLICY_RETRY_SECS;
  const wait = backoffSecs(attempt, RETRY_GRACE_MAX_SECS, random);
  // 过载时首次重连至少等 OVERLOAD_RETRY_MIN_SECS，再加上抖动，免得被断开的客户端同时涌回
  return code === CLOSE_CODE.overload && attempt === 1 ? OVERLOAD_RETRY_MIN_SECS + wait : wait;
}
