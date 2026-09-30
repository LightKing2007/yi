/** 不合法着法的提示文字：中文原文（界面经 T() 翻译；v3 协议的服务端直接把原文发给客户端） */
import type { Reject } from '../core/move';

const TEXT: Record<Reject, string> = {
  'over': '对局已经结束',
  'scoring': '正在点目',
  'off-board': '这里不能落子',
  'occupied': '这里不能落子',
  'suicide': '禁着点：不可自杀',
  'ko': '劫争：此处暂不可提，请先在别处落子',
  'renju-overline': '禁手：黑棋不能下长连',
  'renju-44': '禁手：黑棋不能下四四',
  'renju-33': '禁手：黑棋不能下三三',
  'pass-not-allowed': '五子棋不能停一手',
};

export const rejectText = (why: Reject) => TEXT[why];
