/** 下发的错误消息（API-020）：只含错误码与按错误码表填写的级别，文字由客户端按错误码查译文表。 */
import { ERRORS, type ErrorCode } from '../src/shared/errors';
import type { ErrorMsg, ErrorParams } from '../src/shared/protocol';

/** 错误码 code 的错误消息；params、retryAfterMs、errorId 按需附加（errorId 只随 E5，API-023） */
export function errorMsg(code: ErrorCode, extra: { params?: ErrorParams; retryAfterMs?: number; errorId?: string } = {}): ErrorMsg {
  return { t: 'error', code, level: ERRORS[code].level, ...extra };
}
