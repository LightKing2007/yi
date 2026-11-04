/** 服务端下发的错误码转为提示原文（API-020、API-024）：显示时再经 T() 换成当前语言。 */
import { ERRORS } from '../shared/errors';
import type { ErrorParams } from '../shared/protocol';
import { isReject, rejectText } from '../shared/reject';

/** 错误码的提示原文：落子被拒时按禁着原因；本端不认识的错误码（更新的服务端新增的）按服务器出现问题提示 */
export function errorText(code: string, params?: ErrorParams): string {
  if (code === 'game.illegal-move') return rejectText(isReject(params?.reject) ? params.reject : 'occupied');
  const known: Record<string, { text: string }> = ERRORS;
  return known[code]?.text ?? ERRORS['server.internal'].text;
}
