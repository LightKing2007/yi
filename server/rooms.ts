/**
 * 弈 · 联机服务端核心：匹配 / 排位队列、配对确认、好友房间、对局、段位与超时。与传输无关（WebSocket 由 host.ts 接上）。
 *
 * 对局规则直接复用 src/core/game.ts：每个房间一份 Game，客户端发来的每一手都在这里校验，
 * 所以服务端与客户端的判定完全一致。协议见 src/shared/protocol.ts。
 */
import { createHash } from 'node:crypto';
import { Game } from '../src/core/game';
import { rejectText } from '../src/shared/reject';
import { BLACK, GameType, WHITE, other } from '../src/core/types';
import { isInvalid, parseC2S, type Invalid } from '../src/shared/parse';
import { BAN_SECS, ConnLimits, type LimitedOp } from './ratelimit';
import {
  ACTS_MAX,
  ASK_SECS,
  CLOSE_CODE,
  CONFIRM_SECS,
  DRAWN,
  DRAW_LIMIT,
  GRACE_SECS,
  HELLO_SECS,
  IDLE_SECS,
  UNDO_LIMIT,
  cleanName,
  newRating,
  queueRules,
  type Act,
  type AskKind,
  type C2S,
  type GameKind,
  type Opponent,
  type OverReason,
  type QueueMode,
  type Rating,
  type Ratings,
  type S2C,
} from '../src/shared/protocol';

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

const MAX_PLAYERS = 2048;
const MAX_ROOMS = 1024;
const ELO_K = 32;
const JOIN_FAILS = 5; // 一条连接一分钟内最多几次加入失败，超过就暂时不让再试（防止遍历房号）
/** 统计加入失败次数的时间窗 */
const JOIN_WINDOW_SECS = 60;
/** 房号为四位数：[CODE_MIN, CODE_MIN + CODE_SPAN) */
const CODE_MIN = 1000,
  CODE_SPAN = 9000;
/** 随机挑房号的尝试次数；都撞上时按顺序找一个空闲的 */
const CODE_TRIES = 100;
/** 重连令牌的随机字节数：16 字节，即 32 位十六进制（API-013、SEC-020） */
const TOKEN_BYTES = 16;
/** 匿名身份散列保留的十六进制位数（DAT-075） */
const UID_HASH_CHARS = 32;
/** 超出频率限制时的提示（v3 以文本下发；协议 v4 起为错误码 rate.limited，E3） */
const LIMITED_TEXT = '操作过于频繁，请稍后再试';

interface QEntry {
  p: Player;
  mode: QueueMode;
  type: number;
  size: number;
  since: number;
}

interface Match {
  mode: QueueMode;
  type: number;
  size: number;
  side: [QEntry, QEntry];
  ok: [boolean, boolean];
  deadline: number;
}

interface Player {
  id: number; // 0 表示还没握手
  conn: Conn | null; // null 表示掉线（对局中还可以用令牌回来）
  name: string;
  token: string;
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
const enum RoomState {
  Wait,
  Play,
  Over,
}

interface Room {
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
}

export interface RoomServerOptions {
  now?: () => number; // 秒
  random?: () => number;
  log?: (text: string) => void;
  store?: RatingStore;
  latest?: string; // 最新的客户端版本号，随 welcome 发给客户端
  download?: string; // 新版本的下载地址
}

/** 连接对象：由传输层持有，收到消息时交回 RoomServer */
export type Session = Player;

const typeKey = (type: number) => (type ? 'go' : 'gomoku') as keyof Ratings;
const hex = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
};

export class RoomServer {
  private players = new Set<Player>();
  private rooms = new Map<number, Room>();
  private queue: QEntry[] = [];
  private matches = new Set<Match>();
  /** 因累计违规被断开的匿名身份（散列）→ 解除的时刻（API-045） */
  private banned = new Map<string, number>();
  private nextPlayer = 1;
  private nextRoom = 1;
  private now: () => number;
  private random: () => number;
  private log: (text: string) => void;
  private store: RatingStore;
  private latest: { latest?: string; url?: string };

  constructor(opt: RoomServerOptions = {}) {
    this.now = opt.now ?? (() => performance.now() / 1000);
    this.random = opt.random ?? Math.random;
    this.log = opt.log ?? (() => {});
    this.store = opt.store ?? new MemoryStore();
    this.latest = opt.latest ? { latest: opt.latest, url: opt.download } : {};
  }

  // ---------------- 对外接口 ----------------

  /** 新连接；满员时告知“服务器繁忙”后返回 null，调用方应以 CLOSE_CODE.overload 关闭连接（API-046） */
  connect(conn: Conn): Session | null {
    if (this.players.size >= MAX_PLAYERS) {
      conn.send({ t: 'error', text: '服务器繁忙，请稍后再试' });
      return null;
    }
    const now = this.now();
    const p: Player = {
      id: 0,
      conn,
      name: '',
      token: '',
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
   * 再经 parseC2S 校验（API-010），非法的回复错误后丢弃（API-015）。返回此后该连接对应的会话（带令牌重连时换成原来的玩家）
   */
  message(p: Session, raw: unknown, conn?: Conn): Session {
    if (!this.players.has(p) || !p.conn || (conn && p.conn !== conn)) return p;
    if (!p.limits.message(this.now())) {
      this.limited(p);
      return p;
    }
    const m = parseC2S(raw);
    if (isInvalid(m)) {
      this.rejectInvalid(p, m);
      return p;
    }
    if (!p.id) return this.hello(p, m);
    this.handle(p, m);
    return p;
  }

  /** 连接还活着（WebSocket 层的心跳回应）：浏览器把页面放到后台时脚本的定时器会被放慢，但心跳照常回应 */
  touch(p: Session, conn?: Conn) {
    if (this.players.has(p) && p.conn && (!conn || p.conn === conn)) p.lastSeen = this.now();
  }

  /** 连接断开：对局中保留席位等待重连，其余情况直接离开。conn：断开的是哪条连接（已被新连接接管的旧连接断开时什么也不做） */
  disconnect(p: Session, conn?: Conn) {
    if (!this.players.has(p) || !p.conn || (conn && p.conn !== conn)) return;
    p.conn = null;
    p.offAt = this.now();
    if (!p.id) {
      this.players.delete(p);
      return;
    }
    this.log(`${p.name} 断开`);
    this.unqueue(p);
    if (p.match) this.dropMatch(p.match, [p], '对方已离开');
    const r = this.rooms.get(p.room);
    if (r && r.state === RoomState.Play) {
      if (r.deadline) {
        r.paused = r.deadline - this.now();
        r.deadline = 0;
      } // 有人掉线时双方都不计时
      const other = this.seat(r, 3 - this.colorOf(r, p));
      this.send(other, { t: 'peer', online: false, wait: GRACE_SECS });
      if (r.paused > 0) this.send(other, { t: 'turn', color: r.g.cur.toMove, secs: -1 });
      return;
    }
    this.leaveRoom(p);
    this.players.delete(p);
  }

  /** 定时调用（建议每 0.25 秒）：检查各种超时 */
  tick() {
    const now = this.now();
    for (const m of [...this.matches]) {
      // 确认超时：没点接受的一方作罢
      if (now > m.deadline)
        this.dropMatch(
          m,
          m.side.filter((_, i) => !m.ok[i]).map(e => e.p),
          '对方未确认',
        );
    }
    for (const r of [...this.rooms.values()]) {
      if (!this.rooms.has(r.id)) continue;
      if (r.ask && now > r.askUntil) this.resolveAsk(r, false); // 申请无人回应，视为拒绝
      if (r.state === RoomState.Play && r.deadline && now > r.deadline) this.finish(r, 3 - r.g.cur.toMove, 'timeout');
    }
    for (const [key, until] of this.banned) if (now >= until) this.banned.delete(key);
    for (const p of [...this.players]) {
      if (!this.players.has(p)) continue;
      if (p.conn && !p.id && now - p.since > HELLO_SECS) {
        this.drop(p, CLOSE_CODE.helloTimeout);
        continue;
      } // 握手超时（API-042）
      if (p.conn && now - p.lastSeen > IDLE_SECS) {
        this.drop(p);
        continue;
      } // 太久没消息：当作断线
      if (!p.conn && now - p.offAt > GRACE_SECS) {
        // 掉线太久：对局判负并清理
        const r = this.rooms.get(p.room);
        if (r && r.state === RoomState.Play) this.finish(r, 3 - this.colorOf(r, p), 'disconnect');
        this.leaveRoom(p);
        this.players.delete(p);
      }
    }
  }

  online() {
    let n = 0;
    for (const p of this.players) if (p.conn && p.id) n++;
    return n;
  }
  /** 正在匹配的人数（按队列） */
  queued(mode: QueueMode, type: number) {
    return this.queue.filter(e => e.mode === mode && e.type === type).length;
  }

  shutdown() {
    for (const p of this.players) p.conn?.close();
    this.players.clear();
    this.rooms.clear();
    this.queue = [];
    this.matches.clear();
  }

  // ---------------- 内部 ----------------

  private send(p: Player | null | undefined, msg: S2C) {
    if (p?.conn) p.conn.send(msg);
  }
  private byId(id: number) {
    if (!id) return undefined;
    for (const p of this.players) if (p.id === id) return p;
    return undefined;
  }
  private seat(r: Room, color: number) {
    return this.byId(r.pid[color]);
  }
  private colorOf(r: Room, p: Player) {
    return r.pid[BLACK] === p.id ? BLACK : r.pid[WHITE] === p.id ? WHITE : 0;
  }
  private broadcast(r: Room, msg: S2C) {
    for (const c of [BLACK, WHITE]) this.send(this.seat(r, c), msg);
  }
  private addAct(r: Room, act: Act) {
    if (r.acts.length < ACTS_MAX) r.acts.push(act);
  }
  private busy(p: Player) {
    return !!(p.room || p.match);
  }

  /** 同一台设备的另一个会话正在排位（排队、等确认或对局中）：两个窗口同时排位会互相覆盖段位 */
  private rankedElsewhere(p: Player) {
    if (!p.key) return false;
    for (const o of this.players) {
      if (o === p || o.key !== p.key) continue;
      if (o.queued?.mode === 'ranked' || o.match?.mode === 'ranked') return true;
      const r = this.rooms.get(o.room);
      if (r && r.kind === 'ranked' && r.state === RoomState.Play) return true;
    }
    return false;
  }

  // ---------------- 限流与违规（API-042 至 API-045） ----------------

  /** 服务端主动断开一条连接：先按断线处理（对局中保留席位），再关闭；code 为关闭码，不带时直接切断 */
  private drop(p: Player, code?: number) {
    const c = p.conn;
    if (!c) return;
    this.disconnect(p);
    c.close(code);
  }

  /** 超出频率限制（E3）：丢弃这次请求，1 秒内只提示一次，并累计一次违规 */
  private limited(p: Player) {
    if (p.limits.notice(this.now())) this.send(p, { t: 'error', text: LIMITED_TEXT });
    this.violate(p);
  }

  /**
   * 累计一次违规（E3、E4）；60 秒内达到 10 次时以 1008 断开，并在 5 分钟内拒绝同一匿名身份再连上（API-045）。
   * 断开后对局照常保留席位，但被拒期间无法重连，到时按掉线判负
   */
  private violate(p: Player) {
    if (!p.conn || !p.limits.violate(this.now())) return;
    if (p.key) this.banned.set(p.key, this.now() + BAN_SECS);
    this.log(`${p.id ? `玩家 ${p.id}（${p.name}）` : '未握手的连接'} 累计违规过多，已断开`);
    this.drop(p, CLOSE_CODE.policy);
  }

  /** 受频率限制的操作（API-044）：没超出时返回 true；超出时按限流处理并返回 false */
  private allow(p: Player, op: LimitedOp) {
    if (p.limits.allow(op, this.now())) return true;
    this.limited(p);
    return false;
  }

  // ---------------- 匹配与排位 ----------------

  private enqueue(p: Player, mode: QueueMode, type: number, size: number, since = this.now()) {
    const rules = queueRules(mode, type, size);
    const e: QEntry = { p, mode, type: rules.type, size: rules.size, since };
    // 队列按进入的先后排好；与同一队列里等得最久的人配对
    const other = this.queue.find(
      o => o.p !== p && o.mode === e.mode && o.type === e.type && o.size === e.size && o.p.conn && !(mode === 'ranked' && o.p.key === p.key),
    ); // 排位不和自己（同一台设备）配对
    if (!other) {
      let i = this.queue.findIndex(o => o.since > since);
      if (i < 0) i = this.queue.length;
      this.queue.splice(i, 0, e);
      p.queued = e;
      this.send(p, { t: 'queued', mode: e.mode, type: e.type, size: e.size });
      return;
    }
    this.unqueue(other.p);
    const m: Match = { mode: e.mode, type: e.type, size: e.size, side: [other, e], ok: [false, false], deadline: this.now() + CONFIRM_SECS };
    this.matches.add(m);
    for (let i = 0; i < 2; i++) {
      const me = m.side[i].p,
        opp = m.side[1 - i].p;
      me.match = m;
      this.send(me, { t: 'found', opp: this.oppInfo(opp, m.mode, m.type), secs: CONFIRM_SECS });
    }
    this.log(`配对（${mode === 'ranked' ? '排位' : '匹配'}）：${other.p.name} 与 ${p.name}`);
  }

  private unqueue(p: Player) {
    if (!p.queued) return;
    const i = this.queue.indexOf(p.queued);
    if (i >= 0) this.queue.splice(i, 1);
    p.queued = null;
  }

  private oppInfo(p: Player, mode: QueueMode | GameKind, type: number): Opponent {
    return mode === 'ranked' ? { name: p.name, points: p.ratings[typeKey(type)].points } : { name: p.name };
  }

  /** 配对作罢：culprits（拒绝、超时、掉线的）退出匹配，另一方按原来的排队时刻继续匹配 */
  private dropMatch(m: Match, culprits: Player[], reason: string) {
    if (!this.matches.delete(m)) return;
    for (const e of m.side) e.p.match = null;
    for (const e of m.side) {
      if (culprits.includes(e.p)) {
        this.send(e.p, { t: 'unmatched', requeued: false, reason: '' });
        continue;
      }
      this.send(e.p, { t: 'unmatched', requeued: true, reason });
      if (e.p.conn) this.enqueue(e.p, e.mode, e.type, e.size, e.since);
    }
  }

  private confirm(p: Player, ok: boolean) {
    const m = p.match;
    if (!m) return;
    const i = m.side[0].p === p ? 0 : 1;
    if (!ok) {
      this.dropMatch(m, [p], '对方未接受');
      return;
    }
    if (m.ok[i]) return;
    m.ok[i] = true;
    if (!m.ok[1 - i]) {
      this.send(m.side[1 - i].p, { t: 'accepted' });
      return;
    }
    this.matches.delete(m);
    for (const e of m.side) e.p.match = null;
    const rules = queueRules(m.mode, m.type, m.size);
    const r = this.newRoom(m.mode, rules.type, rules.size, rules.renju, rules.moveTime, 2, 0);
    this.seatPlayers(r, m.side[0].p, m.side[1].p, this.random() < 0.5 ? BLACK : WHITE);
  }

  // ---------------- 房间 ----------------

  private newRoom(kind: GameKind, type: number, size: number, renju: boolean, moveTime: number, hostColor: number, host: number): Room {
    const r: Room = {
      id: this.nextRoom++,
      kind,
      code: '',
      state: RoomState.Wait,
      type,
      size,
      hostColor,
      renju,
      moveTime,
      host,
      pid: [0, 0, 0],
      who: [null, null, null],
      g: new Game(),
      acts: [],
      ask: null,
      askFrom: 0,
      askUntil: 0,
      undoUsed: [0, 0, 0],
      drawUsed: [0, 0, 0],
      agreed: [false, false, false],
      deadline: 0,
      paused: 0,
      result: null,
      rated: [null, null, null],
    };
    this.rooms.set(r.id, r);
    return r;
  }

  /** 入座开局：a 执 aColor */
  private seatPlayers(r: Room, a: Player, b: Player, aColor: number) {
    r.pid[aColor] = a.id;
    r.pid[3 - aColor] = b.id;
    r.who[aColor] = a;
    r.who[3 - aColor] = b;
    a.room = b.room = r.id;
    this.newRoomGame(r);
    this.sendStart(r);
    this.startTurn(r);
    this.log(`房间 ${r.id}（${r.kind}）开局：${r.who[BLACK]?.name} 对 ${r.who[WHITE]?.name}`);
  }

  /**
   * 四位房号，与等待中的房间不重复。房间数上限（MAX_ROOMS）远小于房号总数，按顺序找总能找到；
   * 房号必须是四位数，否则客户端发来的 join 过不了校验（API-013）
   */
  private roomCode() {
    const taken = new Set<string>();
    for (const r of this.rooms.values()) if (r.state === RoomState.Wait) taken.add(r.code);
    for (let i = 0; i < CODE_TRIES; i++) {
      const c = String(CODE_MIN + Math.floor(this.random() * CODE_SPAN));
      if (!taken.has(c)) return c;
    }
    for (let n = CODE_MIN; ; n++) if (!taken.has(String(n))) return String(n);
  }

  /** 新的一手开始：重新计时并通知双方 */
  private startTurn(r: Room) {
    const timed = r.moveTime > 0 && !r.g.scoring;
    r.deadline = timed && this.bothOnline(r) ? this.now() + r.moveTime : 0;
    r.paused = timed && !r.deadline ? r.moveTime : 0;
    this.broadcast(r, { t: 'turn', color: r.g.cur.toMove, secs: r.deadline ? r.moveTime : -1 });
  }

  /** 对局双方都连着 */
  private bothOnline(r: Room) {
    return !!(this.seat(r, BLACK)?.conn && this.seat(r, WHITE)?.conn);
  }

  private finish(r: Room, winner: number, reason: OverReason) {
    if (r.state !== RoomState.Play) return;
    r.state = RoomState.Over;
    r.ask = null;
    r.deadline = 0;
    r.paused = 0;
    r.result = { winner, reason };
    this.broadcast(r, { t: 'over', winner, reason });
    this.log(`房间 ${r.id} 结束：胜方 ${winner}（${reason}）`);
    if (r.kind === 'ranked') this.rate(r, winner);
  }

  /** 排位结算（Elo）：胜方至少加 1 分 */
  private rate(r: Room, winner: number) {
    const b = r.who[BLACK],
      w = r.who[WHITE];
    if (!b || !w) return;
    const k = typeKey(r.type),
      rb = b.ratings[k],
      rw = w.ratings[k];
    const eb = 1 / (1 + 10 ** ((rw.points - rb.points) / 400));
    const sb = winner === BLACK ? 1 : winner === WHITE ? 0 : 0.5;
    let d = Math.round(ELO_K * (sb - eb));
    if (sb === 1) d = Math.max(1, d);
    if (sb === 0) d = Math.min(-1, d);
    const apply = (p: Player, rt: Rating, delta: number, s: number) => {
      rt.points = Math.max(0, rt.points + delta);
      if (s === 1) rt.win++;
      else if (s === 0) rt.loss++;
      else rt.draw++;
      if (p.key) this.store.set(p.key, p.ratings, p.name);
      r.rated[p === b ? BLACK : WHITE] = { type: r.type, rating: { ...rt }, delta };
      this.send(p, { t: 'rated', type: r.type, rating: { ...rt }, delta });
    };
    apply(b, rb, d, sb);
    apply(w, rw, -d, 1 - sb);
  }

  private sendStart(r: Room, only?: Player) {
    const info = (c: number): Opponent => {
      const p = r.who[c];
      return p ? this.oppInfo(p, r.kind, r.type) : { name: '?' };
    };
    for (const c of [BLACK, WHITE]) {
      const p = this.seat(r, c);
      if (!p || (only && p !== only)) continue;
      this.send(p, {
        t: 'start',
        kind: r.kind,
        color: c,
        type: r.type,
        size: r.size,
        renju: r.renju,
        moveTime: r.moveTime,
        black: info(BLACK),
        white: info(WHITE),
      });
    }
  }

  private newRoomGame(r: Room) {
    r.g = new Game();
    r.g.newGame(r.type === 0 ? GameType.Gomoku : GameType.Go, r.size, { renju: r.type === 0 && r.renju });
    r.acts = [];
    r.ask = null;
    r.undoUsed = [0, 0, 0];
    r.drawUsed = [0, 0, 0];
    r.agreed = [false, false, false];
    r.state = RoomState.Play;
    r.paused = 0;
    r.result = null;
    r.rated = [null, null, null];
  }

  private freeRoom(r: Room) {
    this.rooms.delete(r.id);
  }

  /** 玩家离开房间（主动离开或彻底断开） */
  private leaveRoom(p: Player) {
    const r = this.rooms.get(p.room);
    p.room = 0;
    if (!r) return;
    if (r.state === RoomState.Wait) {
      this.freeRoom(r);
      return;
    }
    const c = this.colorOf(r, p);
    if (!c) return;
    if (r.state === RoomState.Play) this.finish(r, 3 - c, 'left');
    r.pid[c] = 0;
    r.ask = null;
    this.send(this.seat(r, 3 - c), { t: 'left' });
    if (!r.pid[BLACK] && !r.pid[WHITE]) this.freeRoom(r);
  }

  /** 回应一项待定申请 */
  private resolveAsk(r: Room, ok: boolean) {
    const kind = r.ask,
      from = r.askFrom;
    if (!kind) return;
    r.ask = null;
    this.send(this.seat(r, from), { t: 'answer', kind, ok });
    if (kind === 'undo') {
      if (ok) {
        const g = r.g;
        let n = g.cur.toMove === from ? 2 : 1; // 轮到申请方：对方已经应了一手，要连那一手一起退
        n = Math.min(n, g.hist.length);
        for (let i = 0; i < n; i++) g.undo();
        this.addAct(r, { k: 'U', n });
        this.broadcast(r, { t: 'undone', n });
      }
      if (r.state === RoomState.Play) this.startTurn(r);
    } else if (kind === 'draw') {
      if (ok) this.finish(r, 3, 'draw');
      else if (r.state === RoomState.Play) this.startTurn(r);
    } else if (kind === 'rematch' && ok) {
      const b = this.seat(r, BLACK),
        w = this.seat(r, WHITE);
      if (b && w) this.seatPlayers(r, w, b, BLACK); // 交换先后手
    }
  }

  /** 重连：把整局动作回放给客户端，再补上点目确认、待回应的申请与计时 */
  private resync(r: Room, p: Player) {
    this.sendStart(r, p);
    this.send(p, { t: 'sync', acts: r.acts.slice() });
    for (const c of [BLACK, WHITE]) if (r.agreed[c]) this.send(p, { t: 'agreed', color: c });
    if (r.state === RoomState.Over) {
      // 掉线期间对局已经结束：补发结果与排位结算
      if (r.result) this.send(p, { t: 'over', ...r.result });
      const rt = r.rated[this.colorOf(r, p)];
      if (rt) this.send(p, { t: 'rated', ...rt });
      return;
    }
    const me = this.colorOf(r, p);
    if (r.ask && r.askFrom !== me) this.send(p, { t: 'ask', kind: r.ask });
    this.send(p, { t: 'turn', color: r.g.cur.toMove, secs: r.deadline ? Math.round(r.deadline - this.now()) : -1 });
  }

  /** 非法消息（API-015）：版本不符时提示更新，其余回复格式错误后丢弃；都累计一次违规。每条连接只记第一条的日志，免得被刷屏 */
  private rejectInvalid(p: Player, m: Invalid) {
    if (m.invalid === 'version') this.send(p, { t: 'error', text: '客户端版本与服务器不一致，请更新游戏' });
    else {
      this.send(p, { t: 'error', text: '消息格式错误' });
      if (p.invalid++ === 0) this.log(`非法消息（${p.id ? `玩家 ${p.id}` : '未握手的连接'}）：${m.why}`);
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
    const resuming = m.token !== undefined;
    if (resuming) {
      // 带令牌：找回掉线的自己
      for (const o of this.players) {
        if (o === p || !o.id || o.token !== m.token) continue;
        const old = o.conn;
        if (old) {
          // 旧连接其实已经断了，只是还没被发现：由新连接接管
          o.conn = null;
          old.close();
        }
        o.conn = p.conn;
        o.lastSeen = this.now();
        this.players.delete(p);
        p.conn = null;
        this.send(o, { t: 'welcome', id: o.id, token: o.token, ratings: o.ratings, ...this.latest });
        const r = this.rooms.get(o.room);
        if (r && r.state !== RoomState.Wait) {
          const resume = r.state === RoomState.Play && r.paused > 0 && this.bothOnline(r);
          if (resume) {
            r.deadline = this.now() + r.paused;
            r.paused = 0;
          }
          this.resync(r, o);
          const opp = this.seat(r, other(this.colorOf(r, o)));
          this.send(opp, { t: 'peer', online: true });
          if (resume) this.send(opp, { t: 'turn', color: r.g.cur.toMove, secs: Math.round(r.deadline - this.now()) });
        }
        this.log(`${o.name} 重新连上`);
        return o;
      }
    }
    p.name = cleanName(m.name, '棋手');
    p.id = this.nextPlayer++;
    p.token = hex(TOKEN_BYTES);
    p.key = key;
    const saved = this.store.get(p.key);
    p.ratings = { gomoku: { ...newRating(), ...saved?.gomoku }, go: { ...newRating(), ...saved?.go } };
    this.send(p, { t: 'welcome', id: p.id, token: p.token, ratings: p.ratings, ...this.latest });
    if (resuming) this.send(p, { t: 'resumeFailed' }); // 原来的对局已经不在了（服务器重启过，或掉线太久）
    this.log(`${p.name} 上线（玩家 ${p.id}）`);
    return p;
  }

  /** 握手之后的消息：先看是不是不在对局中也能发的，再按房间的状态交给对局中或终局后的处理 */
  private handle(p: Player, m: C2S) {
    p.lastSeen = this.now();
    if (this.lobby(p, m)) return;
    const r = this.rooms.get(p.room),
      me = r ? this.colorOf(r, p) : 0;
    if (!r || !me) return;
    if (r.state === RoomState.Over) this.afterGame(r, p, me, m);
    else if (r.state === RoomState.Play) this.inGame(r, p, me, m);
  }

  /** 不在对局中也能发的消息（匹配、房间、改名、心跳）；处理了返回 true */
  private lobby(p: Player, m: C2S): boolean {
    switch (m.t) {
      case 'ping':
        this.send(p, { t: 'pong' });
        return true;
      case 'leave':
        this.leaveRoom(p);
        return true;
      case 'name':
        this.rename(p, m.name);
        return true;
      case 'queue':
        if (this.allow(p, 'queue')) this.queueFor(p, m.mode, m.type, m.size);
        return true;
      case 'unqueue':
        if (this.allow(p, 'queue')) this.unqueue(p);
        return true;
      case 'confirm':
        this.confirm(p, m.ok);
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
    if (this.busy(p)) {
      this.send(p, { t: 'error', text: '你已经在一个房间里了' });
      return;
    }
    if (mode === 'ranked' && this.rankedElsewhere(p)) {
      this.send(p, { t: 'error', text: '这台设备已经在排位中了' });
      return;
    }
    this.unqueue(p);
    this.enqueue(p, mode, type, size);
  }

  private createRoom(p: Player, m: Extract<C2S, { t: 'create' }>) {
    if (this.busy(p)) {
      this.send(p, { t: 'error', text: '你已经在一个房间里了' });
      return;
    }
    if (this.rooms.size >= MAX_ROOMS) {
      this.send(p, { t: 'error', text: '服务器房间已满，请稍后再试' });
      return;
    }
    this.unqueue(p);
    const size = m.type === 0 ? 15 : m.size === 9 || m.size === 13 ? m.size : 19; // 五子棋只有 15 路；围棋没有 15 路
    const r = this.newRoom('friend', m.type, size, m.type === 0 && m.renju, m.moveTime, m.hostColor, p.id);
    r.code = this.roomCode();
    p.room = r.id;
    this.send(p, { t: 'created', code: r.code });
    this.log(`${p.name} 开房间 ${r.code}`);
  }

  /** 房主关闭尚未开始的房间 */
  private closeRoom(p: Player) {
    const r = this.rooms.get(p.room);
    if (r && r.state === RoomState.Wait && r.host === p.id) {
      p.room = 0;
      this.freeRoom(r);
    }
  }

  private joinRoom(p: Player, code: string) {
    const now = this.now();
    p.joinFails = p.joinFails.filter(t0 => now - t0 < JOIN_WINDOW_SECS);
    if (p.joinFails.length >= JOIN_FAILS) {
      this.send(p, { t: 'joinNo', reason: '尝试次数太多，请稍后再试' });
      this.violate(p);
      return;
    } // E3
    const r = [...this.rooms.values()].find(o => o.state === RoomState.Wait && o.code === code);
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
    const host = this.byId(r.host);
    if (!host || !host.conn) {
      this.freeRoom(r);
      noRoom();
      return;
    }
    if (host === p) {
      this.send(p, { t: 'joinNo', reason: '这是你自己的房间' });
      return;
    }
    this.unqueue(p);
    const hostColor = r.hostColor === 2 ? this.randomColor() : r.hostColor === 1 ? WHITE : BLACK; // hostColor：0 执黑 1 执白 2 随机
    this.seatPlayers(r, host, p, hostColor);
  }

  /** 随机分先：黑白各半 */
  private randomColor() {
    return this.random() < 1 / 2 ? BLACK : WHITE;
  }

  /** 终局后：只接受再来一局的申请与回应 */
  private afterGame(r: Room, p: Player, me: number, m: C2S) {
    if (m.t === 'reply' && m.kind === 'rematch' && r.ask === 'rematch' && r.askFrom !== me) {
      this.resolveAsk(r, m.ok);
      return;
    }
    if (m.t !== 'rematch') return;
    const opp = this.seat(r, other(me));
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
        if (m.kind !== 'rematch' && r.ask === m.kind && r.askFrom !== me) this.resolveAsk(r, m.ok);
        return;
      case 'resign':
        this.finish(r, other(me), 'resign');
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
    this.send(this.seat(r, other(me)), { t: 'ask', kind });
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
    this.addAct(r, { k: 'M', x, y });
    this.broadcast(r, { t: 'moved', x, y });
    if (g.over) this.finish(r, g.winner, g.winner === DRAWN ? 'full' : 'five');
    else this.startTurn(r);
  }

  private passTurn(r: Room, me: number) {
    const g = r.g;
    if (g.type !== GameType.Go || g.scoring || g.cur.toMove !== me || r.ask) return;
    g.pass();
    this.addAct(r, { k: 'P' });
    this.broadcast(r, { t: 'passed' });
    r.agreed = [false, false, false];
    this.startTurn(r);
  }

  private askUndo(r: Room, p: Player, me: number) {
    const g = r.g;
    if (r.ask || g.scoring) {
      this.send(p, { t: 'info', text: '现在不能申请悔棋' });
      return;
    }
    if (r.undoUsed[me] >= UNDO_LIMIT) {
      this.send(p, { t: 'info', text: '本局悔棋次数已用完' });
      return;
    }
    if (g.hist.length < (g.cur.toMove === me ? 2 : 1)) {
      this.send(p, { t: 'info', text: '你还没有可以悔的棋' });
      return;
    } // 轮到自己时要连对方那一手一起退
    r.undoUsed[me]++;
    this.ask(r, me, 'undo');
  }

  private askDraw(r: Room, p: Player, me: number) {
    if (r.ask) {
      this.send(p, { t: 'info', text: '请先等对方回应申请' });
      return;
    }
    if (r.drawUsed[me] >= DRAW_LIMIT) {
      this.send(p, { t: 'info', text: '本局求和次数已用完' });
      return;
    }
    r.drawUsed[me]++;
    this.ask(r, me, 'draw');
  }

  /** 点目时标记 / 取消死子（点在空处或本局棋盘之外的忽略） */
  private markDead(r: Room, x: number, y: number) {
    const g = r.g;
    if (!g.scoring || !g.inB(x, y) || !g.b(x, y)) return;
    g.toggleDead(x, y);
    this.addAct(r, { k: 'K', x, y });
    r.agreed = [false, false, false];
    this.broadcast(r, { t: 'marked', x, y });
  }

  /** 确认点目结果；双方都确认后终局 */
  private agreeScore(r: Room, me: number) {
    const g = r.g;
    if (!g.scoring || r.agreed[me]) return;
    r.agreed[me] = true;
    this.broadcast(r, { t: 'agreed', color: me });
    if (!r.agreed[BLACK] || !r.agreed[WHITE]) return;
    g.computeScore();
    g.confirmScore();
    this.finish(r, g.winner, 'score');
  }

  /** 点目有分歧：回到对局 */
  private resumePlay(r: Room) {
    const g = r.g;
    if (!g.scoring) return;
    g.resume();
    this.addAct(r, { k: 'R' });
    r.agreed = [false, false, false];
    this.broadcast(r, { t: 'resumed' });
    this.startTurn(r);
  }
}
