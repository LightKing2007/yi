/** 不合法着法的提示文字：中文原文（界面经 T() 翻译；联机时服务端以错误码 game.illegal-move 下发原因，params.reject） */
import type { Reject } from '../core/move';

/** 禁着原因码到中文原文的映射，同时是判定的唯一来源 */
const TEXT: Record<Reject, string> = {
  over: '对局已经结束',
  scoring: '正在点目',
  'off-board': '这里不能落子',
  occupied: '这里不能落子',
  suicide: '这里是禁着点，落下后没有气',
  ko: '打劫时不能马上提回，请先在别处下一手',
  'renju-overline': '黑棋不能下长连，这是禁手',
  'renju-44': '黑棋不能下四四，这是禁手',
  'renju-33': '黑棋不能下三三，这是禁手',
  'pass-not-allowed': '五子棋不能停一手',
};

/** 不合法着法的提示文字 */
export const rejectText = (why: Reject) => TEXT[why];

/** 是否为合法的禁着原因码（联机消息的 params.reject 由外部输入给出，需先校验，API-015） */
export const isReject = (val: unknown): val is Reject => typeof val === 'string' && Object.hasOwn(TEXT, val);
