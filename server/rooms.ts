/**
 * 弈 · 联机服务端核心：匹配 / 排位队列、配对确认、好友房间、对局、段位与超时。与传输无关（WebSocket 由 host.ts 接上）。
 *
 * 对局规则直接复用 src/core/game.ts：每个房间一份 Game，客户端发来的每一手都在这里校验，
 * 所以服务端与客户端的判定完全一致。协议见 src/shared/protocol.ts。
 */
import { createHash } from 'node:crypto';
import { Game } from '../src/core/game';
import { BLACK, GameType, WHITE } from '../src/core/types';
import {
  ASK_SECS, CONFIRM_SECS, DRAW_LIMIT, GRACE_SECS, IDLE_SECS, PROTO_VERSION, UNDO_LIMIT, cleanName, newRating, queueRules,
  type Act, type AskKind, type C2S, type GameKind, type Opponent, type OverReason, type QueueMode, type Rating, type Ratings, type S2C,
} from '../src/shared/protocol';

/** 一条连接：服务端只需要能发消息、能关掉 */
export interface Conn { send(msg: S2C): void; close(): void }

/** 段位分的存放处（独立服务端存到文件，测试里放内存） */
export interface RatingStore { get(key: string): Ratings | undefined; set(key: string, r: Ratings, name: string): void }

export class MemoryStore implements RatingStore {
  private m = new Map<string, Ratings>();
  get(key: string) { return this.m.get(key); }
  set(key: string, r: Ratings) { this.m.set(key, r); }
}

const MAX_PLAYERS = 2048;
const MAX_ROOMS = 1024;
const MAX_ACTS = 4096;
const ELO_K = 32;

interface QEntry { p: Player; mode: QueueMode; type: number; size: number; since: number }

interface Match {
  mode: QueueMode; type: number; size: number;
  side: [QEntry, QEntry];
  ok: [boolean, boolean];
  deadline: number;
}

interface Player {
  id: number;                     // 0 表示还没握手
  conn: Conn | null;              // null 表示掉线（对局中还可以用令牌回来）
  name: string;
  token: string;
  key: string;                    // 段位的归属（由客户端的匿名 uid 散列而来）
  ratings: Ratings;
  lastSeen: number;
  offAt: number;
  room: number;                   // 所在房间号，0 表示不在房间
  queued: QEntry | null;          // 正在匹配
  match: Match | null;            // 已配对、等双方确认
}

const enum RS { Wait, Play, Over }

interface Room {
  id: number;
  kind: GameKind;
  code: string;                   // 好友房间的房号
  state: RS;
  type: number; size: number; hostColor: number; renju: boolean; moveTime: number;
  host: number;                   // 好友房间的房主
  pid: [number, number, number];  // pid[BLACK] / pid[WHITE] 对局双方的玩家号
  who: [Player | null, Player | null, Player | null];   // 开局时的双方（排位结算用，掉线清理后也还在）
  g: Game;
  acts: Act[];
  ask: AskKind | null; askFrom: number; askUntil: number;
  undoUsed: number[]; drawUsed: number[]; agreed: boolean[];
  deadline: number;               // 本手限时截止时刻；0 表示不计时
  paused: number;                 // 掉线时暂停，保存剩余秒数
}

export interface RoomServerOptions {
  now?: () => number;             // 秒
  random?: () => number;
  log?: (text: string) => void;
  store?: RatingStore;
}

/** 连接对象：由传输层持有，收到消息时交回 RoomServer */
export type Session = Player;

const int = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
const typeKey = (type: number) => (type ? 'go' : 'gomoku') as keyof Ratings;
const hex = (n: number) => { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return Array.from(b, v => v.toString(16).padStart(2, '0')).join(''); };

export class RoomServer {
  private players = new Set<Player>();
  private rooms = new Map<number, Room>();
  private queue: QEntry[] = [];
  private matches = new Set<Match>();
  private nextPlayer = 1;
  private nextRoom = 1;
  private now: () => number;
  private random: () => number;
  private log: (text: string) => void;
  private store: RatingStore;

  constructor(opt: RoomServerOptions = {}) {
    this.now = opt.now ?? (() => performance.now() / 1000);
    this.random = opt.random ?? Math.random;
    this.log = opt.log ?? (() => {});
    this.store = opt.store ?? new MemoryStore();
  }

  // ---------------- 对外接口 ----------------

  /** 新连接；满员时返回 null（调用方应关闭连接） */
  connect(conn: Conn): Session | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const p: Player = { id: 0, conn, name: '', token: '', key: '', ratings: { gomoku: newRating(), go: newRating() }, lastSeen: this.now(), offAt: 0, room: 0, queued: null, match: null };
    this.players.add(p);
    return p;
  }

  /** 收到一条消息（已解析的 JSON；格式不对的直接忽略）。返回此后该连接对应的会话（带令牌重连时换成原来的玩家） */
  message(p: Session, raw: unknown): Session {
    if (!this.players.has(p) || !p.conn || !raw || typeof raw !== 'object') return p;
    const m = raw as C2S;
    if (typeof m.t !== 'string') return p;
    if (!p.id) return this.hello(p, m);
    this.handle(p, m);
    return p;
  }

  /** 连接还活着（WebSocket 层的心跳回应）：浏览器把页面放到后台时脚本的定时器会被放慢，但心跳照常回应 */
  touch(p: Session) { if (this.players.has(p) && p.conn) p.lastSeen = this.now(); }

  /** 连接断开：对局中保留席位等待重连，其余情况直接离开 */
  disconnect(p: Session) {
    if (!this.players.has(p) || !p.conn) return;
    p.conn = null;
    p.offAt = this.now();
    if (!p.id) { this.players.delete(p); return; }
    this.log(`${p.name} 断开`);
    this.unqueue(p);
    if (p.match) this.dropMatch(p.match, [p], '对方已离开');
    const r = this.rooms.get(p.room);
    if (r && r.state === RS.Play) {
      if (r.deadline) { r.paused = r.deadline - this.now(); r.deadline = 0; }
      this.send(this.seat(r, 3 - this.colorOf(r, p)), { t: 'peer', online: false, wait: GRACE_SECS });
      return;
    }
    this.leaveRoom(p);
    this.players.delete(p);
  }

  /** 定时调用（建议每 0.25 秒）：检查各种超时 */
  tick() {
    const now = this.now();
    for (const m of [...this.matches]) {                                   // 确认超时：没点接受的一方作罢
      if (now > m.deadline) this.dropMatch(m, m.side.filter((_, i) => !m.ok[i]).map(e => e.p), '对方未确认');
    }
    for (const r of [...this.rooms.values()]) {
      if (!this.rooms.has(r.id)) continue;
      if (r.ask && now > r.askUntil) this.resolveAsk(r, false);            // 申请无人回应，视为拒绝
      if (r.state === RS.Play && r.deadline && now > r.deadline) this.finish(r, 3 - r.g.cur.toMove, 'timeout');
    }
    for (const p of [...this.players]) {
      if (!this.players.has(p)) continue;
      if (p.conn && now - p.lastSeen > IDLE_SECS) {                         // 太久没消息：当作断线
        const c = p.conn;
        this.disconnect(p);
        c.close();
        continue;
      }
      if (!p.conn && now - p.offAt > GRACE_SECS) {                           // 掉线太久：对局判负并清理
        const r = this.rooms.get(p.room);
        if (r && r.state === RS.Play) this.finish(r, 3 - this.colorOf(r, p), 'disconnect');
        this.leaveRoom(p);
        this.players.delete(p);
      }
    }
  }

  online() { let n = 0; for (const p of this.players) if (p.conn && p.id) n++; return n; }
  /** 正在匹配的人数（按队列） */
  queued(mode: QueueMode, type: number) { return this.queue.filter(e => e.mode === mode && e.type === type).length; }

  shutdown() {
    for (const p of this.players) p.conn?.close();
    this.players.clear();
    this.rooms.clear();
    this.queue = [];
    this.matches.clear();
  }

  // ---------------- 内部 ----------------

  private send(p: Player | null | undefined, msg: S2C) { if (p?.conn) p.conn.send(msg); }
  private byId(id: number) { if (!id) return undefined; for (const p of this.players) if (p.id === id) return p; return undefined; }
  private seat(r: Room, color: number) { return this.byId(r.pid[color]); }
  private colorOf(r: Room, p: Player) { return r.pid[BLACK] === p.id ? BLACK : r.pid[WHITE] === p.id ? WHITE : 0; }
  private broadcast(r: Room, msg: S2C) { for (const c of [BLACK, WHITE]) this.send(this.seat(r, c), msg); }
  private addAct(r: Room, a: Act) { if (r.acts.length < MAX_ACTS) r.acts.push(a); }
  private busy(p: Player) { return !!(p.room || p.match); }

  // ---------------- 匹配与排位 ----------------

  private enqueue(p: Player, mode: QueueMode, type: number, size: number, since = this.now()) {
    const rules = queueRules(mode, type, size);
    const e: QEntry = { p, mode, type: rules.type, size: rules.size, since };
    // 队列按进入的先后排好；与同一队列里等得最久的人配对
    const other = this.queue.find(o => o.p !== p && o.mode === e.mode && o.type === e.type && o.size === e.size && o.p.conn
      && !(mode === 'ranked' && o.p.key === p.key));                       // 排位不和自己（同一台设备）配对
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
      const me = m.side[i].p, opp = m.side[1 - i].p;
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
      if (culprits.includes(e.p)) { this.send(e.p, { t: 'unmatched', requeued: false, reason: '' }); continue; }
      this.send(e.p, { t: 'unmatched', requeued: true, reason });
      if (e.p.conn) this.enqueue(e.p, e.mode, e.type, e.size, e.since);
    }
  }

  private confirm(p: Player, ok: boolean) {
    const m = p.match;
    if (!m) return;
    const i = m.side[0].p === p ? 0 : 1;
    if (!ok) { this.dropMatch(m, [p], '对方未接受'); return; }
    if (m.ok[i]) return;
    m.ok[i] = true;
    if (!m.ok[1 - i]) { this.send(m.side[1 - i].p, { t: 'accepted' }); return; }
    this.matches.delete(m);
    for (const e of m.side) e.p.match = null;
    const rules = queueRules(m.mode, m.type, m.size);
    const r = this.newRoom(m.mode, rules.type, rules.size, rules.renju, rules.moveTime, 2, 0);
    this.seatPlayers(r, m.side[0].p, m.side[1].p, this.random() < 0.5 ? BLACK : WHITE);
  }

  // ---------------- 房间 ----------------

  private newRoom(kind: GameKind, type: number, size: number, renju: boolean, moveTime: number, hostColor: number, host: number): Room {
    const r: Room = {
      id: this.nextRoom++, kind, code: '', state: RS.Wait, type, size, hostColor, renju, moveTime, host,
      pid: [0, 0, 0], who: [null, null, null], g: new Game(), acts: [],
      ask: null, askFrom: 0, askUntil: 0, undoUsed: [0, 0, 0], drawUsed: [0, 0, 0], agreed: [false, false, false],
      deadline: 0, paused: 0,
    };
    this.rooms.set(r.id, r);
    return r;
  }

  /** 入座开局：a 执 aColor */
  private seatPlayers(r: Room, a: Player, b: Player, aColor: number) {
    r.pid[aColor] = a.id; r.pid[3 - aColor] = b.id;
    r.who[aColor] = a; r.who[3 - aColor] = b;
    a.room = b.room = r.id;
    this.newRoomGame(r);
    this.sendStart(r);
    this.startTurn(r);
    this.log(`房间 ${r.id}（${r.kind}）开局：${r.who[BLACK]?.name} 对 ${r.who[WHITE]?.name}`);
  }

  /** 四位房号，与等待中的房间不重复 */
  private roomCode() {
    for (let i = 0; i < 100; i++) {
      const c = String(1000 + Math.floor(this.random() * 9000));
      if (![...this.rooms.values()].some(r => r.state === RS.Wait && r.code === c)) return c;
    }
    return String(10000 + this.nextRoom);
  }

  /** 新的一手开始：重新计时并通知双方 */
  private startTurn(r: Room) {
    r.deadline = r.moveTime > 0 && !r.g.scoring ? this.now() + r.moveTime : 0;
    this.broadcast(r, { t: 'turn', color: r.g.cur.toMove, secs: r.deadline ? r.moveTime : -1 });
  }

  private finish(r: Room, winner: number, reason: OverReason) {
    if (r.state !== RS.Play) return;
    r.state = RS.Over;
    r.ask = null;
    r.deadline = 0;
    this.broadcast(r, { t: 'over', winner, reason });
    this.log(`房间 ${r.id} 结束：胜方 ${winner}（${reason}）`);
    if (r.kind === 'ranked') this.rate(r, winner);
  }

  /** 排位结算（Elo）：胜方至少加 1 分 */
  private rate(r: Room, winner: number) {
    const b = r.who[BLACK], w = r.who[WHITE];
    if (!b || !w) return;
    const k = typeKey(r.type), rb = b.ratings[k], rw = w.ratings[k];
    const eb = 1 / (1 + 10 ** ((rw.points - rb.points) / 400));
    const sb = winner === BLACK ? 1 : winner === WHITE ? 0 : 0.5;
    let d = Math.round(ELO_K * (sb - eb));
    if (sb === 1) d = Math.max(1, d);
    if (sb === 0) d = Math.min(-1, d);
    const apply = (p: Player, rt: Rating, delta: number, s: number) => {
      rt.points = Math.max(0, rt.points + delta);
      if (s === 1) rt.win++; else if (s === 0) rt.loss++; else rt.draw++;
      if (p.key) this.store.set(p.key, p.ratings, p.name);
      this.send(p, { t: 'rated', type: r.type, rating: { ...rt }, delta });
    };
    apply(b, rb, d, sb);
    apply(w, rw, -d, 1 - sb);
  }

  private sendStart(r: Room, only?: Player) {
    const info = (c: number): Opponent => { const p = r.who[c]; return p ? this.oppInfo(p, r.kind, r.type) : { name: '?' }; };
    for (const c of [BLACK, WHITE]) {
      const p = this.seat(r, c);
      if (!p || (only && p !== only)) continue;
      this.send(p, { t: 'start', kind: r.kind, color: c, type: r.type, size: r.size, renju: r.renju, moveTime: r.moveTime, black: info(BLACK), white: info(WHITE) });
    }
  }

  private newRoomGame(r: Room) {
    r.g = new Game();
    r.g.newGame(r.type === 0 ? GameType.Gomoku : GameType.Go, r.size, { renju: r.type === 0 && r.renju, vsAI: false });
    r.acts = [];
    r.ask = null;
    r.undoUsed = [0, 0, 0]; r.drawUsed = [0, 0, 0]; r.agreed = [false, false, false];
    r.state = RS.Play;
    r.paused = 0;
  }

  private freeRoom(r: Room) {
    this.rooms.delete(r.id);
  }

  /** 玩家离开房间（主动离开或彻底断开） */
  private leaveRoom(p: Player) {
    const r = this.rooms.get(p.room);
    p.room = 0;
    if (!r) return;
    if (r.state === RS.Wait) { this.freeRoom(r); return; }
    const c = this.colorOf(r, p);
    if (!c) return;
    if (r.state === RS.Play) this.finish(r, 3 - c, 'left');
    r.pid[c] = 0;
    r.ask = null;
    this.send(this.seat(r, 3 - c), { t: 'left' });
    if (!r.pid[BLACK] && !r.pid[WHITE]) this.freeRoom(r);
  }

  /** 回应一项待定申请 */
  private resolveAsk(r: Room, ok: boolean) {
    const kind = r.ask, from = r.askFrom;
    if (!kind) return;
    r.ask = null;
    this.send(this.seat(r, from), { t: 'answer', kind, ok });
    if (kind === 'undo') {
      if (ok) {
        const g = r.g;
        let n = g.cur.toMove === from ? 2 : 1;     // 轮到申请方：对方已经应了一手，要连那一手一起退
        n = Math.min(n, g.hist.length);
        for (let i = 0; i < n; i++) g.undo();
        this.addAct(r, { k: 'U', n });
        this.broadcast(r, { t: 'undone', n });
      }
      if (r.state === RS.Play) this.startTurn(r);
    } else if (kind === 'draw') {
      if (ok) this.finish(r, 3, 'draw');
      else if (r.state === RS.Play) this.startTurn(r);
    } else if (kind === 'rematch' && ok) {
      const b = this.seat(r, BLACK), w = this.seat(r, WHITE);
      if (b && w) this.seatPlayers(r, w, b, BLACK);   // 交换先后手
    }
  }

  /** 重连：把整局动作回放给客户端，再补上点目确认、待回应的申请与计时 */
  private resync(r: Room, p: Player) {
    this.sendStart(r, p);
    this.send(p, { t: 'sync', acts: r.acts.slice() });
    for (const c of [BLACK, WHITE]) if (r.agreed[c]) this.send(p, { t: 'agreed', color: c });
    if (r.state === RS.Over) return;
    const me = this.colorOf(r, p);
    if (r.ask && r.askFrom !== me) this.send(p, { t: 'ask', kind: r.ask });
    this.send(p, { t: 'turn', color: r.g.cur.toMove, secs: r.deadline ? Math.round(r.deadline - this.now()) : -1 });
  }

  private hello(p: Player, m: C2S): Player {
    if (m.t !== 'hello') { this.send(p, { t: 'error', text: '协议错误' }); return p; }
    if (int(m.v) !== PROTO_VERSION) { this.send(p, { t: 'error', text: '客户端版本与服务器不一致，请更新游戏' }); return p; }
    p.lastSeen = this.now();
    if (typeof m.token === 'string' && m.token) {             // 带令牌：找回掉线的自己
      for (const o of this.players) {
        if (o === p || o.conn || !o.id || o.token !== m.token) continue;
        o.conn = p.conn;
        o.lastSeen = this.now();
        this.players.delete(p);
        p.conn = null;
        this.send(o, { t: 'welcome', id: o.id, token: o.token, ratings: o.ratings });
        const r = this.rooms.get(o.room);
        if (r && r.state !== RS.Wait) {
          if (r.paused > 0) { r.deadline = this.now() + r.paused; r.paused = 0; }
          this.resync(r, o);
          this.send(this.seat(r, 3 - this.colorOf(r, o)), { t: 'peer', online: true });
        }
        this.log(`${o.name} 重新连上`);
        return o;
      }
    }
    p.name = cleanName(m.name, '棋手');
    p.id = this.nextPlayer++;
    p.token = hex(16);
    // 匿名身份：只存散列，存档里看不出原来的 uid
    const uid = typeof m.uid === 'string' && /^[0-9a-zA-Z-]{16,64}$/.test(m.uid) ? m.uid : '';
    p.key = uid ? createHash('sha256').update('yi:' + uid).digest('hex').slice(0, 32) : '';
    const saved = p.key ? this.store.get(p.key) : undefined;
    p.ratings = { gomoku: { ...newRating(), ...saved?.gomoku }, go: { ...newRating(), ...saved?.go } };
    this.send(p, { t: 'welcome', id: p.id, token: p.token, ratings: p.ratings });
    this.log(`${p.name} 上线（玩家 ${p.id}）`);
    return p;
  }

  private handle(p: Player, m: C2S) {
    p.lastSeen = this.now();
    const r = this.rooms.get(p.room);
    const me = r ? this.colorOf(r, p) : 0;

    switch (m.t) {
      case 'ping': this.send(p, { t: 'pong' }); return;
      case 'leave': this.leaveRoom(p); return;
      case 'name': if (!this.busy(p)) p.name = cleanName(m.name, p.name); return;
      case 'queue': {
        if (this.busy(p)) { this.send(p, { t: 'error', text: '你已经在一个房间里了' }); return; }
        this.unqueue(p);
        this.enqueue(p, m.mode === 'ranked' ? 'ranked' : 'match', int(m.type), int(m.size));
        return;
      }
      case 'unqueue': this.unqueue(p); return;
      case 'confirm': this.confirm(p, !!m.ok); return;
      case 'create': {
        if (this.busy(p)) { this.send(p, { t: 'error', text: '你已经在一个房间里了' }); return; }
        if (this.rooms.size >= MAX_ROOMS) { this.send(p, { t: 'error', text: '服务器房间已满，请稍后再试' }); return; }
        this.unqueue(p);
        const type = int(m.type) ? 1 : 0, sz = int(m.size), hc = int(m.hostColor);
        const nr = this.newRoom('friend', type, type === 0 ? 15 : sz === 9 || sz === 13 ? sz : 19, type === 0 && !!m.renju,
          Math.min(Math.max(int(m.moveTime), 0), 600), hc < 0 || hc > 2 ? 0 : hc, p.id);
        nr.code = this.roomCode();
        p.room = nr.id;
        this.send(p, { t: 'created', code: nr.code });
        this.log(`${p.name} 开房间 ${nr.code}`);
        return;
      }
      case 'close':
        if (r && r.state === RS.Wait && r.host === p.id) { p.room = 0; this.freeRoom(r); }
        return;
      case 'join': {
        const code = String(m.code ?? '').trim();
        const t = [...this.rooms.values()].find(o => o.state === RS.Wait && o.code === code);
        if (this.busy(p)) { this.send(p, { t: 'joinNo', reason: '你已经在一个房间里了' }); return; }
        if (!t) { this.send(p, { t: 'joinNo', reason: '房号不存在，或房间已经开始' }); return; }
        const host = this.byId(t.host);
        if (!host || !host.conn) { this.freeRoom(t); this.send(p, { t: 'joinNo', reason: '房号不存在，或房间已经开始' }); return; }
        if (host === p) { this.send(p, { t: 'joinNo', reason: '这是你自己的房间' }); return; }
        this.unqueue(p);
        const hc = t.hostColor === 2 ? (this.random() < 0.5 ? BLACK : WHITE) : t.hostColor === 1 ? WHITE : BLACK;
        this.seatPlayers(t, host, p, hc);
        return;
      }
    }

    // 以下为对局中的操作
    if (!r || !me) return;
    const other = this.seat(r, 3 - me);
    if (r.state === RS.Over) {
      if (m.t === 'rematch') {
        if (r.kind === 'ranked') this.send(p, { t: 'info', text: '排位赛不能再来一局' });
        else if (!r.ask && other?.conn) {
          r.ask = 'rematch'; r.askFrom = me; r.askUntil = this.now() + ASK_SECS;
          this.send(other, { t: 'ask', kind: 'rematch' });
        } else this.send(p, { t: 'info', text: r.ask ? '请先等对方回应' : '对方已离开，无法再来一局' });
      } else if (m.t === 'reply' && m.kind === 'rematch' && r.ask === 'rematch' && r.askFrom !== me) this.resolveAsk(r, !!m.ok);
      return;
    }
    if (r.state !== RS.Play) return;

    const g = r.g, toMove = g.cur.toMove, scoring = g.scoring;
    switch (m.t) {
      case 'move': {
        if (scoring || toMove !== me) { this.send(p, { t: 'info', text: '还没轮到你' }); return; }
        if (r.ask) { this.send(p, { t: 'info', text: '请先等对方回应申请' }); return; }
        const x = int(m.x), y = int(m.y);
        g.msg = null;
        const ok = g.play(x, y);
        const msg = g.msg as { key: string } | null;
        g.msg = null;
        if (!ok) { this.send(p, { t: 'info', text: msg?.key ?? '这里不能落子' }); return; }
        this.addAct(r, { k: 'M', x, y });
        this.broadcast(r, { t: 'moved', x, y });
        if (g.over) this.finish(r, g.winner, g.winner === 3 ? 'full' : 'five');
        else this.startTurn(r);
        return;
      }
      case 'pass':
        if (g.type !== GameType.Go || scoring || toMove !== me || r.ask) return;
        g.pass(); g.msg = null;
        this.addAct(r, { k: 'P' });
        this.broadcast(r, { t: 'passed' });
        r.agreed = [false, false, false];
        this.startTurn(r);
        return;
      case 'undo':
        if (r.ask || scoring) { this.send(p, { t: 'info', text: '现在不能申请悔棋' }); return; }
        if (r.undoUsed[me] >= UNDO_LIMIT) { this.send(p, { t: 'info', text: '本局悔棋次数已用完' }); return; }
        if (g.hist.length < (toMove === me ? 2 : 1)) { this.send(p, { t: 'info', text: '你还没有可以悔的棋' }); return; }
        r.undoUsed[me]++;
        r.ask = 'undo'; r.askFrom = me; r.askUntil = this.now() + ASK_SECS;
        r.deadline = 0;                                                  // 等回应时不计时
        this.send(other, { t: 'ask', kind: 'undo' });
        return;
      case 'draw':
        if (r.ask) { this.send(p, { t: 'info', text: '请先等对方回应申请' }); return; }
        if (r.drawUsed[me] >= DRAW_LIMIT) { this.send(p, { t: 'info', text: '本局求和次数已用完' }); return; }
        r.drawUsed[me]++;
        r.ask = 'draw'; r.askFrom = me; r.askUntil = this.now() + ASK_SECS;
        r.deadline = 0;
        this.send(other, { t: 'ask', kind: 'draw' });
        return;
      case 'reply':
        if ((m.kind === 'undo' || m.kind === 'draw') && r.ask === m.kind && r.askFrom !== me) this.resolveAsk(r, !!m.ok);
        return;
      case 'resign':
        this.finish(r, 3 - me, 'resign');
        return;
      case 'mark': {
        if (!scoring) return;
        const x = int(m.x), y = int(m.y);
        if (!g.inB(x, y) || !g.b(x, y)) return;
        g.toggleDead(x, y);
        this.addAct(r, { k: 'K', x, y });
        r.agreed = [false, false, false];
        this.broadcast(r, { t: 'marked', x, y });
        return;
      }
      case 'agree':
        if (!scoring || r.agreed[me]) return;
        r.agreed[me] = true;
        this.broadcast(r, { t: 'agreed', color: me });
        if (r.agreed[BLACK] && r.agreed[WHITE]) {
          g.computeScore(); g.confirmScore();
          this.finish(r, g.winner, 'score');
        }
        return;
      case 'resume':
        if (!scoring) return;
        g.resume();
        this.addAct(r, { k: 'R' });
        r.agreed = [false, false, false];
        this.broadcast(r, { t: 'resumed' });
        this.startTurn(r);
        return;
    }
  }
}
