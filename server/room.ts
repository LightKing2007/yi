/**
 * 房间的生命周期（整改项 P2-12 自 rooms.ts 拆出）：开房间、入座开局、房号、每一手的计时、终局与手数上限、
 * 开局信息与重连时的回放、离开与释放，以及申请（悔棋、求和、再来一局）的回应。
 */
import { Game } from '../src/core/game';
import { BLACK, GameType, WHITE, other } from '../src/core/types';
import { ACTS_MAX, DRAWN, MOVES_MAX, type Act, type GameKind, type Opponent, type OverReason, type S2C } from '../src/shared/protocol';
import { oppInfo } from './matchmaking';
import { markTurn, recordEnd, recordStart } from './record';
import { RoomState, type Player, type Room, type RoomRules, type RoomSeat, type ServerContext } from './roomTypes';

/** 房号为四位数：[CODE_MIN, CODE_MIN + CODE_SPAN) */
const CODE_MIN = 1000,
  CODE_SPAN = 9000;
/** 随机挑房号的尝试次数；都撞上时按顺序找一个空闲的 */
const CODE_TRIES = 100;

/** 房间的时限：申请无人回应，视为拒绝；本手超时，判负 */
export function tickRoom(ctx: ServerContext, r: Room, now: number) {
  if (r.ask && now > r.askUntil) resolveAsk(ctx, r, false);
  if (r.state === RoomState.Play && r.deadline && now > r.deadline) finish(ctx, r, { winner: other(r.g.cur.toMove), reason: 'timeout' });
}

/** 按玩家号找在线玩家（含掉线待重连的）；0 或找不到时为 undefined */
export function byId(ctx: ServerContext, id: number) {
  if (!id) return undefined;
  for (const p of ctx.players) if (p.id === id) return p;
  return undefined;
}

/** 房间中执 color 的玩家；已离开时为 undefined */
export function seat(ctx: ServerContext, r: Room, color: number) {
  return byId(ctx, r.pid[color] ?? 0);
}

/** 玩家在房间中执子的颜色；不在座时为 0 */
export function colorOf(r: Room, p: Player) {
  return r.pid[BLACK] === p.id ? BLACK : r.pid[WHITE] === p.id ? WHITE : 0;
}

/** 给对局双方各发一条消息 */
export function broadcast(ctx: ServerContext, r: Room, msg: S2C) {
  for (const color of [BLACK, WHITE]) ctx.send(seat(ctx, r, color), msg);
}

/** 记一条对局动作（重连时回放）；记满 ACTS_MAX 条后不再记，由 endAtLimit 结束对局 */
export function addAct(r: Room, act: Act) {
  if (r.acts.length < ACTS_MAX) r.acts.push(act);
}

/** 开一个房间：还没有人入座，状态为等待对手 */
export function newRoom(ctx: ServerContext, kind: GameKind, rules: RoomRules, seat: RoomSeat): Room {
  const r: Room = {
    id: ctx.nextRoom++,
    kind,
    code: '',
    state: RoomState.Wait,
    type: rules.type,
    size: rules.size,
    hostColor: seat.hostColor,
    renju: rules.renju,
    moveTime: rules.moveTime,
    host: seat.host,
    gameId: 0,
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
    recordId: 0,
    turnAt: 0,
    turnPly: -1,
  };
  ctx.rooms.set(r.id, r);
  return r;
}

/** 入座开局：first 执 firstColor */
export function seatPlayers(ctx: ServerContext, r: Room, [first, second]: [Player, Player], firstColor: number) {
  const secondColor = other(firstColor);
  r.pid[firstColor] = first.id;
  r.pid[secondColor] = second.id;
  r.who[firstColor] = first;
  r.who[secondColor] = second;
  first.room = second.room = r.id;
  newRoomGame(ctx, r);
  recordStart(ctx, r);
  sendStart(ctx, r);
  startTurn(ctx, r);
  ctx.log('info', 'game.start', {
    msg: `房间 ${r.id}（${r.kind}）开局：${r.who[BLACK]?.name} 对 ${r.who[WHITE]?.name}`,
    roomId: r.id,
    gameId: r.gameId,
    kind: r.kind,
  });
}

/**
 * 四位房号，与等待中的房间不重复。房间数上限（MAX_ROOMS）远小于房号总数，按顺序找总能找到；
 * 房号必须是四位数，否则客户端发来的 join 过不了校验（API-013）
 */
export function roomCode(ctx: ServerContext) {
  const taken = new Set<string>();
  for (const r of ctx.rooms.values()) if (r.state === RoomState.Wait) taken.add(r.code);
  for (let i = 0; i < CODE_TRIES; i++) {
    const code = String(CODE_MIN + Math.floor(ctx.random() * CODE_SPAN));
    if (!taken.has(code)) return code;
  }
  for (let n = CODE_MIN; ; n++) if (!taken.has(String(n))) return String(n);
}

/** 新的一手开始：重新计时并通知双方 */
export function startTurn(ctx: ServerContext, r: Room) {
  markTurn(ctx, r);
  const timed = r.moveTime > 0 && !r.g.scoring;
  r.deadline = timed && bothOnline(ctx, r) ? ctx.now() + r.moveTime : 0;
  r.paused = timed && !r.deadline ? r.moveTime : 0;
  broadcast(ctx, r, { t: 'turn', color: r.g.cur.toMove, secs: r.deadline ? r.moveTime : -1 });
}

/** 对局双方都连着 */
export function bothOnline(ctx: ServerContext, r: Room) {
  return !!(seat(ctx, r, BLACK)?.conn && seat(ctx, r, WHITE)?.conn);
}

/** 达到对局上限的终局原因（API-046） */
const isLimit = (reason: OverReason) => reason === 'limit-moves' || reason === 'limit-acts';

/** 结束对局并写入对局记录；因达到上限而结束的（终局原因 limit-moves、limit-acts）记为 limit，排位赛也不结算段位 */
export function finish(ctx: ServerContext, r: Room, { winner, reason }: { winner: number; reason: OverReason }) {
  const atLimit = isLimit(reason);
  if (r.state !== RoomState.Play) return;
  r.state = RoomState.Over;
  r.ask = null;
  r.deadline = 0;
  r.paused = 0;
  r.result = { winner, reason };
  broadcast(ctx, r, { t: 'over', winner, reason });
  ctx.log('info', 'game.over', { msg: `房间 ${r.id} 结束`, roomId: r.id, gameId: r.gameId, winner, reason, moves: r.g.moves.length });
  ctx.metrics?.inc('yi_games_finished_total', { kind: r.kind, reason });
  recordEnd(ctx, r, { winner, reason, stored: atLimit ? 'limit' : reason, rated: r.kind === 'ranked' && !atLimit });
}

/**
 * 对局达到手数上限（MOVES_MAX，停一手也计入）或动作记录上限（ACTS_MAX）时按和棋结束（API-046）：
 * 终局原因 limit-moves 或 limit-acts 说明达到的是哪一项上限，客户端据此显示；排位赛这一局不结算段位
 */
export function endAtLimit(ctx: ServerContext, r: Room) {
  const moves = r.g.hist.length,
    acts = r.acts.length;
  const reason = moves >= MOVES_MAX ? 'limit-moves' : acts >= ACTS_MAX ? 'limit-acts' : null;
  if (!reason || r.state !== RoomState.Play) return;
  finish(ctx, r, { winner: DRAWN, reason });
  ctx.log('warn', 'game.limit', { msg: `房间 ${r.id} 达到上限，按和棋结束`, roomId: r.id, gameId: r.gameId, moves, acts });
}

/** 发开局信息；only 给定时只发给这一方（重连时） */
export function sendStart(ctx: ServerContext, r: Room, only?: Player) {
  const info = (color: number): Opponent => {
    const p = r.who[color];
    return p ? oppInfo(p, r.kind, r.type) : { name: '?' };
  };
  for (const color of [BLACK, WHITE]) {
    const p = seat(ctx, r, color);
    if (!p || (only && p !== only)) continue;
    ctx.send(p, {
      t: 'start',
      kind: r.kind,
      color,
      type: r.type,
      size: r.size,
      renju: r.renju,
      moveTime: r.moveTime,
      black: info(BLACK),
      white: info(WHITE),
    });
  }
}

/** 房间开新的一局：换新的对局编号与 Game，清空动作记录、申请与上一局的结果 */
export function newRoomGame(ctx: ServerContext, r: Room) {
  r.gameId = ctx.nextGame++;
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

/** 释放房间 */
export function freeRoom(ctx: ServerContext, r: Room) {
  ctx.rooms.delete(r.id);
}

/** 玩家离开房间（主动离开或彻底断开） */
export function leaveRoom(ctx: ServerContext, p: Player) {
  const r = ctx.rooms.get(p.room);
  p.room = 0;
  if (!r) return;
  if (r.state === RoomState.Wait) {
    freeRoom(ctx, r);
    return;
  }
  const color = colorOf(r, p);
  if (!color) return;
  if (r.state === RoomState.Play) finish(ctx, r, { winner: other(color), reason: 'left' });
  r.pid[color] = 0;
  r.ask = null;
  ctx.send(seat(ctx, r, other(color)), { t: 'left' });
  if (!r.pid[BLACK] && !r.pid[WHITE]) freeRoom(ctx, r);
}

/** 回应一项待定申请 */
export function resolveAsk(ctx: ServerContext, r: Room, ok: boolean) {
  const kind = r.ask,
    from = r.askFrom;
  if (!kind) return;
  r.ask = null;
  ctx.send(seat(ctx, r, from), { t: 'answer', kind, ok });
  if (kind === 'undo') {
    if (ok) {
      const g = r.g;
      let n = g.cur.toMove === from ? 2 : 1; // 轮到申请方：对方已经应了一手，要连那一手一起退
      n = Math.min(n, g.hist.length);
      for (let i = 0; i < n; i++) g.undo();
      addAct(r, { k: 'U', n });
      broadcast(ctx, r, { t: 'undone', n });
    }
    if (r.state === RoomState.Play) startTurn(ctx, r);
  } else if (kind === 'draw') {
    if (ok) finish(ctx, r, { winner: DRAWN, reason: 'draw' });
    else if (r.state === RoomState.Play) startTurn(ctx, r);
  } else if (kind === 'rematch' && ok) {
    const black = seat(ctx, r, BLACK),
      white = seat(ctx, r, WHITE);
    if (black && white) seatPlayers(ctx, r, [white, black], BLACK); // 交换先后手
  }
}

/** 重连：把整局动作回放给客户端，再补上点目确认、待回应的申请与计时 */
export function resync(ctx: ServerContext, r: Room, p: Player) {
  sendStart(ctx, r, p);
  ctx.send(p, { t: 'sync', acts: r.acts.slice() });
  for (const color of [BLACK, WHITE]) if (r.agreed[color]) ctx.send(p, { t: 'agreed', color });
  if (r.state === RoomState.Over) {
    // 掉线期间对局已经结束：补发结果与排位结算
    if (r.result) ctx.send(p, { t: 'over', ...r.result });
    const rt = r.rated[colorOf(r, p)];
    if (rt) ctx.send(p, { t: 'rated', ...rt });
    return;
  }
  const me = colorOf(r, p);
  if (r.ask && r.askFrom !== me) ctx.send(p, { t: 'ask', kind: r.ask });
  ctx.send(p, { t: 'turn', color: r.g.cur.toMove, secs: r.deadline ? Math.round(r.deadline - ctx.now()) : -1 });
}
