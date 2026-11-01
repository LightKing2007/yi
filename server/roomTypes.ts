/**
 * 联机服务端各模块共用的类型：连接、段位存放处、玩家、匹配队列、配对、房间（整改项 P2-12 自 rooms.ts 拆出）。
 * 只有类型与最简单的内存存放处，不含任何逻辑；RoomServer 及拆出的各模块都从这里引用。
 */
import type { Game } from '../src/core/game';
import type { GameRecord } from '../src/core/record';
import type { Log } from './log';
import type { Metrics } from './metrics';
import type { ConnLimits, IpCounter } from './ratelimit';
import {
  newRating,
  type Act,
  type AskKind,
  type GameKind,
  type OverReason,
  type QueueMode,
  type Rating,
  type Ratings,
  type LegacyS2C,
  type S2C,
  type queueRules,
} from '../src/shared/protocol';

/** 一条连接：服务端只需要能发消息、能关掉。close 带关闭码（CLOSE_CODE）时按协议关闭，不带时直接切断 */
export interface Conn {
  send(msg: S2C): void;
  /** 以第 3 版的格式发送一条消息，只用于提示第 3 版客户端更新（hub.ts 的 outdated）；测试中的连接可以没有 */
  sendLegacy?(msg: LegacyS2C): void;
  close(code?: number): void;
  /** 连接的真实地址（server/clientIp.ts），用于按 IP 的限制；测试中的连接可以没有 */
  readonly ip?: string;
}

/** 对局的一方：设备散列与昵称 */
export interface GameSide {
  key: string;
  name: string;
}

/** 开局时写入对局记录的信息 */
export interface GameStart {
  kind: GameKind;
  type: keyof Ratings;
  size: number;
  black: GameSide;
  white: GameSide;
}

/** 存放处中的终局原因：协议的终局原因之外，limit 为达到 API-046 的上限，aborted 为服务端放弃的对局（roadmap.md 第 5.2.2 条） */
export type StoredEndReason = OverReason | 'limit' | 'aborted';

/** 终局时写入对局记录的信息 */
export interface GameEnd {
  /** 棋谱（不含版本字段，存放处写入时加上） */
  record: GameRecord;
  /** 1 黑胜、2 白胜、3 和棋 */
  winner: number;
  reason: StoredEndReason;
}

/** 一方的结算结果 */
export interface RatedSide {
  /** 结算前（存放处中重新读取的）段位分 */
  before: number;
  rating: Rating;
  delta: number;
}

/** 双方的结算结果 */
export interface RatedPair {
  black: RatedSide;
  white: RatedSide;
}

/** 排位结算：由结算前（存放处中重新读取的）双方段位算出结算结果 */
export type Settle = (black: Rating, white: Rating) => RatedPair;

/** 段位与对局记录的存放处（独立服务端存到数据库，测试里放内存） */
export interface RatingStore {
  get(key: string): Ratings | undefined;
  set(key: string, r: Ratings, name: string): void;
  /** 玩家完成握手时调用，记下这台设备与昵称 */
  seen(key: string, name: string): void;
  /** 开局：写入对局记录，返回存放处中的对局编号 */
  startGame(start: GameStart): number;
  /** 终局：在一个事务内写入棋谱与结果；给出 settle 时重新读取双方段位、结算并写入段位与变化明细，返回结算结果（DAT-040） */
  finishGame(id: number, end: GameEnd, settle?: Settle): RatedPair | undefined;
  /** 服务端放弃了这一局（异常隔离）：记为 aborted、和棋、不计段位 */
  abortGame(id: number): void;
}

/** 放在内存中的段位存放处：测试使用，进程退出即丢失；对局记录只保留双方，用于结算 */
export class MemoryStore implements RatingStore {
  private m = new Map<string, Ratings>();
  private games = new Map<number, GameStart>();
  get(key: string) {
    return this.m.get(key);
  }
  set(key: string, r: Ratings) {
    this.m.set(key, r);
  }
  seen() {} // 内存中不记录设备与昵称
  startGame(start: GameStart) {
    this.games.set(this.games.size + 1, start);
    return this.games.size;
  }
  finishGame(id: number, _end: GameEnd, settle?: Settle) {
    const game = this.games.get(id);
    if (!game || !settle) return undefined;
    const ratingsOf = (side: GameSide) => this.m.get(side.key) ?? { gomoku: newRating(), go: newRating() };
    const black = ratingsOf(game.black),
      white = ratingsOf(game.white);
    const rated = settle(black[game.type], white[game.type]);
    this.m.set(game.black.key, { ...black, [game.type]: rated.black.rating });
    this.m.set(game.white.key, { ...white, [game.type]: rated.white.rating });
    return rated;
  }
  abortGame() {} // 内存中不保留终局
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
  rated: ({ type: number; rating: Rating; delta: number } | null)[]; // 排位结算，按执子颜色
  recordId: number; // 存放处中这一局的对局编号；0 表示没有记录（写入失败）
  turnAt: number; // 这一手开始的时刻（秒），用于每手用时
  turnPly: number; // 这一手开始时的手数；悔棋或落子使手数变化时重新计时
}

/** RoomServer 的可选依赖：时钟、随机数、日志、段位存放处、新版本信息与监控指标，测试中可替换 */
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

/**
 * RoomServer 交给拆出的各模块的上下文（整改项 P2-12）：各模块经它读写共用的状态、调用共用的方法，
 * 不直接引用 RoomServer。随模块逐个拆出而增加成员
 */
export interface ServerContext {
  /** 段位存放处 */
  readonly store: RatingStore;
  /** 日志（07-operations.md 第 5 节） */
  readonly log: Log;
  /** 时钟（秒） */
  readonly now: () => number;
  /** 随机数，[0, 1) */
  readonly random: () => number;
  /** 全部玩家（含尚未握手的） */
  readonly players: Set<Player>;
  /** 房间号 → 房间 */
  readonly rooms: Map<number, Room>;
  /** 匹配队列，按进入的先后排列 */
  readonly queue: QEntry[];
  /** 已配对、等双方确认的配对 */
  readonly matches: Set<Match>;
  /** 是否处于维护模式（OPS-045）：不再开始新的对局 */
  readonly maintenance: boolean;
  /** 监控指标（07-operations.md 第 9 节）；不统计时为 undefined */
  readonly metrics: Metrics | undefined;
  /** 下一个房间号：开房间时取用并加一 */
  nextRoom: number;
  /** 下一个对局编号：每开一局取用并加一（日志用，07-operations.md 第 5.1 条） */
  nextGame: number;
  /** 下一个玩家号：握手时取用并加一 */
  nextPlayer: number;
  /** 令牌散列 → 玩家：重连时按令牌查找（SEC-022）。只含已握手的玩家 */
  readonly byToken: Map<string, Player>;
  /** 因累计违规被断开的匿名身份（散列）→ 解除的时刻（API-045） */
  readonly banned: Map<string, number>;
  /** 按 IP 统计的加入房间失败次数（API-044、原问题 A6）：与每条连接的计数并存，重新连接不清零 */
  readonly joinFailsByIp: IpCounter;
  /** 随 welcome 下发的最新版本号与下载地址；服务端没有配置时为空对象 */
  readonly latest: { latest?: string; url?: string };
  /** 尚未握手的连接数 */
  pending(): number;
  /** 连接断开：按断线处理（对局中保留席位）；conn 不是玩家当前的连接时忽略 */
  disconnect(p: Player, conn?: Conn, code?: number): void;
  /** 给玩家发一条消息；玩家不存在或已掉线时不发，错误提示计入监控指标 */
  send(p: Player | null | undefined, msg: S2C): void;
  /** 开一个房间（还没有人入座） */
  newRoom(kind: GameKind, rules: RoomRules, seat: RoomSeat): Room;
  /** 两名玩家入座并开局：first 执 firstColor */
  seatPlayers(r: Room, first: Player, second: Player, firstColor: number): void;
}

/** 连接对象：由传输层持有，收到消息时交回 RoomServer */
export type Session = Player;
