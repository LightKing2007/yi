/** 着法、不合法的原因（错误码）、对局结果。规则层只用这些码，文字由界面与服务端各自翻译（见 shared/reject.ts） */

export type Move = { k: 'play'; x: number; y: number } | { k: 'pass' };

export type Reject =
  | 'over' // 对局已结束
  | 'scoring' // 正在点目
  | 'off-board' // 棋盘之外
  | 'occupied' // 已有棋子
  | 'suicide' // 围棋：禁着点（自杀）
  | 'ko' // 围棋：打劫，不能立即回提
  | 'renju-overline' // 五子棋禁手：长连
  | 'renju-44' // 五子棋禁手：四四
  | 'renju-33' // 五子棋禁手：三三
  | 'pass-not-allowed'; // 五子棋不能停着

/** 对局怎样结束的（与联机协议的 OverReason 一致） */
export type EndReason = 'five' | 'full' | 'score' | 'resign' | 'timeout' | 'disconnect' | 'draw' | 'left';

/** winner：1 黑 2 白 3 和 */
export interface Result {
  winner: number;
  reason: EndReason;
}
