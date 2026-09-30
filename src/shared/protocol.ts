/**
 * 联机协议（客户端与服务端共用）。传输：WebSocket，每条消息一个 JSON 对象，t 为类型。
 *
 * 三种开局方式：
 *   匹配 / 排位：进入队列，服务端把同一队列里等得最久的弈者与你配对，双方确认后开局；排位的胜负计入段位分
 *   好友：开房间得到四位房号，好友输入房号即开局
 */

export const PROTO_VERSION = 3;
export const PROTO_PORT = 8443;
export const NAME_MAX = 16;          // 昵称最多几个字
export const UNDO_LIMIT = 3;         // 每局每人最多申请悔棋次数
export const DRAW_LIMIT = 3;         // 每局每人最多求和次数
export const ASK_SECS = 20;          // 申请无人回应多久后视为拒绝
export const GRACE_SECS = 60;        // 掉线后保留对局的时间
export const IDLE_SECS = 35;         // 多久没收到任何消息就判定连接已断
export const PING_SECS = 10;         // 客户端心跳间隔
export const SILENT_SECS = 25;       // 客户端多久没收到服务端的任何消息（含心跳回应）就判定连接已断
export const CONFIRM_SECS = 15;      // 匹配成功后双方确认的时限

export type QueueMode = 'match' | 'ranked';
/** 一局的来历：匹配、排位、好友房间 */
export type GameKind = QueueMode | 'friend';

/** 匹配与排位的对局设置：五子棋 15 路（禁手）每步 30 秒；围棋每步 60 秒，排位固定 19 路 */
export function queueRules(mode: QueueMode, type: number, size: number) {
  const t = type ? 1 : 0;
  const s = t === 0 ? 15 : mode === 'ranked' ? 19 : size === 9 || size === 13 ? size : 19;
  return { type: t, size: s, renju: t === 0, moveTime: t === 0 ? 30 : 60 };
}

// ---------------- 段位 ----------------

export const START_POINTS = 1200;
/** 段位从低到高：十级 … 一级、初段 … 九段 */
export const RANKS = ['十级', '九级', '八级', '七级', '六级', '五级', '四级', '三级', '二级', '一级',
  '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段'];
/** 段位分 → 段位序号（每 60 分一档，起始 1200 分为四级） */
export const rankIndex = (points: number) => Math.max(0, Math.min(RANKS.length - 1, Math.floor((points - 840) / 60)));
export const rankName = (points: number) => RANKS[rankIndex(points)];

export interface Rating { points: number; win: number; loss: number; draw: number }
export interface Ratings { gomoku: Rating; go: Rating }
export const newRating = (): Rating => ({ points: START_POINTS, win: 0, loss: 0, draw: 0 });

export type AskKind = 'undo' | 'draw' | 'rematch';
export type OverReason = 'five' | 'full' | 'score' | 'resign' | 'timeout' | 'disconnect' | 'draw' | 'left';

/** 对局动作（重连时回放）：M 落子 P 停着 U 悔棋 K 标记死子 R 恢复对局 */
export type Act = { k: 'M'; x: number; y: number } | { k: 'P' } | { k: 'U'; n: number } | { k: 'K'; x: number; y: number } | { k: 'R' };

/** 客户端 → 服务端 */
export type C2S =
  | { t: 'hello'; v: number; name: string; uid: string; token?: string }   // uid：本机的匿名身份（段位跟着它）；token：断线重连
  | { t: 'ping' }
  | { t: 'name'; name: string }                                 // 改名（不在对局中时）
  | { t: 'queue'; mode: QueueMode; type: number; size: number } // 开始匹配 / 排位
  | { t: 'unqueue' }                                            // 取消匹配
  | { t: 'confirm'; ok: boolean }                               // 找到对手后接受 / 拒绝
  | { t: 'create'; type: number; size: number; hostColor: number; renju: boolean; moveTime: number }   // 开好友房间
  | { t: 'close' }                                              // 关闭尚未开始的房间
  | { t: 'join'; code: string }                                 // 用房号加入好友房间
  | { t: 'move'; x: number; y: number }
  | { t: 'pass' }
  | { t: 'undo' }
  | { t: 'draw' }
  | { t: 'rematch' }
  | { t: 'reply'; kind: AskKind; ok: boolean }                  // 回应对方的申请
  | { t: 'resign' }
  | { t: 'mark'; x: number; y: number }                         // 点目时标记 / 取消死子
  | { t: 'agree' }
  | { t: 'resume' }
  | { t: 'leave' };                                             // 离开房间（对局中离开即认输）

/** 对手的名字；排位时带上段位分 */
export interface Opponent { name: string; points?: number }

/** 服务端 → 客户端 */
export type S2C =
  | { t: 'welcome'; id: number; token: string; ratings: Ratings; latest?: string; url?: string }   // latest / url：最新版本号与下载地址（服务端配置了才有）
  | { t: 'resumeFailed' }                                          // 带令牌重连，但原来的对局已经不在了（服务器重启或掉线太久）
  | { t: 'pong' }
  | { t: 'queued'; mode: QueueMode; type: number; size: number }   // 已进入队列
  | { t: 'found'; opp: Opponent; secs: number }                    // 找到对手，等双方确认
  | { t: 'accepted' }                                              // 对方已接受
  | { t: 'unmatched'; requeued: boolean; reason: string }          // 这次配对作罢；requeued 表示已自动继续匹配
  | { t: 'created'; code: string }
  | { t: 'joinNo'; reason: string }
  | { t: 'start'; kind: GameKind; color: number; type: number; size: number; renju: boolean; moveTime: number; black: Opponent; white: Opponent }
  | { t: 'moved'; x: number; y: number }
  | { t: 'passed' }
  | { t: 'turn'; color: number; secs: number }                  // 新的一手开始计时（不限时为 -1）
  | { t: 'ask'; kind: AskKind }
  | { t: 'answer'; kind: AskKind; ok: boolean }
  | { t: 'undone'; n: number }
  | { t: 'marked'; x: number; y: number }
  | { t: 'agreed'; color: number }
  | { t: 'resumed' }
  | { t: 'over'; winner: number; reason: OverReason }
  | { t: 'rated'; type: number; rating: Rating; delta: number } // 排位结束后自己的新段位分
  | { t: 'peer'; online: boolean; wait?: number }              // 对方掉线 / 回来
  | { t: 'left' }                                               // 对方离开房间（终局后）
  | { t: 'sync'; acts: Act[] }                                  // 重连时回放整局
  | { t: 'info'; text: string }
  | { t: 'error'; text: string };

/** 名字里的控制字符换成空格，截到上限 */
export function cleanName(s: unknown, fallback: string) {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const out = Array.from(t).slice(0, NAME_MAX).join('').trim();
  return out || fallback;
}
