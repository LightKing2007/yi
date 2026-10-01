/** 不合法着法的提示文字：中文原文（界面经 T() 翻译；v3 协议的服务端直接把原文发给客户端） */
import type { Reject } from '../core/move';

const TEXT: Record<Reject, string> = {
  'over': '对局已经结束',
  'scoring': '正在点目',
  'off-board': '这里不能落子',
  'occupied': '这里不能落子',
  'suicide': '这里是禁着点，落下后没有气',
  'ko': '打劫时不能马上提回，请先在别处下一手',
  'renju-overline': '黑棋不能下长连，这是禁手',
  'renju-44': '黑棋不能下四四，这是禁手',
  'renju-33': '黑棋不能下三三，这是禁手',
  'pass-not-allowed': '五子棋不能停一手',
};

export const rejectText = (why: Reject) => TEXT[why];
