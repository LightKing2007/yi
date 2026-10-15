/**
 * 弈 · 联机服务端核心：匹配 / 排位队列、配对确认、好友房间、对局、段位与超时。与传输无关（WebSocket 由 host.ts 接上）。
 *
 * 对局规则直接复用 src/core/game.ts：每个房间一份 Game，客户端发来的每一手都在这里校验，
 * 所以服务端与客户端的判定完全一致。协议见 src/shared/protocol.ts。
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { rejectText } from '../src/shared/reject';
import { BLACK, GameType, WHITE, other } from '../src/core/types';
import { isInvalid, parseC2S, type Invalid } from '../src/shared/parse';
import type { Log, LogEntry } from './log';
import type { Metrics } from './metrics';
import { errorCode } from './metrics';
import { BAN_SECS, ConnLimits, type LimitedOp } from './ratelimit';
import {
  ASK_SECS,
  CLOSE_CODE,
  DRAWN,
  DRAW_LIMIT,
  GRACE_SECS,
  HELLO_SECS,
  IDLE_SECS,
  UNDO_LIMIT,
  cleanName,
  newRating,
  queueRules,
  type AskKind,
  type C2S,
  type QueueMode,
  type S2C,
} from '../src/shared/protocol';
import {
  MemoryStore,
  RoomState,
  type Conn,
  type Health,
  type Match,
  type Player,
  type QEntry,
  type RatingStore,
  type Room,
  type RoomServerOptions,
  type ServerContext,
  type Session,
} from './roomTypes';
import { typeKey } from './rating';
import { confirm, dropMatch, enqueue, rankedElsewhere, tickMatch, unqueue } from './matchmaking';
import {
  addAct,
  bothOnline,
  broadcast,
  byId,
  colorOf,
  endAtLimit,
  finish,
  freeRoom,
  leaveRoom,
  newRoom,
  resolveAsk,
  resync,
  roomCode,
  seat,
  seatPlayers,
  startTurn,
  tickRoom,
} from './room';

// 共用的类型已移到 roomTypes.ts（整改项 P2-12）；对外的部分仍从这里导出，引用方不必改动
export { MemoryStore, type Conn, type Health, type RatingStore, type RoomServerOptions, type Session } from './roomTypes';

const MAX_PLAYERS = 2048;
/**
 * 尚未握手的连接最多几条（API-046）：玩家数上限在握手时才检查，满员时带令牌的重连仍能回到原来的对局；
 * 未握手的连接另设上限，使服务端保存的连接总数仍然有界。它们须在 HELLO_SECS 内握手，同一 IP 的连接数与新建频率另有限制。
 * 取与玩家上限相同的值：满员服务器的全部玩家同时重连（如服务器重启、网络抖动后）也不会被拒；每条未握手的连接约占 1 KB
 */
export const PENDING_MAX = MAX_PLAYERS;
const MAX_ROOMS = 1024;
const JOIN_FAILS = 5; // 一条连接一分钟内最多几次加入失败，超过就暂时不让再试（防止遍历房号）
/** 统计加入失败次数的时间窗 */
const JOIN_WINDOW_SECS = 60;
/** 重连令牌的随机字节数：16 字节，即 32 位十六进制（API-013、SEC-020） */
const TOKEN_BYTES = 16;
/** 匿名身份散列保留的十六进制位数（DAT-075） */
const UID_HASH_CHARS = 32;
/** 超出频率限制时的提示（v3 以文本下发；协议 v4 起为错误码 rate.limited，E3） */
const LIMITED_TEXT = '操作过于频繁，请稍后再试';
/** 维护模式中拒绝开始新的对局时的提示，也是进入维护模式时下发给在线玩家的通知（OPS-045，错误码 server.maintenance） */
const MAINTENANCE_TEXT = '服务器即将维护，暂不开始新的对局';
/** 服务端出现未预期的异常时的提示（v3 以文本下发，附错误编号；协议 v4 起为错误码 server.internal，E5） */
const INTERNAL_TEXT = '服务器出现问题，请稍后再试';
/** 玩家数或未握手的连接数达到上限时的提示（错误码 server.full，E2） */
const BUSY_TEXT = '服务器繁忙，请稍后再试';

/** 令牌的散列（十六进制）：按令牌查找时以它为键（SEC-022） */
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
/** 两个十六进制散列是否相同：常量时间比较（SEC-022）；长度不同（含空串）时不同 */
const sameHash = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
const hex = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
};

export class RoomServer {
  private players = new Set<Player>();
  /** 令牌散列 → 玩家：重连时按令牌查找，不遍历全部玩家（SEC-022）。只含已握手的玩家，玩家移除时一并删除 */
  private byToken = new Map<string, Player>();
  private rooms = new Map<number, Room>();
  private queue: QEntry[] = [];
  private matches = new Set<Match>();
  /** 因累计违规被断开的匿名身份（散列）→ 解除的时刻（API-045） */
  private banned = new Map<string, number>();
  private nextPlayer = 1;
  private nextRoom = 1;
  private nextGame = 1;
  private now: () => number;
  private random: () => number;
  private log: Log;
  private store: RatingStore;
  private latest: { latest?: string; url?: string };
  private metrics: Metrics | undefined;
  /** 维护模式（OPS-045）：只能以重启结束 */
  private maintenance = false;
  /** 交给拆出的各模块的上下文（整改项 P2-12） */
  private readonly ctx: ServerContext;

  constructor(opt: RoomServerOptions = {}) {
    this.now = opt.now ?? (() => performance.now() / 1000);
    this.random = opt.random ?? Math.random;
    this.log = opt.log ?? (() => {});
    this.store = opt.store ?? new MemoryStore();
    this.latest = opt.latest ? { latest: opt.latest, url: opt.download } : {};
    this.metrics = opt.metrics;
    this.ctx = RoomServer.context(this);
  }

  /** 交给拆出的各模块的上下文：状态以 getter 现取（关停时会换掉匹配队列），方法包装本类的私有方法 */
  private static context(server: RoomServer): ServerContext {
    const ctx: ServerContext = {
      store: server.store,
      log: server.log,
      now: server.now,
      random: server.random,
      get players() {
        return server.players;
      },
      get rooms() {
        return server.rooms;
      },
      get queue() {
        return server.queue;
      },
      get matches() {
        return server.matches;
      },
      metrics: server.metrics,
      get nextRoom() {
        return server.nextRoom;
      },
      set nextRoom(id) {
        server.nextRoom = id;
      },
      get nextGame() {
        return server.nextGame;
      },
      set nextGame(id) {
        server.nextGame = id;
      },
      send: (p, msg) => server.send(p, msg),
      newRoom: (kind, rules, seat) => newRoom(ctx, kind, rules, seat),
      seatPlayers: (r, first, second, firstColor) => seatPlayers(ctx, r, [first, second], firstColor),
    };
    return ctx;
  }

  // ---------------- 对外接口 ----------------

  /**
   * 新连接；尚未握手的连接已达 PENDING_MAX 时告知“服务器繁忙”后返回 null，调用方应以 CLOSE_CODE.overload 关闭连接（API-046）。
   * 玩家数上限在握手时检查（hello）
   */
  connect(conn: Conn): Session | null {
    if (this.pending() >= PENDING_MAX) {
      conn.send({ t: 'error', text: BUSY_TEXT });
      return null;
    }
    const now = this.now();
    const p: Player = {
      id: 0,
      conn,
      name: '',
      tokenHash: '',
      prevTokenHash: '',
      key: '',
      ratings: { gomoku: newRating(), go: newRating() },
      lastSeen: now,
      offAt: 0,
      room: 0,
      queued: null,
      match: null,
      joinFails: [],
      invalid: 0,
      since: now,
      limits: new ConnLimits(now),
    };
    this.players.add(p);
    return p;
  }

  /**
   * 收到一条消息：raw 为 JSON 解析的结果，不是 JSON 时为 undefined。先按令牌桶限速（API-043），
   * 再经 parseC2S 校验（API-010），非法的回复错误后丢弃（API-015）。返回此后该连接对应的会话（带令牌重连时换成原来的玩家）。
   * 处理中出现未预期的异常时，只以 1011 断开这条连接，对局照常保留席位，其余连接不受影响（API-023、EDGE-002）
   */
  message(p: Session, raw: unknown, conn?: Conn): Session {
    try {
      return this.receive(p, raw, conn);
    } catch (err) {
      this.kick(p, this.report(err, { msg: '处理消息时出现未预期的异常', playerId: p.id || undefined }));
      return p;
    }
  }

  private receive(p: Player, raw: unknown, conn?: Conn): Player {
    if (!this.players.has(p) || !p.conn || (conn && p.conn !== conn)) return p;
    if (!p.limits.message(this.now())) {
      this.limited(p);
      return p;
    }
    const m = parseC2S(raw);
    this.metrics?.inc('yi_messages_total', { type: isInvalid(m) ? 'invalid' : m.t });
    if (isInvalid(m)) {
      this.rejectInvalid(p, m);
      return p;
    }
    if (!p.id) return this.hello(p, m);
    this.confirmToken(p);
    this.handle(p, m);
    return p;
  }

  /** 连接还活着（WebSocket 层的心跳回应）：浏览器把页面放到后台时脚本的定时器会被放慢，但心跳照常回应 */
  touch(p: Session, conn?: Conn) {
    if (this.players.has(p) && p.conn && (!conn || p.conn === conn)) p.lastSeen = this.now();
  }

  /**
   * 连接断开：对局中保留席位等待重连，其余情况直接离开。conn：断开的是哪条连接（已被新连接接管的旧连接断开时什么也不做）；
   * code：关闭码，只用于日志。处理中出现未预期的异常时，移除这位玩家并结束其所在的房间（API-023、EDGE-002）
   */
  disconnect(p: Session, conn?: Conn, code?: number) {
    try {
      this.goOffline(p, conn, code);
    } catch (err) {
      this.evict(p, this.report(err, { msg: '处理断线时出现未预期的异常', playerId: p.id || undefined }));
    }
  }

  private goOffline(p: Player, conn?: Conn, code?: number) {
    if (!this.players.has(p) || !p.conn || (conn && p.conn !== conn)) return;
    p.conn = null;
    p.offAt = this.now();
    if (!p.id) {
      this.forget(p);
      return;
    }
    this.log('info', 'player.offline', { msg: `${p.name} 断开`, playerId: p.id, code });
    unqueue(this.ctx, p);
    if (p.match) dropMatch(this.ctx, p.match, [p], '对方已离开');
    const r = this.rooms.get(p.room);
    if (r && r.state === RoomState.Play) {
      if (r.deadline) {
        r.paused = r.deadline - this.now();
        r.deadline = 0;
      } // 有人掉线时双方都不计时
      const opp = seat(this.ctx, r, other(colorOf(r, p)));
      this.send(opp, { t: 'peer', online: false, wait: GRACE_SECS });
      if (r.paused > 0) this.send(opp, { t: 'turn', color: r.g.cur.toMove, secs: -1 });
      return;
    }
    leaveRoom(this.ctx, p);
    this.forget(p);
  }

  /**
   * 定时调用（建议每 0.25 秒）：检查各种超时。某个配对、房间或玩家的检查出现未预期的异常时，
   * 只清理出错的那一项（否则每次检查都会再出错），其余照常检查（API-023、EDGE-002）
   */
  tick() {
    const now = this.now();
    for (const m of [...this.matches]) {
      const fault = { msg: '检查配对确认时出现未预期的异常', playerIds: m.side.map(side => side.p.id) };
      this.guard(
        () => tickMatch(this.ctx, m, now),
        fault,
        errorId => this.scrapMatch(m, errorId),
      );
    }
    for (const r of [...this.rooms.values()]) {
      if (!this.rooms.has(r.id)) continue;
      const fault = { msg: '检查房间时限时出现未预期的异常', roomId: r.id, gameId: r.gameId };
      this.guard(
        () => tickRoom(this.ctx, r, now),
        fault,
        errorId => this.scrapRoom(r, errorId),
      );
    }
    for (const [key, until] of this.banned) if (now >= until) this.banned.delete(key);
    for (const p of [...this.players]) {
      if (!this.players.has(p)) continue;
      const fault = { msg: '检查玩家时限时出现未预期的异常', playerId: p.id || undefined };
      this.guard(
        () => this.tickPlayer(p, now),
        fault,
        errorId => this.evict(p, errorId),
      );
    }
  }

  /** 玩家的时限：握手超时（API-042）；太久没消息，当作断线；掉线太久，对局判负并清理 */
  private tickPlayer(p: Player, now: number) {
    if (p.conn && !p.id && now - p.since > HELLO_SECS) this.drop(p, CLOSE_CODE.helloTimeout);
    else if (p.conn && now - p.lastSeen > IDLE_SECS) this.drop(p);
    else if (!p.conn && now - p.offAt > GRACE_SECS) {
      const r = this.rooms.get(p.room);
      if (r && r.state === RoomState.Play) finish(this.ctx, r, { winner: other(colorOf(r, p)), reason: 'disconnect' });
      leaveRoom(this.ctx, p);
      this.forget(p);
    }
  }

  /** 尚未握手的连接数 */
  private pending() {
    let n = 0;
    for (const p of this.players) if (!p.id) n++;
    return n;
  }

  online() {
    let n = 0;
    for (const p of this.players) if (p.conn && p.id) n++;
    return n;
  }
  /** 当前有效的重连令牌数（监控用）：每位已握手的玩家一枚，重连后等待确认期间多一枚 */
  tokenCount() {
    return this.byToken.size;
  }
  /** 正在匹配的人数（按队列） */
  queued(mode: QueueMode, type: number) {
    return this.queue.filter(e => e.mode === mode && e.type === type).length;
  }
  /** 按种类与状态统计的房间数、按模式与棋类统计的排队人数（指标 yi_rooms_active、yi_queue_waiting） */
  stats() {
    const rooms = new Map<string, number>();
    for (const r of this.rooms.values()) {
      const state = r.state === RoomState.Wait ? 'wait' : r.state === RoomState.Over ? 'over' : r.g.scoring ? 'scoring' : 'play';
      const key = `${r.kind} ${state}`;
      rooms.set(key, (rooms.get(key) ?? 0) + 1);
    }
    const queue = new Map<string, number>();
    for (const entry of this.queue) {
      const key = `${entry.mode} ${typeKey(entry.type)}`;
      queue.set(key, (queue.get(key) ?? 0) + 1);
    }
    const split = (map: Map<string, number>) => [...map].map(([key, count]) => [...key.split(' '), count] as [string, string, number]);
    return {
      rooms: split(rooms).map(([kind, state, count]) => ({ kind, state, count })),
      queue: split(queue).map(([mode, type, count]) => ({ mode, type, count })),
    };
  }

  /** 健康检查的数据（API-061） */
  health(): Health {
    let games = 0;
    for (const r of this.rooms.values()) if (r.state === RoomState.Play) games++;
    return { players: this.online(), games, maintenance: this.maintenance };
  }

  /**
   * 进入维护模式（OPS-045）：取消排队、待确认的配对与等待对手的好友房间，撤回待回应的再来一局申请；此后拒绝开始新的对局，
   * 已开始的对局照常进行。受影响的玩家收到 error（客户端回到大厅），其余在线玩家收到 info。已在维护模式时什么也不做，返回 false
   */
  maintain(): boolean {
    if (this.maintenance) return false;
    this.maintenance = true;
    const cancelled = this.cancelPending();
    for (const p of this.players) if (p.id) this.send(p, { t: cancelled.has(p) ? 'error' : 'info', text: MAINTENANCE_TEXT });
    const { games, players } = this.health();
    this.log('info', 'server.maintenance', { msg: '进入维护模式', games, players });
    return true;
  }

  /** 关闭全部连接（服务端退出前）：已连上的以 1001 关闭，客户端随后重连（OPS-052、API-050） */
  shutdown() {
    for (const p of this.players) p.conn?.close(CLOSE_CODE.restart);
    this.players.clear();
    this.byToken.clear();
    this.rooms.clear();
    this.queue = [];
    this.matches.clear();
  }

  // ---------------- 内部 ----------------

  /** 取消尚未开局的一切（进入维护模式时）：排队、待确认的配对、等待对手的好友房间、待回应的再来一局申请；返回受影响的玩家 */
  private cancelPending() {
    const cancelled = new Set<Player>();
    for (const m of this.matches) for (const side of m.side) cancelled.add(side.p);
    for (const entry of this.queue) cancelled.add(entry.p);
    for (const p of cancelled) {
      unqueue(this.ctx, p);
      p.match = null;
    }
    this.matches.clear();
    for (const r of [...this.rooms.values()]) {
      if (r.state === RoomState.Over && r.ask === 'rematch') r.ask = null;
      if (r.state !== RoomState.Wait) continue;
      const host = byId(this.ctx, r.host);
      if (host) {
        host.room = 0;
        cancelled.add(host);
      }
      freeRoom(this.ctx, r);
    }
    return cancelled;
  }

  private send(p: Player | null | undefined, msg: S2C) {
    if (!p?.conn) return;
    p.conn.send(msg);
    if (msg.t === 'error' || msg.t === 'info') this.metrics?.inc('yi_errors_total', { code: errorCode(msg.text) });
    else if (msg.t === 'joinNo') this.metrics?.inc('yi_errors_total', { code: errorCode(msg.reason) });
  }
  private busy(p: Player) {
    return !!(p.room || p.match);
  }

  // ---------------- 未预期的异常（API-023、EDGE-002） ----------------

  /** 记录一次未预期的异常：完整调用栈与新的错误编号（UUID v4）写入 internal.error 日志；返回错误编号，供下发给客户端对照 */
  private report(err: unknown, entry: LogEntry): string {
    const errorId = randomUUID();
    this.log('error', 'internal.error', { ...entry, errorId, err });
    return errorId;
  }

  /** 执行一项定时检查；出现未预期的异常时按 fault 记录，再以 clean 清理出错的那一项 */
  private guard(work: () => void, fault: LogEntry, clean: (errorId: string) => void) {
    try {
      work();
    } catch (err) {
      clean(this.report(err, fault));
    }
  }

  /** 以服务端内部错误（E5）断开一位玩家：先下发提示与错误编号（不含异常的内容），再按断线处理并以 1011 关闭 */
  private kick(p: Player, errorId: string) {
    try {
      this.send(p, { t: 'error', text: INTERNAL_TEXT, errorId });
    } catch {
      // 发送本身抛出说明连接已经出错：异常已记录，不再告知，照常断开
    }
    this.drop(p, CLOSE_CODE.internal);
  }

  /** 放弃出错的配对：双方不再等待确认，以 1011 断开 */
  private scrapMatch(m: Match, errorId: string) {
    this.matches.delete(m); // 出错时可能尚未移除；断开时便不会再处理这个配对
    for (const side of m.side) this.kick(side.p, errorId);
  }

  /** 放弃出错的房间：先移除房间（对局不再继续，也不结算段位），再以 1011 断开座位上的玩家；他们重连时收到 resumeFailed */
  private scrapRoom(r: Room, errorId: string) {
    freeRoom(this.ctx, r);
    for (const color of [BLACK, WHITE]) {
      const p = seat(this.ctx, r, color);
      if (p) this.kick(p, errorId);
    }
  }

  /** 移除出错的玩家：放弃其所在的房间，以 1011 断开（已断开的直接移除）；不再保留席位，免得每次检查都再出错 */
  private evict(p: Player, errorId: string) {
    const r = this.rooms.get(p.room);
    if (r) this.scrapRoom(r, errorId);
    this.kick(p, errorId);
    this.forget(p);
  }

  // ---------------- 限流与违规（API-042 至 API-045） ----------------

  /** 服务端主动断开一条连接：先按断线处理（对局中保留席位），再关闭；code 为关闭码，不带时直接切断 */
  private drop(p: Player, code?: number) {
    const conn = p.conn;
    if (!conn) return;
    this.disconnect(p, conn, code);
    conn.close(code);
  }

  /** 超出频率限制（E3）：丢弃这次请求，1 秒内只提示一次，并累计一次违规 */
  private limited(p: Player) {
    this.metrics?.inc('yi_rate_limited_total');
    const now = this.now();
    if (p.limits.notice(now)) {
      this.send(p, { t: 'error', text: LIMITED_TEXT });
      // 随提示每秒至多记一行；count 含本次即将累计的这一次违规
      this.log('warn', 'rate.limited', { playerId: p.id || undefined, count: p.limits.violations(now) + 1 });
    }
    this.violate(p);
  }

  /**
   * 累计一次违规（E3、E4）；60 秒内达到 10 次时以 1008 断开，并在 5 分钟内拒绝同一匿名身份再连上（API-045）。
   * 断开后对局照常保留席位，但被拒期间无法重连，到时按掉线判负
   */
  private violate(p: Player) {
    if (!p.conn || !p.limits.violate(this.now())) return;
    if (p.key) this.banned.set(p.key, this.now() + BAN_SECS);
    this.log('warn', 'conn.kicked', { msg: `${p.id ? p.name : '未握手的连接'} 累计违规过多，已断开`, playerId: p.id || undefined, code: CLOSE_CODE.policy });
    this.drop(p, CLOSE_CODE.policy);
  }

  /** 受频率限制的操作（API-044）：没超出时返回 true；超出时按限流处理并返回 false */
  private allow(p: Player, op: LimitedOp) {
    if (p.limits.allow(op, this.now())) return true;
    this.limited(p);
    return false;
  }

  // ---------------- 房间 ----------------

  /** 非法消息（API-015）：版本不符时提示更新，其余回复格式错误后丢弃；都累计一次违规。每条连接只记第一条的日志，免得被刷屏 */
  private rejectInvalid(p: Player, m: Invalid) {
    if (m.invalid === 'version') this.send(p, { t: 'error', text: '客户端版本与服务器不一致，请更新游戏' });
    else {
      this.send(p, { t: 'error', text: '消息格式错误' });
      if (p.invalid++ === 0) this.log('warn', 'proto.invalid', { msg: '非法消息', playerId: p.id || undefined, reason: m.why });
    }
    this.violate(p);
  }

  private hello(p: Player, m: C2S): Player {
    if (m.t !== 'hello') {
      this.send(p, { t: 'error', text: '协议错误' });
      this.violate(p);
      return p;
    }
    // 匿名身份：只存散列，存档里看不出原来的 uid（DAT-075）
    const key = createHash('sha256')
      .update('yi:' + m.uid)
      .digest('hex')
      .slice(0, UID_HASH_CHARS);
    if ((this.banned.get(key) ?? 0) > this.now()) {
      // 刚因累计违规被断开（API-045）
      this.send(p, { t: 'error', text: LIMITED_TEXT });
      this.drop(p, CLOSE_CODE.policy);
      return p;
    }
    p.lastSeen = this.now();
    const found = m.token === undefined ? null : this.findByToken(m.token);
    if (found) return this.resume(p, found.player, found.hash); // p 还没握手，不会是 found.player
    if (this.players.size - this.pending() >= MAX_PLAYERS) {
      // 满员（API-046）：只拒绝新来的玩家；带令牌重连的已在上一行回到原来的会话，不占新的名额
      this.send(p, { t: 'error', text: BUSY_TEXT });
      this.drop(p, CLOSE_CODE.overload);
      return p;
    }
    p.name = cleanName(m.name, '棋手');
    p.id = this.nextPlayer++;
    const token = this.issueToken(p);
    p.key = key;
    const saved = this.store.get(p.key);
    p.ratings = { gomoku: { ...newRating(), ...saved?.gomoku }, go: { ...newRating(), ...saved?.go } };
    this.send(p, { t: 'welcome', id: p.id, token, ratings: p.ratings, ...this.latest });
    if (m.token !== undefined) this.send(p, { t: 'resumeFailed' }); // 原来的对局已经不在了（服务器重启过，或掉线太久）
    if (this.maintenance) this.send(p, { t: 'info', text: MAINTENANCE_TEXT });
    this.log('info', 'player.online', { msg: `${p.name} 上线`, playerId: p.id });
    return p;
  }

  /**
   * 带令牌重连，找回掉线的玩家 back：由新连接（p 的连接）接管，并换发新令牌（SEC-020）。usedHash 为这次所用令牌的散列，
   * 在收到新连接上的下一条消息之前仍然有效：新令牌若随连接再次中断而没送到，客户端仍可用原来的令牌回来
   */
  private resume(p: Player, back: Player, usedHash: string): Player {
    const old = back.conn;
    if (old) {
      // 旧连接其实已经断了，只是还没被发现：由新连接接管
      back.conn = null;
      old.close();
    }
    back.conn = p.conn;
    back.lastSeen = this.now();
    this.players.delete(p); // p 还没握手，没有令牌
    p.conn = null;
    this.send(back, { t: 'welcome', id: back.id, token: this.issueToken(back, usedHash), ratings: back.ratings, ...this.latest });
    const r = this.rooms.get(back.room);
    if (r && r.state !== RoomState.Wait) this.resumeRoom(r, back);
    this.log('info', 'player.resumed', { msg: `${back.name} 重新连上`, playerId: back.id, roomId: back.room || undefined });
    return back;
  }

  /** 重连的玩家回到房间：回放整局；双方都在线时恢复计时，并告诉对方 */
  private resumeRoom(r: Room, back: Player) {
    const resume = r.state === RoomState.Play && r.paused > 0 && bothOnline(this.ctx, r);
    if (resume) {
      r.deadline = this.now() + r.paused;
      r.paused = 0;
    }
    resync(this.ctx, r, back);
    const opp = seat(this.ctx, r, other(colorOf(r, back)));
    this.send(opp, { t: 'peer', online: true });
    if (resume) this.send(opp, { t: 'turn', color: r.g.cur.toMove, secs: Math.round(r.deadline - this.now()) });
  }

  // ---------------- 重连令牌（SEC-020、SEC-022） ----------------

  /** 给玩家换发一枚新令牌并返回原文（只随 welcome 下发一次）；keep 为仍须保留的旧令牌散列，其余旧令牌立即作废 */
  private issueToken(p: Player, keep = ''): string {
    for (const hash of [p.tokenHash, p.prevTokenHash]) if (hash && hash !== keep) this.byToken.delete(hash);
    const token = hex(TOKEN_BYTES);
    p.tokenHash = tokenHash(token);
    p.prevTokenHash = keep;
    this.byToken.set(p.tokenHash, p);
    return token;
  }

  /** 按令牌找到玩家：以散列查表，再以常量时间比较确认；找不到时返回 null */
  private findByToken(token: string): { player: Player; hash: string } | null {
    const hash = tokenHash(token),
      player = this.byToken.get(hash);
    if (!player || (!sameHash(hash, player.tokenHash) && !sameHash(hash, player.prevTokenHash))) return null;
    return { player, hash };
  }

  /** 新连接上收到了重连之后的消息：连接确实通了，新令牌已送到，上一枚令牌作废 */
  private confirmToken(p: Player) {
    if (!p.prevTokenHash) return;
    this.byToken.delete(p.prevTokenHash);
    p.prevTokenHash = '';
  }

  /** 移除玩家，连同他的令牌 */
  private forget(p: Player) {
    this.players.delete(p);
    for (const hash of [p.tokenHash, p.prevTokenHash]) if (hash) this.byToken.delete(hash);
  }

  /** 握手之后的消息：先看是不是不在对局中也能发的，再按房间的状态交给对局中或终局后的处理 */
  private handle(p: Player, m: C2S) {
    p.lastSeen = this.now();
    if (this.lobby(p, m)) return;
    const r = this.rooms.get(p.room),
      me = r ? colorOf(r, p) : 0;
    if (!r || !me) return;
    if (r.state === RoomState.Over) this.afterGame(r, p, me, m);
    else if (r.state === RoomState.Play) {
      this.inGame(r, p, me, m);
      endAtLimit(this.ctx, r); // 落子、停一手、同意悔棋、标记死子、恢复对局之后都在此检查
    }
  }

  /** 不在对局中也能发的消息（匹配、房间、改名、心跳）；处理了返回 true */
  private lobby(p: Player, m: C2S): boolean {
    switch (m.t) {
      case 'ping':
        this.send(p, { t: 'pong' });
        return true;
      case 'leave':
        leaveRoom(this.ctx, p);
        return true;
      case 'name':
        this.rename(p, m.name);
        return true;
      case 'queue':
        if (this.allow(p, 'queue')) this.queueFor(p, m.mode, m.type, m.size);
        return true;
      case 'unqueue':
        if (this.allow(p, 'queue')) unqueue(this.ctx, p);
        return true;
      case 'confirm':
        confirm(this.ctx, p, m.ok);
        return true;
      case 'create':
        this.createRoom(p, m);
        return true;
      case 'close':
        this.closeRoom(p);
        return true;
      case 'join':
        this.joinRoom(p, m.code);
        return true;
      default:
        return false;
    }
  }

  /**
   * 改名（不在房间里时）。客户端每次匹配、开房、加入前都会先发一次 name，与当前昵称相同的不算改名，
   * 不计入频率；真正改名的每 10 秒至多 1 次（API-044）
   */
  private rename(p: Player, raw: string) {
    if (this.busy(p)) return;
    const name = cleanName(raw, p.name);
    if (name !== p.name && this.allow(p, 'name')) p.name = name;
  }

  private queueFor(p: Player, mode: QueueMode, type: number, size: number) {
    if (this.maintenance) {
      this.send(p, { t: 'error', text: MAINTENANCE_TEXT });
      return;
    }
    if (this.busy(p)) {
      this.send(p, { t: 'error', text: '你已经在一个房间里了' });
      return;
    }
    if (mode === 'ranked' && rankedElsewhere(this.ctx, p)) {
      this.send(p, { t: 'error', text: '这台设备已经在排位中了' });
      return;
    }
    unqueue(this.ctx, p);
    enqueue(this.ctx, p, { mode, type, size });
  }

  private createRoom(p: Player, m: Extract<C2S, { t: 'create' }>) {
    if (this.maintenance) {
      this.send(p, { t: 'error', text: MAINTENANCE_TEXT });
      return;
    }
    if (this.busy(p)) {
      this.send(p, { t: 'error', text: '你已经在一个房间里了' });
      return;
    }
    if (this.rooms.size >= MAX_ROOMS) {
      this.send(p, { t: 'error', text: '服务器房间已满，请稍后再试' });
      return;
    }
    unqueue(this.ctx, p);
    // 路数与匹配相同：五子棋只有 15 路，围棋没有 15 路；禁手与每步限时由房主选
    const { size } = queueRules('match', m.type, m.size);
    const r = newRoom(this.ctx, 'friend', { type: m.type, size, renju: m.type === 0 && m.renju, moveTime: m.moveTime }, { hostColor: m.hostColor, host: p.id });
    r.code = roomCode(this.ctx);
    p.room = r.id;
    this.send(p, { t: 'created', code: r.code });
    this.log('info', 'room.created', { msg: `${p.name} 开房间 ${r.code}`, roomId: r.id, playerId: p.id });
  }

  /** 房主关闭尚未开始的房间 */
  private closeRoom(p: Player) {
    const r = this.rooms.get(p.room);
    if (r && r.state === RoomState.Wait && r.host === p.id) {
      p.room = 0;
      freeRoom(this.ctx, r);
    }
  }

  private joinRoom(p: Player, code: string) {
    if (this.maintenance) {
      this.send(p, { t: 'joinNo', reason: MAINTENANCE_TEXT });
      return;
    }
    const now = this.now();
    p.joinFails = p.joinFails.filter(t0 => now - t0 < JOIN_WINDOW_SECS);
    if (p.joinFails.length >= JOIN_FAILS) {
      this.send(p, { t: 'joinNo', reason: '尝试次数太多，请稍后再试' });
      this.violate(p);
      return;
    } // E3
    const r = [...this.rooms.values()].find(room => room.state === RoomState.Wait && room.code === code);
    if (this.busy(p)) {
      this.send(p, { t: 'joinNo', reason: '你已经在一个房间里了' });
      return;
    }
    const noRoom = () => {
      p.joinFails.push(now);
      this.send(p, { t: 'joinNo', reason: '房号不存在，或房间已经开始' });
    };
    if (!r) {
      noRoom();
      return;
    }
    const host = byId(this.ctx, r.host);
    if (!host || !host.conn) {
      freeRoom(this.ctx, r);
      noRoom();
      return;
    }
    if (host === p) {
      this.send(p, { t: 'joinNo', reason: '这是你自己的房间' });
      return;
    }
    unqueue(this.ctx, p);
    const hostColor = r.hostColor === 2 ? this.randomColor() : r.hostColor === 1 ? WHITE : BLACK; // hostColor：0 执黑 1 执白 2 随机
    seatPlayers(this.ctx, r, [host, p], hostColor);
  }

  /** 随机分先：黑白各半 */
  private randomColor() {
    return this.random() < 1 / 2 ? BLACK : WHITE;
  }

  /** 终局后：只接受再来一局的申请与回应 */
  private afterGame(r: Room, p: Player, me: number, m: C2S) {
    if (m.t === 'reply' && m.kind === 'rematch' && r.ask === 'rematch' && r.askFrom !== me) {
      resolveAsk(this.ctx, r, m.ok);
      return;
    }
    if (m.t !== 'rematch') return;
    if (this.maintenance) {
      this.send(p, { t: 'info', text: MAINTENANCE_TEXT });
      return;
    }
    const opp = seat(this.ctx, r, other(me));
    if (r.kind === 'ranked') this.send(p, { t: 'info', text: '排位赛不能再来一局' });
    else if (!r.ask && opp?.conn) this.ask(r, me, 'rematch');
    else this.send(p, { t: 'info', text: r.ask ? '请先等对方回应' : '对方已离开，无法再来一局' });
  }

  /** 对局中（含点目）的操作 */
  private inGame(r: Room, p: Player, me: number, m: C2S) {
    switch (m.t) {
      case 'move':
        this.playMove(r, p, me, m.x, m.y);
        return;
      case 'pass':
        this.passTurn(r, me);
        return;
      case 'undo':
        this.askUndo(r, p, me);
        return;
      case 'draw':
        this.askDraw(r, p, me);
        return;
      case 'reply':
        if (m.kind !== 'rematch' && r.ask === m.kind && r.askFrom !== me) resolveAsk(this.ctx, r, m.ok);
        return;
      case 'resign':
        finish(this.ctx, r, { winner: other(me), reason: 'resign' });
        return;
      case 'mark':
        this.markDead(r, m.x, m.y);
        return;
      case 'agree':
        this.agreeScore(r, me);
        return;
      case 'resume':
        this.resumePlay(r);
        return;
    }
  }

  /** 向对方提出申请；等回应时不计时 */
  private ask(r: Room, me: number, kind: AskKind) {
    r.ask = kind;
    r.askFrom = me;
    r.askUntil = this.now() + ASK_SECS;
    if (kind !== 'rematch') r.deadline = 0;
    this.send(seat(this.ctx, r, other(me)), { t: 'ask', kind });
  }

  private playMove(r: Room, p: Player, me: number, x: number, y: number) {
    const g = r.g;
    if (g.scoring || g.cur.toMove !== me) {
      this.send(p, { t: 'info', text: '还没轮到你' });
      return;
    }
    if (r.ask) {
      this.send(p, { t: 'info', text: '请先等对方回应申请' });
      return;
    }
    if (!g.play(x, y)) {
      this.send(p, { t: 'info', text: rejectText(g.lastReject ?? 'occupied') });
      return;
    } // 含落在本局棋盘之外
    addAct(r, { k: 'M', x, y });
    broadcast(this.ctx, r, { t: 'moved', x, y });
    if (g.over) finish(this.ctx, r, { winner: g.winner, reason: g.winner === DRAWN ? 'full' : 'five' });
    else startTurn(this.ctx, r);
  }

  private passTurn(r: Room, me: number) {
    const g = r.g;
    if (g.type !== GameType.Go || g.scoring || g.cur.toMove !== me || r.ask) return;
    g.pass();
    addAct(r, { k: 'P' });
    broadcast(this.ctx, r, { t: 'passed' });
    r.agreed = [false, false, false];
    startTurn(this.ctx, r);
  }

  private askUndo(r: Room, p: Player, me: number) {
    const g = r.g;
    if (r.ask || g.scoring) {
      this.send(p, { t: 'info', text: '现在不能申请悔棋' });
      return;
    }
    if ((r.undoUsed[me] ?? 0) >= UNDO_LIMIT) {
      this.send(p, { t: 'info', text: '本局悔棋次数已用完' });
      return;
    }
    if (g.hist.length < (g.cur.toMove === me ? 2 : 1)) {
      this.send(p, { t: 'info', text: '你还没有可以悔的棋' });
      return;
    } // 轮到自己时要连对方那一手一起退
    r.undoUsed[me] = (r.undoUsed[me] ?? 0) + 1;
    this.ask(r, me, 'undo');
  }

  private askDraw(r: Room, p: Player, me: number) {
    if (r.ask) {
      this.send(p, { t: 'info', text: '请先等对方回应申请' });
      return;
    }
    if ((r.drawUsed[me] ?? 0) >= DRAW_LIMIT) {
      this.send(p, { t: 'info', text: '本局求和次数已用完' });
      return;
    }
    r.drawUsed[me] = (r.drawUsed[me] ?? 0) + 1;
    this.ask(r, me, 'draw');
  }

  /** 点目时标记 / 取消死子（点在空处或本局棋盘之外的忽略） */
  private markDead(r: Room, x: number, y: number) {
    const g = r.g;
    if (!g.scoring || !g.inB(x, y) || !g.b(x, y)) return;
    g.toggleDead(x, y);
    addAct(r, { k: 'K', x, y });
    r.agreed = [false, false, false];
    broadcast(this.ctx, r, { t: 'marked', x, y });
  }

  /** 确认点目结果；双方都确认后终局 */
  private agreeScore(r: Room, me: number) {
    const g = r.g;
    if (!g.scoring || r.agreed[me]) return;
    r.agreed[me] = true;
    broadcast(this.ctx, r, { t: 'agreed', color: me });
    if (!r.agreed[BLACK] || !r.agreed[WHITE]) return;
    g.computeScore();
    g.confirmScore();
    finish(this.ctx, r, { winner: g.winner, reason: 'score' });
  }

  /** 点目有分歧：回到对局 */
  private resumePlay(r: Room) {
    const g = r.g;
    if (!g.scoring) return;
    g.resume();
    addAct(r, { k: 'R' });
    r.agreed = [false, false, false];
    broadcast(this.ctx, r, { t: 'resumed' });
    startTurn(this.ctx, r);
  }
}
