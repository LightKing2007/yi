/**
 * 联机服务端各模块共用的类型：连接、段位存放处、玩家、匹配队列、配对、房间（整改项 P2-12 自 rooms.ts 拆出）。
 * 只有类型与最简单的内存存放处，不含任何逻辑；RoomServer 及拆出的各模块都从这里引用。
 */
import type { Game } from '../src/core/game';
import type { Log } from './log';
import type { Metrics } from './metrics';
import type { ConnLimits } from './ratelimit';
import type { Act, AskKind, GameKind, OverReason, QueueMode, Rating, Ratings, S2C, queueRules } from '../src/shared/protocol';

/** 一条连接：服务端只需要能发消息、能关掉。close 带关闭码（CLOSE_CODE）时按协议关闭，不带时直接切断 */
export interface Conn {
  send(msg: S2C): void;
  close(code?: number): void;
}

/** 段位分的存放处（独立服务端存到文件，测试里放内存） */
export interface RatingStore {
  get(key: string): Ratings | undefined;
  set(key: string, r: Ratings, name: string): void;
}

export class MemoryStore implements RatingStore {
  private m = new Map<string, Ratings>();
  get(key: string) {
    return this.m.get(key);
  }
  set(key: string, r: Ratings) {
    this.m.set(key, r);
  }
}

/** 房间的对局设置：棋类、路数、禁手、每步限时（与 queueRules 的结果同形） */
export type RoomRules = ReturnType<typeof queueRules>;

/** 房间的座次：hostColor 为房主执子的颜色（2 表示不指定），host 为房主的玩家号（匹配与排位为 0） */
export interface RoomSeat {
  hostColor: number;
  host: number;
}

/** 匹配队列中的一项：哪位玩家、要下的棋类与路数、何时进入队列 */
export interface QEntry {
  p: Player;
  mode: QueueMode;
  type: number;
  size: number;
  since: number;
}

/** 一次配对：双方须在 deadline 前都确认，ok 记各自是否已接受 */
export interface Match {
  mode: QueueMode;
  type: number;
  size: number;
  side: [QEntry, QEntry];
  ok: [boolean, boolean];
  deadline: number;
}

/** 一名玩家（一条连接）：握手前 id 为 0；掉线时 conn 为 null，对局中可凭令牌回来 */
export interface Player {
  id: number; // 0 表示还没握手
  conn: Conn | null; // null 表示掉线（对局中还可以用令牌回来）
  name: string;
  tokenHash: string; // 当前重连令牌的散列；服务端不保存令牌原文（SEC-022）
  prevTokenHash: string; // 重连后、对方还没确认收到新令牌时仍然有效的上一枚令牌的散列；没有时为空串
  key: string; // 段位的归属（由客户端的匿名 uid 散列而来）
  ratings: Ratings;
  lastSeen: number;
  offAt: number;
  room: number; // 所在房间号，0 表示不在房间
  queued: QEntry | null; // 正在匹配
  match: Match | null; // 已配对、等双方确认
  joinFails: number[]; // 最近几次加入房间失败的时刻
  invalid: number; // 这条连接发来的非法消息数（只记第一条的日志）
  since: number; // 连接建立的时刻（握手时限从此算起，API-042）
  limits: ConnLimits; // 消息限速、操作频率与违规累计（API-043 至 API-045）
}

/** 房间状态：等待对手、对局中（含点目）、已结束 */
export const enum RoomState {
  Wait,
  Play,
  Over,
}

/** 一个房间：好友房间或一次配对开出的对局，持有这一局的 Game 与对局中的各种状态 */
export interface Room {
  id: number;
  kind: GameKind;
  code: string; // 好友房间的房号
  state: RoomState;
  type: number;
  size: number;
  hostColor: number;
  renju: boolean;
  moveTime: number;
  host: number; // 好友房间的房主
  gameId: number; // 当前这一局的编号：再来一局时换新的，用于日志（07-operations.md 第 5.1 条）
  pid: [number, number, number]; // pid[BLACK] / pid[WHITE] 对局双方的玩家号
  who: [Player | null, Player | null, Player | null]; // 开局时的双方（排位结算用，掉线清理后也还在）
  g: Game;
  acts: Act[];
  ask: AskKind | null;
  askFrom: number;
  askUntil: number;
  undoUsed: number[];
  drawUsed: number[];
  agreed: boolean[];
  deadline: number; // 本手限时截止时刻；0 表示不计时
  paused: number; // 有人掉线时暂停计时，保存本手剩余秒数
  result: { winner: number; reason: OverReason } | null; // 终局结果（掉线期间结束的，重连时补发）
  limitNote: string | null; // 因达到上限而结束时的说明（重连时随终局结果补发）
  rated: ({ type: number; rating: Rating; delta: number } | null)[]; // 排位结算，按执子颜色
}

export interface RoomServerOptions {
  now?: () => number; // 秒
  random?: () => number;
  log?: Log;
  store?: RatingStore;
  latest?: string; // 最新的客户端版本号，随 welcome 发给客户端
  download?: string; // 新版本的下载地址
  metrics?: Metrics; // 监控指标（07-operations.md 第 9 节）：不设时不统计
}

/** 健康检查（/healthz，API-061）中由 RoomServer 提供的部分 */
export interface Health {
  players: number; // 已握手的在线玩家数
  games: number; // 已开局且未终局的对局数（含点目阶段）
  maintenance: boolean; // 是否处于维护模式（OPS-045）
}

/** 连接对象：由传输层持有，收到消息时交回 RoomServer */
export type Session = Player;
