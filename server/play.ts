/**
 * 对局中的请求（整改项 P2-12 自 rooms.ts 拆出）：落子、停一手、悔棋与求和的申请、认输、点目时标记死子与确认结果、
 * 点目有分歧时回到对局，以及终局后的再来一局。每一手都以 src/core/game.ts 的规则校验。
 */
import { errorMsg } from './errorMsg';
import { BLACK, GameType, WHITE, other } from '../src/core/types';
import { ASK_SECS, DRAWN, DRAW_LIMIT, UNDO_LIMIT, type AskKind, type C2S, type Stamp } from '../src/shared/protocol';
import { stampMove } from './record';
import { addAct, advance, colorOf, finish, resolveAsk, resync, seat, startTurn } from './room';
import type { Player, Room, ServerContext } from './roomTypes';

/** 发出请求的一方：所在的房间、玩家本身、执子的颜色 */
export interface Actor {
  r: Room;
  p: Player;
  me: number;
}

/** 维护模式中拒绝开始新的对局时的提示，也是进入维护模式时下发给在线玩家的通知（OPS-045，错误码 server.maintenance） */

/** 终局后：只接受再来一局的申请与回应 */
export function afterGame(ctx: ServerContext, { r, p, me }: Actor, m: C2S) {
  if (m.t === 'reply' && m.kind === 'rematch' && r.ask === 'rematch' && r.askFrom !== me) {
    resolveAsk(ctx, r, m.ok);
    return;
  }
  if (m.t !== 'rematch') return;
  if (ctx.maintenance) {
    ctx.send(p, errorMsg('server.maintenance'));
    return;
  }
  const opp = seat(ctx, r, other(me));
  if (r.kind === 'ranked') ctx.send(p, errorMsg('game.rematch-ranked'));
  else if (!r.ask && opp?.conn) ask(ctx, r, me, 'rematch');
  else ctx.send(p, errorMsg(r.ask ? 'game.awaiting-reply' : 'game.rematch-opponent-left'));
}

/** 不以局面为前提的请求：认输与离开在过期的版本上也照常执行，只按序号判重（protocol-v4.md 第 7.3 条） */
const ANY_VERSION: ReadonlySet<string> = new Set(['resign', 'leave']);

/**
 * 改变对局状态的请求先经此检查（protocol-v4.md 第 7.3 条）：序号重复或跳号的不执行；所在对局的状态版本已变的不执行，
 * 回复 game.stale。不执行时回复完整同步（不在对局中时没有可同步的，只记下序号）。返回是否照常处理
 */
export function inOrder(ctx: ServerContext, p: Player, m: Extract<C2S, Stamp>): boolean {
  const expected = p.seq + 1;
  p.seq = Math.max(p.seq, m.seq);
  const r = ctx.rooms.get(p.room);
  const room = r && colorOf(r, p) ? r : undefined;
  if (m.seq !== expected) {
    if (room) resync(ctx, room, p);
    return false;
  }
  if (!room || m.sv === room.sv || ANY_VERSION.has(m.t)) return true;
  ctx.send(p, errorMsg('game.stale'));
  resync(ctx, room, p);
  return false;
}

/** 对局中（含点目）的操作 */
export function inGame(ctx: ServerContext, { r, p, me }: Actor, m: C2S) {
  switch (m.t) {
    case 'move':
      playMove(ctx, { r, p, me }, m.x, m.y);
      return;
    case 'pass':
      passTurn(ctx, r, me);
      return;
    case 'undo':
      askUndo(ctx, r, p, me);
      return;
    case 'draw':
      askDraw(ctx, r, p, me);
      return;
    case 'reply':
      if (m.kind !== 'rematch' && r.ask === m.kind && r.askFrom !== me) resolveAsk(ctx, r, m.ok);
      return;
    case 'resign':
      finish(ctx, r, { winner: other(me), reason: 'resign' });
      return;
    case 'mark':
      markDead(ctx, r, m.x, m.y);
      return;
    case 'agree':
      agreeScore(ctx, r, me);
      return;
    case 'resume':
      resumePlay(ctx, r);
      return;
  }
}

/** 向对方提出申请；等回应时不计时 */
export function ask(ctx: ServerContext, r: Room, me: number, kind: AskKind) {
  r.ask = kind;
  r.askFrom = me;
  r.askUntil = ctx.now() + ASK_SECS;
  if (kind !== 'rematch') r.deadline = 0;
  advance(ctx, r, { t: 'ask', kind, from: me });
}

/** 落子：轮到自己、没有待回应的申请、按规则可以落在这里时才落下，并判断是否终局 */
export function playMove(ctx: ServerContext, { r, p, me }: Actor, x: number, y: number) {
  const g = r.g;
  if (g.scoring || g.cur.toMove !== me) {
    ctx.send(p, errorMsg('game.not-your-turn'));
    return;
  }
  if (r.ask) {
    ctx.send(p, errorMsg('game.awaiting-reply'));
    return;
  }
  if (!g.play(x, y)) {
    ctx.send(p, errorMsg('game.illegal-move', { params: { reject: g.lastReject ?? 'occupied' } }));
    return;
  } // 含落在本局棋盘之外
  stampMove(ctx, r);
  addAct(r, { k: 'M', x, y });
  advance(ctx, r, { t: 'moved', x, y });
  if (g.over) finish(ctx, r, { winner: g.winner, reason: g.winner === DRAWN ? 'full' : 'five' });
  else startTurn(ctx, r);
}

/** 停一手（围棋）：轮到自己、不在点目、没有待回应的申请时才停，并清除双方对点目的确认 */
export function passTurn(ctx: ServerContext, r: Room, me: number) {
  const g = r.g;
  if (g.type !== GameType.Go || g.scoring || g.cur.toMove !== me || r.ask) return;
  g.pass();
  stampMove(ctx, r);
  addAct(r, { k: 'P' });
  advance(ctx, r, { t: 'passed' });
  r.agreed = [false, false, false];
  startTurn(ctx, r);
}

/** 申请悔棋：每局每方至多 UNDO_LIMIT 次，须有可以悔的棋 */
export function askUndo(ctx: ServerContext, r: Room, p: Player, me: number) {
  const g = r.g;
  if (r.ask || g.scoring) {
    ctx.send(p, errorMsg('game.undo-not-allowed'));
    return;
  }
  if ((r.undoUsed[me] ?? 0) >= UNDO_LIMIT) {
    ctx.send(p, errorMsg('game.undo-exhausted'));
    return;
  }
  if (g.hist.length < (g.cur.toMove === me ? 2 : 1)) {
    ctx.send(p, errorMsg('game.undo-nothing'));
    return;
  } // 轮到自己时要连对方那一手一起退
  r.undoUsed[me] = (r.undoUsed[me] ?? 0) + 1;
  ask(ctx, r, me, 'undo');
}

/** 申请和棋：每局每方至多 DRAW_LIMIT 次 */
export function askDraw(ctx: ServerContext, r: Room, p: Player, me: number) {
  if (r.ask) {
    ctx.send(p, errorMsg('game.awaiting-reply'));
    return;
  }
  if ((r.drawUsed[me] ?? 0) >= DRAW_LIMIT) {
    ctx.send(p, errorMsg('game.draw-exhausted'));
    return;
  }
  r.drawUsed[me] = (r.drawUsed[me] ?? 0) + 1;
  ask(ctx, r, me, 'draw');
}

/** 点目时标记 / 取消死子（点在空处或本局棋盘之外的忽略） */
export function markDead(ctx: ServerContext, r: Room, x: number, y: number) {
  const g = r.g;
  if (!g.scoring || !g.inB(x, y) || !g.b(x, y)) return;
  g.toggleDead(x, y);
  addAct(r, { k: 'K', x, y });
  r.agreed = [false, false, false];
  advance(ctx, r, { t: 'marked', x, y });
}

/** 确认点目结果；双方都确认后终局 */
export function agreeScore(ctx: ServerContext, r: Room, me: number) {
  const g = r.g;
  if (!g.scoring || r.agreed[me]) return;
  r.agreed[me] = true;
  advance(ctx, r, { t: 'agreed', color: me });
  if (!r.agreed[BLACK] || !r.agreed[WHITE]) return;
  g.computeScore();
  g.confirmScore();
  finish(ctx, r, { winner: g.winner, reason: 'score' });
}

/** 点目有分歧：回到对局 */
export function resumePlay(ctx: ServerContext, r: Room) {
  const g = r.g;
  if (!g.scoring) return;
  g.resume();
  addAct(r, { k: 'R' });
  r.agreed = [false, false, false];
  advance(ctx, r, { t: 'resumed' });
  startTurn(ctx, r);
}
