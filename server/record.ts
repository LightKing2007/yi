/**
 * 对局记录（阶段 5，roadmap.md 第 5.4 节）：每手用时、棋谱的组装，开局与终局时写入存放处；排位结算与终局记录在同一事务中（DAT-040）。
 * 存放处写入失败时只影响这一局的记录与结算：写 error 日志，向双方下发提示与错误编号，本局不计段位，对局本身照常（10-edge-cases.md 第 4 节）。
 */
import { randomUUID } from 'node:crypto';
import type { GameRecord } from '../src/core/record';
import { BLACK, WHITE, at } from '../src/core/types';
import type { OverReason } from '../src/shared/protocol';
import { announceRated, elo, typeKey } from './rating';
import { INTERNAL_TEXT, type GameSide, type Room, type ServerContext, type StoredEndReason } from './roomTypes';

/** 每秒的毫秒数 */
const MS_PER_SEC = 1000;

/** 新的一手开始时调用：手数变了（落子、停一手、悔棋、开局）才重新计时，申请被拒等情况不打断这一手的用时 */
export function markTurn(ctx: ServerContext, r: Room) {
  if (r.g.hist.length === r.turnPly) return;
  r.turnPly = r.g.hist.length;
  r.turnAt = ctx.now();
}

/** 刚走完的一手记下用时（毫秒）：从这一手开始到收到落子或停一手，以服务端时钟计 */
export function stampMove(ctx: ServerContext, r: Room) {
  const last = r.g.moves.at(-1);
  if (last) last.ms = Math.max(0, Math.round((ctx.now() - r.turnAt) * MS_PER_SEC));
}

/** 这一局的棋谱：规则、终局时的着法序列与用时、点目时的死子、结果 */
export function toRecord(r: Room, winner: number, reason: OverReason): GameRecord {
  const g = r.g;
  const record: GameRecord = { cfg: g.cfg, moves: g.moves.map(move => ({ ...move })), result: { winner, reason } };
  if (reason === 'score') {
    const dead: { x: number; y: number }[] = [];
    for (let x = 0; x < g.N; x++) for (let y = 0; y < g.N; y++) if (g.dead[at(x, y)]) dead.push({ x, y });
    record.dead = dead;
  }
  return record;
}

/** 存放处写入失败：写 error 日志（含调用栈与错误编号），向双方下发提示与错误编号（E5） */
function writeFailed(ctx: ServerContext, r: Room, op: string, err: unknown) {
  const errorId = randomUUID();
  ctx.log('error', 'db.write-failed', { msg: `房间 ${r.id} 的对局记录写入失败（${op}）`, roomId: r.id, gameId: r.gameId, op, errorId, err });
  ctx.metrics?.inc('yi_db_write_failures_total');
  for (const p of [r.who[BLACK], r.who[WHITE]]) if (p) ctx.send(p, { t: 'error', text: INTERNAL_TEXT, errorId });
}

/** 一方在存放处中的身份 */
const sideOf = (r: Room, color: number): GameSide => ({ key: r.who[color]?.key ?? '', name: r.who[color]?.name ?? '' });

/** 开局：写入对局记录；失败时这一局没有记录（recordId 为 0），对局照常 */
export function recordStart(ctx: ServerContext, r: Room) {
  r.recordId = 0;
  r.turnPly = -1;
  try {
    r.recordId = ctx.store.startGame({ kind: r.kind, type: typeKey(r.type), size: r.size, black: sideOf(r, BLACK), white: sideOf(r, WHITE) });
  } catch (err) {
    writeFailed(ctx, r, 'start', err);
  }
}

/**
 * 终局：在一个事务内写入棋谱与结果；排位赛且 rated 为真时一并结算（存放处重新读取双方段位），随后通知双方。
 * 没有记录或写入失败时不结算段位
 */
export function recordEnd(ctx: ServerContext, r: Room, end: { winner: number; reason: OverReason; stored: StoredEndReason; rated: boolean }) {
  const { winner, reason, stored, rated } = end;
  if (!r.recordId) {
    if (rated) writeFailed(ctx, r, 'finish', new Error('这一局开局时没有写入记录，不能结算段位'));
    return;
  }
  const settle = rated ? (black: Parameters<typeof elo>[0], white: Parameters<typeof elo>[1]) => elo(black, white, winner) : undefined;
  try {
    const settled = ctx.store.finishGame(r.recordId, { record: toRecord(r, winner, reason), winner, reason: stored }, settle);
    if (settled) announceRated(ctx, r, settled);
  } catch (err) {
    writeFailed(ctx, r, 'finish', err);
  }
}

/** 服务端放弃了这一局（异常隔离）：尚未写入终局的记为 aborted；本身出错时只写日志，不影响清理 */
export function recordAbort(ctx: ServerContext, r: Room) {
  if (!r.recordId) return;
  try {
    ctx.store.abortGame(r.recordId);
  } catch (err) {
    ctx.log('error', 'db.write-failed', { msg: `房间 ${r.id} 的对局记录写入失败（abort）`, roomId: r.id, gameId: r.gameId, op: 'abort', err });
  }
}
