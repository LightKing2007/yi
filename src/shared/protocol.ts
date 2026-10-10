/**
 * 联机协议（客户端与服务端共用）。传输：WebSocket，每条消息一个 JSON 对象，t 为类型。
 *
 * 三种开局方式：
 *   匹配 / 排位：进入队列，服务端把同一队列里等得最久的弈者与你配对，双方确认后开局；排位的胜负计入段位分
 *   好友：开房间得到四位房号，好友输入房号即开局
 */

export const PROTO_VERSION = 3;
export const PROTO_PORT = 8443;
export const NAME_MAX = 16; // 昵称最多几个字素（I18N-030）
/** 新版本号的格式（welcome.latest）：数字、字母与 `.+-`，最长 32 个字符；服务端按配置原样下发，比较大小由客户端的 newerVersion 负责 */
export const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;
/** 新版本下载地址的格式（welcome.url）：只接受 http(s) 地址，最长 2048 个字符（客户端只用系统浏览器打开这种地址） */
export const DOWNLOAD_URL_PATTERN = /^https?:\/\/[^\s]{1,2040}$/;
/** 本机匿名身份 uid 的格式（API-013）；不合格式的 hello 被服务端拒绝 */
export const UID_PATTERN = /^[0-9A-Za-z-]{16,64}$/;
export const UNDO_LIMIT = 3; // 每局每人最多申请悔棋次数
export const DRAW_LIMIT = 3; // 每局每人最多求和次数
export const ASK_SECS = 20; // 申请无人回应多久后视为拒绝
export const GRACE_SECS = 60; // 掉线后保留对局的时间
export const IDLE_SECS = 35; // 多久没收到任何消息就判定连接已断
export const PING_SECS = 10; // 客户端心跳间隔
export const SILENT_SECS = 25; // 客户端多久没收到服务端的任何消息（含心跳回应）就判定连接已断
export const CONFIRM_SECS = 15; // 匹配成功后双方确认的时限
/** 连接建立后多久内必须完成握手（发来合法的 hello），否则以 CLOSE_CODE.helloTimeout 关闭（API-042） */
export const HELLO_SECS = 10;
/** 客户端发起连接后多久还没连上就放弃这次连接（API-051） */
export const CONNECT_SECS = 8;
/** 重连上以后多久内应收到原来的对局（start 与 sync）：老版本服务端找不回对局时什么也不说，过时即视为对局已不在 */
export const RESUME_WAIT_SECS = 3;
/** 重连退避的基数（API-050）：第 n 次重连前等待 random(0, min(上限, RETRY_BASE_SECS × 2^n)) 秒 */
export const RETRY_BASE_SECS = 1;
/** 对局保留期内重连退避的上限：GRACE_SECS 内至少能尝试 GRACE_SECS / RETRY_GRACE_MAX_SECS = 12 次（API-050） */
export const RETRY_GRACE_MAX_SECS = 5;
/** 连接保持这么久以后，重连次数归零（API-050） */
export const RETRY_RESET_SECS = 60;
/** 因累计违规被断开（CLOSE_CODE.policy）后，等这么久再重连（04-api.md 第 4.2 条） */
export const POLICY_RETRY_SECS = 30;
/** 因服务端过载被断开（CLOSE_CODE.overload）后，首次重连至少等这么久（04-api.md 第 4.2 条） */
export const OVERLOAD_RETRY_MIN_SECS = 5;
/** 每局记录的对局动作（重连时以 sync 回放）最多几条；服务端超出后不再记录，客户端收到更长的 sync 按非法消息丢弃 */
export const ACTS_MAX = 4096;
/** over.winner 与对局胜方取这个值时表示和棋（1 黑胜，2 白胜） */
export const DRAWN = 3;

/**
 * WebSocket 关闭码（04-api.md 第 4.2 条，严禁使用表外的关闭码）：客户端据此决定是否重连、多久后重连。
 * 3.0 起的 4001 至 4003 随账号系统加入
 */
export const CLOSE_CODE = {
  normal: 1000, // 正常关闭（玩家离开联机页面），不重连
  restart: 1001, // 服务端重启或维护
  badUtf8: 1007, // 帧内容不是合法 UTF-8
  policy: 1008, // 累计违规达到上限（API-045），30 秒后再重连
  tooBig: 1009, // 消息过大（API-002）
  internal: 1011, // 服务端内部错误
  overload: 1013, // 服务端满员，或同一 IP 的连接过多、新建过频（API-040、API-041）
  version: 4000, // 协议版本不支持
  helloTimeout: 4008, // 握手超时（API-042）
  idle: 4009, // 空闲超时
} as const;

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
export const RANKS = [
  '十级',
  '九级',
  '八级',
  '七级',
  '六级',
  '五级',
  '四级',
  '三级',
  '二级',
  '一级',
  '初段',
  '二段',
  '三段',
  '四段',
  '五段',
  '六段',
  '七段',
  '八段',
  '九段',
];
/** 段位分 → 段位序号（每 60 分一档，起始 1200 分为四级） */
export const rankIndex = (points: number) => Math.max(0, Math.min(RANKS.length - 1, Math.floor((points - 840) / 60)));
/** 第 i 段的名称；i 由 rankIndex 限定在表内，取不到时为空 */
export const rankAt = (i: number) => RANKS[i] ?? '';
export const rankName = (points: number) => rankAt(rankIndex(points));

export interface Rating {
  points: number;
  win: number;
  loss: number;
  draw: number;
}
export interface Ratings {
  gomoku: Rating;
  go: Rating;
}
export const newRating = (): Rating => ({ points: START_POINTS, win: 0, loss: 0, draw: 0 });

export type AskKind = 'undo' | 'draw' | 'rematch';
export type OverReason = 'five' | 'full' | 'score' | 'resign' | 'timeout' | 'disconnect' | 'draw' | 'left';

/** 对局动作（重连时回放）：M 落子 P 停着 U 悔棋 K 标记死子 R 恢复对局 */
export type Act = { k: 'M'; x: number; y: number } | { k: 'P' } | { k: 'U'; n: number } | { k: 'K'; x: number; y: number } | { k: 'R' };

/** 客户端 → 服务端 */
export type C2S =
  | { t: 'hello'; v: number; name: string; uid: string; token?: string } // uid：本机的匿名身份（段位跟着它）；token：断线重连
  | { t: 'ping' }
  | { t: 'name'; name: string } // 改名（不在对局中时）
  | { t: 'queue'; mode: QueueMode; type: number; size: number } // 开始匹配 / 排位
  | { t: 'unqueue' } // 取消匹配
  | { t: 'confirm'; ok: boolean } // 找到对手后接受 / 拒绝
  | { t: 'create'; type: number; size: number; hostColor: number; renju: boolean; moveTime: number } // 开好友房间
  | { t: 'close' } // 关闭尚未开始的房间
  | { t: 'join'; code: string } // 用房号加入好友房间
  | { t: 'move'; x: number; y: number }
  | { t: 'pass' }
  | { t: 'undo' }
  | { t: 'draw' }
  | { t: 'rematch' }
  | { t: 'reply'; kind: AskKind; ok: boolean } // 回应对方的申请
  | { t: 'resign' }
  | { t: 'mark'; x: number; y: number } // 点目时标记 / 取消死子
  | { t: 'agree' }
  | { t: 'resume' }
  | { t: 'leave' }; // 离开房间（对局中离开即认输）

/** 对手的名字；排位时带上段位分 */
export interface Opponent {
  name: string;
  points?: number;
}

/** 服务端 → 客户端 */
export type S2C =
  // token：重连令牌，每次重连成功都换发新的一枚（SEC-020），以最近收到的为准；latest / url：最新版本号与下载地址（服务端配置了才有）
  | { t: 'welcome'; id: number; token: string; ratings: Ratings; latest?: string; url?: string }
  | { t: 'resumeFailed' } // 带令牌重连，但原来的对局已经不在了（服务器重启或掉线太久）
  | { t: 'pong' }
  | { t: 'queued'; mode: QueueMode; type: number; size: number } // 已进入队列
  | { t: 'found'; opp: Opponent; secs: number } // 找到对手，等双方确认
  | { t: 'accepted' } // 对方已接受
  | { t: 'unmatched'; requeued: boolean; reason: string } // 这次配对作罢；requeued 表示已自动继续匹配
  | { t: 'created'; code: string }
  | { t: 'joinNo'; reason: string }
  | { t: 'start'; kind: GameKind; color: number; type: number; size: number; renju: boolean; moveTime: number; black: Opponent; white: Opponent }
  | { t: 'moved'; x: number; y: number }
  | { t: 'passed' }
  | { t: 'turn'; color: number; secs: number } // 新的一手开始计时（不限时为 -1）
  | { t: 'ask'; kind: AskKind }
  | { t: 'answer'; kind: AskKind; ok: boolean }
  | { t: 'undone'; n: number }
  | { t: 'marked'; x: number; y: number }
  | { t: 'agreed'; color: number }
  | { t: 'resumed' }
  | { t: 'over'; winner: number; reason: OverReason }
  | { t: 'rated'; type: number; rating: Rating; delta: number } // 排位结束后自己的新段位分
  | { t: 'peer'; online: boolean; wait?: number } // 对方掉线 / 回来
  | { t: 'left' } // 对方离开房间（终局后）
  | { t: 'sync'; acts: Act[] } // 重连时回放整局
  | { t: 'info'; text: string }
  | { t: 'error'; text: string; errorId?: string }; // errorId：服务端内部错误（E5）的错误编号，与服务端日志对照（API-023）

/** 昵称中删除的字符：控制符、格式符（含双向控制符、零宽字符）、代理项、私用区、行与段分隔符（API-014） */
const NAME_STRIP = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 按字素（UAX #29）截到 NAME_MAX 个，不改动其他字符；输入框边输入边截，与 cleanName 计数一致（I18N-030） */
export function clipName(s: string) {
  let out = '',
    n = 0;
  for (const { segment } of graphemes.segment(s)) {
    if (n++ >= NAME_MAX) break;
    out += segment;
  }
  return out;
}

/**
 * 昵称清洗（API-014）：NFC 规范化 → 删除控制与格式字符 → 合并连续空白 → 去除首尾空白 → 按字素截到 NAME_MAX 个。
 * 不是字符串或清洗后为空时返回 fallback。客户端发送前与服务端收到后各清洗一次
 */
export function cleanName(s: unknown, fallback: string) {
  if (typeof s !== 'string') return fallback;
  const t = s.normalize('NFC').replace(NAME_STRIP, '').replace(/\s+/gu, ' ').trim();
  return clipName(t).trim() || fallback;
}
