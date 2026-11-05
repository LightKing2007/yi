/** 服务端下发的错误码转为提示原文（API-020、API-024）：显示时再经 T() 换成当前语言。 */
import type { Reject } from '../core/move';
import { ERRORS } from '../shared/errors';
import type { ErrorParams } from '../shared/protocol';
import { rejectText } from '../shared/reject';

/** 禁着原因（game.illegal-move 的 params.reject） */
const REJECTS: Record<Reject, true> = {
  over: true,
  scoring: true,
  'off-board': true,
  occupied: true,
  suicide: true,
  ko: true,
  'renju-overline': true,
  'renju-44': true,
  'renju-33': true,
  'pass-not-allowed': true,
};
const isReject = (val: unknown): val is Reject => typeof val === 'string' && Object.hasOwn(REJECTS, val);

/** 错误码的提示原文：落子被拒时按禁着原因；本端不认识的错误码（更新的服务端新增的）按服务器出现问题提示 */
export function errorText(code: string, params?: ErrorParams): string {
  if (code === 'game.illegal-move') return rejectText(isReject(params?.reject) ? params.reject : 'occupied');
  const known: Record<string, { text: string }> = ERRORS;
  return known[code]?.text ?? ERRORS['server.internal'].text;
}
